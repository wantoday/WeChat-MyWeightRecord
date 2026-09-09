import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 云同步需要在测试里开起来 —— config 里的 CLOUD_ENV_ID 默认是空（纯本地模式）。
 * 用 getter 暴露，好在单个用例里改回空来测「未开启」分支。
 */
const env = vi.hoisted(() => ({ id: 'test-env' }))

vi.mock('../miniprogram/config', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    get CLOUD_ENV_ID() {
      return env.id
    },
  }
})

import { loadRawRecords, loadUnitPref, removeRecordById, upsertRecord } from '../miniprogram/models/storage'
import { getSyncStatus, isSyncEnabled, syncNow } from '../miniprogram/models/sync'
import type { SyncSnapshot } from '../miniprogram/models/types'

const NOW = 1_700_000_000_000

/** 假 wx：Map 版本地存储 + 一个可控的 wx.cloud.callFunction */
function installFakeWx(): void {
  const mem = new Map<string, unknown>()
  ;(globalThis as any).wx = {
    getStorageSync(key: string) {
      return mem.get(key)
    },
    setStorageSync(key: string, val: unknown) {
      mem.set(key, val)
    },
    removeStorageSync(key: string) {
      mem.delete(key)
    },
    cloud: {
      callFunction(param: { name: string; data?: Record<string, unknown> }) {
        calls.push(param.data || {})
        return Promise.resolve({ result: cloud.handle(param.data || {}) })
      },
    },
  }
}

let calls: Record<string, unknown>[] = []

/** 用内存里的一条 doc 模拟云数据库 user_data，行为对齐 cloudfunctions/weightSync */
function makeCloud(initial: SyncSnapshot | null = null) {
  let doc: { _id: string; snapshot: unknown; updatedAt: number } | null = initial
    ? { _id: 'openid-test', snapshot: initial, updatedAt: NOW }
    : null
  let clock = NOW
  let failNextPush = false
  return {
    get doc() {
      return doc
    },
    failPushOnce() {
      failNextPush = true
    },
    handle(data: Record<string, unknown>) {
      clock += 1
      if (data.action === 'pull') {
        return {
          ok: true,
          exists: !!doc,
          snapshot: doc ? doc.snapshot : null,
          updatedAt: doc ? doc.updatedAt : 0,
          serverTime: clock,
        }
      }
      if (data.action !== 'push') return { ok: false, code: 'BAD_ACTION' }
      const snapshot = data.snapshot
      if (!snapshot || !Array.isArray((snapshot as SyncSnapshot).records)) {
        return { ok: false, code: 'BAD_SNAPSHOT' }
      }
      if (failNextPush) {
        failNextPush = false
        return { ok: false, code: 'CONFLICT' }
      }
      const base = data.baseUpdatedAt as number
      if (!base) {
        if (doc) return { ok: false, code: 'CONFLICT' } // 别的设备抢先建了 doc
        doc = { _id: 'openid-test', snapshot, updatedAt: clock }
        return { ok: true, updatedAt: clock, serverTime: clock }
      }
      if (!doc || doc.updatedAt !== base) return { ok: false, code: 'CONFLICT' }
      doc = { _id: 'openid-test', snapshot, updatedAt: clock }
      return { ok: true, updatedAt: clock, serverTime: clock }
    },
  }
}

let cloud: ReturnType<typeof makeCloud>

function seedLocal(dates: [string, number][]): void {
  wx.setStorageSync(
    'weight_records',
    dates.map(([date, weight]) => ({
      _id: `r_${date}`,
      date,
      weight,
      note: '',
      createdAt: NOW - 1000,
      updatedAt: NOW - 1000,
    }))
  )
}

beforeEach(() => {
  env.id = 'test-env'
  calls = []
  installFakeWx()
  cloud = makeCloud()
})

describe('开关', () => {
  it('配了环境 ID 才算开启', () => {
    expect(isSyncEnabled()).toBe(true)
    env.id = ''
    expect(isSyncEnabled()).toBe(false)
  })

  it('未开启时 syncNow 返回 off 且不联网、不抛错', async () => {
    env.id = ''
    await expect(syncNow()).resolves.toEqual({ status: 'off' })
    expect(calls).toHaveLength(0)
  })
})

