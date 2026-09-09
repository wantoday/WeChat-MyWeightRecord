import { CLOUD_ENV_ID } from '../config'
import {
  loadProfile,
  loadRawRecords,
  loadSyncMeta,
  loadUnitPref,
  saveRawProfile,
  saveRawRecords,
  saveSyncMeta,
  saveUnitPref,
} from './storage'
import type { SyncMeta, SyncSnapshot } from './types'
import { mergeSnapshot, sanitizeSnapshot, snapshotEquals } from '../utils/merge'

/**
 * 云同步层 —— 页面唯一入口。
 *
 * 客户端不直连云数据库：openid 只有云函数能从 cloud.getWXContext() 拿到，
 * 而「换设备找回自己的数据」必须靠 openid 定位。读写都走云函数 weightSync，
 * 数据库权限设成「仅管理端可读写」即可，也不用配安全规则。
 *
 * 一次同步 = pull（拿远端快照 + doc 版本号）→ 本地合并 → push（带 CAS 乐观锁）。
 * CAS 不能省：pull 与 push 之间若另一台设备推了数据，无锁覆盖会永久丢一天记录。
 */

const CLOUD_FN = 'weightSync'

export type SyncResult =
  | { status: 'ok'; syncedAt: number }
  | { status: 'off' }
  | { status: 'error'; message: string; detail?: string }

type CloudError = { ok: false; code: string; detail?: string }

type PullReply =
  | {
      ok: true
      exists: boolean
      snapshot: unknown
      updatedAt: number
      serverTime: number
    }
  | CloudError

type PushReply = { ok: true; updatedAt: number; serverTime: number } | CloudError

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function readTs(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * 云函数一律返回 { ok, ... }，出错时带 code。
 * wx.cloud.callFunction 的 result 是宽松类型，这里做运行时校验 ——
 * 不用 as any 绕过，否则等于放弃唯一的静态检查手段。
 */
function readError(raw: unknown): CloudError | null {
  if (isPlainObject(raw) && raw.ok === true) return null
  const code = isPlainObject(raw) && typeof raw.code === 'string' ? raw.code : 'UNKNOWN'
  const detail = isPlainObject(raw) && typeof raw.message === 'string' ? raw.message : undefined
  return { ok: false, code, detail }
}

/**
 * 「云函数没部署 / 环境 ID 不对 / 断网」时，wx.cloud.callFunction 是 reject 的，
 * 不会返回 { ok:false }。这里统一转成 CloudError，并保留微信的 errCode / errMsg ——
 * 排查部署问题全靠这两个字段，丢了就只剩一句「同步失败，请重试」。
 */
function toCloudError(err: unknown): CloudError {
  const e = (isPlainObject(err) ? err : {}) as { errCode?: unknown; errMsg?: unknown }
  const code = typeof e.errCode === 'number' ? String(e.errCode) : 'CALL_FAILED'
  const detail = typeof e.errMsg === 'string' && e.errMsg ? e.errMsg : String(err)
  return { ok: false, code, detail }
}

function parsePull(raw: unknown): PullReply {
  const err = readError(raw)
  if (err) return err
  const res = raw as Record<string, unknown>
  return {
    ok: true,
    exists: res.exists === true,
    snapshot: res.snapshot,
    updatedAt: readTs(res.updatedAt, 0),
    serverTime: readTs(res.serverTime, Date.now()),
  }
}

function parsePush(raw: unknown): PushReply {
  const err = readError(raw)
  if (err) return err
  const res = raw as Record<string, unknown>
  return {
    ok: true,
    updatedAt: readTs(res.updatedAt, 0),
    serverTime: readTs(res.serverTime, Date.now()),
  }
}

async function callPull(): Promise<PullReply> {
  try {
    const res = await wx.cloud.callFunction({ name: CLOUD_FN, data: { action: 'pull' } })
    return parsePull(res.result)
  } catch (err) {
    return toCloudError(err)
  }
}

async function callPush(snapshot: SyncSnapshot, baseUpdatedAt: number): Promise<PushReply> {
  try {
    const res = await wx.cloud.callFunction({
      name: CLOUD_FN,
      data: { action: 'push', snapshot, baseUpdatedAt },
    })
    return parsePush(res.result)
  } catch (err) {
    return toCloudError(err)
  }
}

/** 云同步是否开启 —— 取决于有没有配环境 ID。没配就是纯本地模式。 */
export function isSyncEnabled(): boolean {
  return CLOUD_ENV_ID.length > 0
}

/** 同步状态（上次同步时间、是否已绑定）。只读本地，不联网。 */
export function getSyncStatus(): SyncMeta {
  return loadSyncMeta()
}

function readLocalSnapshot(): SyncSnapshot {
  return {
    records: loadRawRecords(),
    profile: loadProfile(),
    unit: loadUnitPref(),
  }
}

function writeLocalSnapshot(snapshot: SyncSnapshot): void {
  saveRawRecords(snapshot.records)
  saveRawProfile(snapshot.profile)
  saveUnitPref(snapshot.unit)
}

function describeError(code: string): string {
  switch (code) {
    case 'NO_AUTH':
      return '未获取到微信身份'
    case 'CONFLICT':
      return '数据有冲突，请重试'
    case 'TOO_LARGE':
      return '数据过大，无法同步'
    case 'NO_COLLECTION':
      return '云数据库未建集合 user_data'
    case 'INTERNAL':
      return '云函数执行出错'
    case 'CALL_FAILED':
      return '云函数未部署或环境 ID 不对'
    default:
      // 微信原生 errCode 原样带上（-504003 = 云函数不存在），方便对着文档查
      return /^-\d+$/.test(code) ? `调用云函数失败（${code}）` : '同步失败，请稍后重试'
  }
}

/**
 * 执行一次同步：pull → 合并 → 写本地 → push，遇到冲突整体重跑一次。
 * 失败也不会破坏本地数据 —— 合并结果在 push 之前就已经落盘了。
 */
export async function syncNow(): Promise<SyncResult> {
  if (!isSyncEnabled()) return { status: 'off' }

  for (let attempt = 0; attempt < 2; attempt++) {
    const pulled = await callPull()
    if (!pulled.ok) {
      return { status: 'error', message: describeError(pulled.code), detail: pulled.detail }
    }

    const remote = sanitizeSnapshot(pulled.snapshot, pulled.serverTime)
    const merged = mergeSnapshot(readLocalSnapshot(), remote)
    writeLocalSnapshot(merged)

    // 合并结果和远端一致就没必要回写，省一次 push
    if (remote && snapshotEquals(merged, remote)) {
      saveSyncMeta({ lastSyncAt: pulled.serverTime, bound: true })
      return { status: 'ok', syncedAt: pulled.serverTime }
    }

    const pushed = await callPush(merged, pulled.updatedAt)
    if (pushed.ok) {
      saveSyncMeta({ lastSyncAt: pushed.serverTime, bound: true })
      return { status: 'ok', syncedAt: pushed.serverTime }
    }
    if (pushed.code === 'CONFLICT' && attempt === 0) continue // 远端被别的设备改过，重拉再合并
    return { status: 'error', message: describeError(pushed.code), detail: pushed.detail }
  }

  return { status: 'error', message: describeError('CONFLICT') }
}
