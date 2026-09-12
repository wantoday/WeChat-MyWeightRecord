import { CLOUD_ENV_ID, PLAN_NAME_MAX, PLAN_NICKNAME_MAX } from '../config'
import * as records from './record'
import { clearPlanLocal, loadPlanLocal, savePlanLocal } from './storage'
import type { PlanInfo, PlanLocal, PlanMember, PlanPoint } from './types'
import { toPlanPoints } from '../utils/plan'

/**
 * 好友计划层 —— 页面唯一入口。
 *
 * 与 sync.ts 一样，客户端不直连云数据库：读写都走云函数 weightPlan，
 * openid 只在云函数里从 cloud.getWXContext() 拿。
 *
 * 上传内容的边界在 utils/plan.toPlanPoints 里定死：只有日期和体重，
 * 备注、身高、目标体重一律不上云。
 *
 * 除 pushMyPoints 外，出错都抛 Error（message 已是能直接 toast 的人话）：
 * 创建/加入/退出是用户主动点的操作，失败了必须让他看见。
 */

const CLOUD_FN = 'weightPlan'

type CloudError = { ok: false; code: string; detail?: string }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** 云函数一律返回 { ok, ... }，出错时带 code。 */
function readError(raw: unknown): CloudError | null {
  if (isPlainObject(raw) && raw.ok === true) return null
  const code = isPlainObject(raw) && typeof raw.code === 'string' ? raw.code : 'UNKNOWN'
  const detail = isPlainObject(raw) && typeof raw.message === 'string' ? raw.message : undefined
  return { ok: false, code, detail }
}

/** callFunction 是 reject 而不是返回 { ok:false }：云函数没部署 / 环境 ID 不对 / 断网都走这里 */
function toCloudError(err: unknown): CloudError {
  const e = (isPlainObject(err) ? err : {}) as { errCode?: unknown; errMsg?: unknown }
  const code = typeof e.errCode === 'number' ? String(e.errCode) : 'CALL_FAILED'
  const detail = typeof e.errMsg === 'string' && e.errMsg ? e.errMsg : String(err)
  return { ok: false, code, detail }
}

function describeError(code: string): string {
  switch (code) {
    case 'NO_AUTH':
      return '未获取到微信身份'
    case 'NO_PLAN':
      return '邀请码不存在'
    case 'BAD_CODE':
      return '邀请码是 6 位字母数字'
    case 'FULL':
      return '这个计划人满了'
    case 'BAD_PLAN':
      return '计划信息缺失，请重新加入'
    case 'CODE_CONFLICT':
      return '邀请码生成失败，请重试'
    case 'NO_COLLECTION':
      return '云数据库未建集合 plans / plan_members'
    case 'INTERNAL':
      return '云函数执行出错'
    case 'CALL_FAILED':
      return '云函数未部署或环境 ID 不对'
    default:
      return /^-\d+$/.test(code) ? `调用云函数失败（${code}）` : '操作失败，请稍后重试'
  }
}

/**
 * 调云函数。成功返回 payload，失败抛人话 Error。
 * detail（微信 errMsg / 云函数 message）只进控制台 —— toast 放不下，排查时又要看。
 */
async function call(action: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!isPlanEnabled()) throw new Error('未开启云同步')
  let raw: unknown
  try {
    const res = await wx.cloud.callFunction({ name: CLOUD_FN, data: { action, ...data } })
    raw = res.result
  } catch (err) {
    const e = toCloudError(err)
    console.error('[plan] callFunction failed', e.code, e.detail)
    throw new Error(describeError(e.code))
  }

  const failure = readError(raw)
  if (failure) {
    console.error('[plan] cloud error', failure.code, failure.detail)
    throw new Error(describeError(failure.code))
  }
  return raw as Record<string, unknown>
}

function parsePlan(raw: unknown, fallback: PlanLocal | null): PlanInfo {
  const obj = isPlainObject(raw) ? raw : {}
  const id = typeof obj.id === 'string' ? obj.id : ''
  if (!id) {
    if (fallback) return { id: fallback.planId, name: fallback.name, code: fallback.code }
    throw new Error('计划信息缺失，请重新加入')
  }
  return {
    id,
    name: typeof obj.name === 'string' ? obj.name : '',
    code: typeof obj.code === 'string' ? obj.code : id,
  }
}