describe('syncNow', () => {
  it('首次同步（本地有数据、云端为空）→ 走 add，baseUpdatedAt 为 0', async () => {
    seedLocal([
      ['2026-09-01', 70],
      ['2026-09-02', 69.5],
    ])

    const res = await syncNow()
    expect(res.status).toBe('ok')
    expect(cloud.doc).not.toBeNull()
    expect((cloud.doc?.snapshot as SyncSnapshot).records).toHaveLength(2)
    // 第一次同步一定是 add（远端版本号为 0）
    expect(calls.filter((c) => c.action === 'push')[0].baseUpdatedAt).toBe(0)
    expect(getSyncStatus().bound).toBe(true)
  })

  it('换设备（本地空、云端有数据）→ 拉下来写进本地', async () => {
    cloud = makeCloud({
      records: [
        { _id: 'r_2026-09-01', date: '2026-09-01', weight: 70, createdAt: NOW, updatedAt: NOW },
      ],
      profile: { _id: 'profile_local', heightCm: 175, targetWeight: 65, updatedAt: NOW },
      unit: { unit: 'kg', updatedAt: NOW },
    })
    installFakeWx()

    await expect(syncNow()).resolves.toMatchObject({ status: 'ok' })
    expect(loadRawRecords().map((r) => r.date)).toEqual(['2026-09-01'])
  })

  it('两端一致 → 不回写，只更新同步时间', async () => {
    const snapshot: SyncSnapshot = {
      records: [{ _id: 'r_2026-09-01', date: '2026-09-01', weight: 70, createdAt: NOW, updatedAt: NOW }],
      profile: { _id: 'profile_local', heightCm: 0, targetWeight: 0, updatedAt: 0 },
      unit: { unit: 'jin', updatedAt: 0 },
    }
    cloud = makeCloud(snapshot)
    installFakeWx()

    await syncNow()
    expect(calls.filter((c) => c.action === 'push')).toHaveLength(0)
    expect(getSyncStatus().lastSyncAt).toBeGreaterThan(0)
  })

  it('push 遇 CONFLICT → 重跑一次后成功', async () => {
    cloud.failPushOnce()
    seedLocal([['2026-09-01', 70]])

    const res = await syncNow()
    expect(res.status).toBe('ok')
    // pull → push(冲突) → pull → push(成功)
    expect(calls.map((c) => c.action)).toEqual(['pull', 'push', 'pull', 'push'])
  })

  it('两次都冲突 → 返回 error，且本地仍是合并结果而不是被清空', async () => {
    seedLocal([['2026-09-01', 70]])
    const original = cloud.handle
    cloud.handle = (data: Record<string, unknown>) =>
      data.action === 'push' ? { ok: false, code: 'CONFLICT' } : original(data)

    const res = await syncNow()
    expect(res.status).toBe('error')
    expect(loadRawRecords().map((r) => r.date)).toEqual(['2026-09-01'])
  })

  it('云函数报错 → 返回可读的错误信息', async () => {
    cloud.handle = () => ({ ok: false, code: 'NO_AUTH' })
    await expect(syncNow()).resolves.toEqual({ status: 'error', message: '未获取到微信身份' })
  })

  it('云函数没部署（callFunction reject）→ 带上微信 errCode，不抛出', async () => {
    ;(globalThis as any).wx.cloud.callFunction = () =>
      Promise.reject({ errCode: -504003, errMsg: 'FunctionName parameter could not be found' })

    const res = await syncNow()
    expect(res.status).toBe('error')
    expect(res).toMatchObject({
      message: '调用云函数失败（-504003）',
      detail: 'FunctionName parameter could not be found',
    })
  })

  it('集合没建 → 云函数报 NO_COLLECTION，不误报成冲突', async () => {
    cloud.handle = () => ({ ok: false, code: 'NO_COLLECTION', message: 'collection not exists' })
    await expect(syncNow()).resolves.toMatchObject({
      status: 'error',
      message: '云数据库未建集合 user_data',
    })
  })
})

describe('墓碑与本地写入', () => {
  it('删除是软删除：loadRawRecords 仍能看到，但页面读不到', () => {
    seedLocal([['2026-09-01', 70]])
    const id = loadRawRecords()[0]._id
    expect(removeRecordById(id)).toBe(true)
    expect(loadRawRecords()).toHaveLength(1)
    expect(loadRawRecords()[0].deleted).toBe(true)
  })

  it('删掉同一天再重新记录 → 墓碑被清掉，记录复活', () => {
    seedLocal([['2026-09-01', 70]])
    const id = loadRawRecords()[0]._id
    removeRecordById(id)

    const revived = upsertRecord('2026-09-01', 68)
    expect(revived.deleted).toBeUndefined()
    expect(loadRawRecords()).toHaveLength(1)
    expect(loadRawRecords()[0].weight).toBe(68)
  })

  it('重复删除同一条 → 第二次返回 false', () => {
    seedLocal([['2026-09-01', 70]])
    const id = loadRawRecords()[0]._id
    expect(removeRecordById(id)).toBe(true)
    expect(removeRecordById(id)).toBe(true) // 已是墓碑，仍会刷新 updatedAt
    expect(removeRecordById('not-exist')).toBe(false)
  })
})

describe('单位偏好向后兼容', () => {
  it('老版本存的裸字符串 → 兜底为 jin / kg，updatedAt 为 0', () => {
    wx.setStorageSync('weight_unit', 'kg')
    expect(loadUnitPref()).toEqual({ unit: 'kg', updatedAt: 0 })

    wx.setStorageSync('weight_unit', 'jin')
    expect(loadUnitPref()).toEqual({ unit: 'jin', updatedAt: 0 })
  })

  it('没存过 / 存了脏值 → 回落 jin', () => {
    expect(loadUnitPref().unit).toBe('jin')
    wx.setStorageSync('weight_unit', { unit: 'oops' })
    expect(loadUnitPref().unit).toBe('jin')
  })
})