function parsePoints(raw: unknown): PlanPoint[] {
  if (!Array.isArray(raw)) return []
  const out: PlanPoint[] = []
  for (const p of raw) {
    if (!isPlainObject(p)) continue
    if (typeof p.date !== 'string' || typeof p.weight !== 'number' || !Number.isFinite(p.weight)) {
      continue
    }
    out.push({ date: p.date, weight: p.weight })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function parseMembers(raw: unknown): PlanMember[] {
  if (!Array.isArray(raw)) return []
  const out: PlanMember[] = []
  raw.forEach((m, i) => {
    if (!isPlainObject(m)) return
    out.push({
      id: typeof m.id === 'string' ? m.id : `m${i}`,
      nickname: typeof m.nickname === 'string' && m.nickname ? m.nickname : '好友',
      points: parsePoints(m.points),
      updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : 0,
      isMe: m.isMe === true,
    })
  })
  return out
}

/** 好友计划是否可用 —— 取决于有没有配环境 ID。没配就是纯本地模式。 */
export function isPlanEnabled(): boolean {
  return CLOUD_ENV_ID.length > 0
}

/** 本机加入的计划，没加入过返回 null。只读本地，不联网。 */
export function loadPlan(): PlanLocal | null {
  return loadPlanLocal()
}

async function joinAndRemember(
  action: 'create' | 'join',
  data: Record<string, unknown>,
  nickname: string
): Promise<PlanInfo> {
  const res = await call(action, data)
  const plan = parsePlan(res.plan, null)
  savePlanLocal({
    planId: plan.id,
    name: plan.name,
    code: plan.code,
    nickname,
    joinedAt: Date.now(),
  })
  return plan
}

/** 建一个新计划，返回带邀请码的计划信息。 */
export async function createPlan(name: string, nickname: string): Promise<PlanInfo> {
  const n = name.trim().slice(0, PLAN_NAME_MAX) || '减肥计划'
  const nick = nickname.trim().slice(0, PLAN_NICKNAME_MAX) || '我'
  return joinAndRemember('create', { name: n, nickname: nick, points: await myPoints() }, nick)
}

/**
 * 用邀请码加入。已经在这个计划里时，等于「改昵称 + 覆盖自己的点」——
 * 云函数用 set 写整条成员 doc，所以改昵称不用再加一个 action。
 */
export async function joinPlan(code: string, nickname: string): Promise<PlanInfo> {
  const nick = nickname.trim().slice(0, PLAN_NICKNAME_MAX) || '好友'
  return joinAndRemember(
    'join',
    { code: code.trim().toUpperCase(), nickname: nick, points: await myPoints() },
    nick
  )
}

/** 退出计划：先删云端那条成员数据，成功才抹掉本机记录。 */
export async function leavePlan(): Promise<void> {
  const local = loadPlanLocal()
  if (!local) return
  await call('leave', { planId: local.planId })
  clearPlanLocal()
}

/** 拉计划里所有人的曲线。没加入计划返回 null。 */
export async function fetchMembers(): Promise<{ plan: PlanInfo; members: PlanMember[] } | null> {
  const local = loadPlanLocal()
  if (!local) return null
  const res = await call('members', { planId: local.planId })
  return { plan: parsePlan(res.plan, local), members: parseMembers(res.members) }
}

function myPoints(): Promise<PlanPoint[]> {
  return records.fetchAll().then((rows) => toPlanPoints(rows))
}

/**
 * 打卡后自动上传自己的点。刻意静默：没加入计划直接返回，
 * 失败也只 console.warn —— 打卡本身已经成功，不该弹「同步失败」吓人。
 */
export async function pushMyPoints(): Promise<boolean> {
  const local = loadPlanLocal()
  if (!local) return false
  try {
    await call('push', { planId: local.planId, points: await myPoints() })
    return true
  } catch (err) {
    console.warn('[plan] auto push failed', err)
    return false
  }
}
