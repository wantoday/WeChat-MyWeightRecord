import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 端到端契约测试：真客户端 + 真云函数。
 *
 * 这里和 tests/sync.test.ts 的区别：那边用的是「手写的假云函数」，
 * 只能证明客户端逻辑自洽；这边直接加载 cloudfunctions/weightSync/index.js 的
 * 真实源码，只把 wx-server-sdk 换成内存实现 —— 能抓出两端的契约不一致
 * （字段名、CAS 语义、pull/push 的返回结构）。
 *
 * 注意：这验证的是逻辑契约，不是真实网络。wx.cloud.init、真实 OPENID、
 * 云函数部署与冷启动，仍然只能在微信开发者工具里验证。
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
import { getSyncStatus, syncNow } from '../miniprogram/models/sync'

const OPENID = 'openid-zhangsan'
const COLLECTION = 'user_data'

/**
 * 用一个严格递增的时钟替掉 Date.now。
 * 真实时间戳只有毫秒精度，几个 await 连着跑很容易撞车；一旦 A 的「复活」
 * 和 B 的「删除」落在同一毫秒，last-write-wins 就会判定平手（平手本地赢），
 * B 于是保留墓碑 —— 测试就变成随机红。递增时钟让先后关系确定。
 */
const realDateNow = Date.now
let clock = 1_700_000_000_000

afterEach(() => {
  Date.now = realDateNow
})

type Doc = { _id: string; openid: string; snapshot: unknown; updatedAt: number }

/** 内存版云数据库，行为对齐微信云开发的 doc/where/update 语义 */
function makeDatabase() {
  const docs = new Map<string, Doc>()
  const collection = (name: string) => {
    expect(name).toBe(COLLECTION)
    return {
      doc(id: string) {
        return {
          async get() {
            const d = docs.get(id)
            if (!d) throw new Error('document does not exist')
            return { data: d }
          },
        }
      },
      async add(param: { data: Doc }) {
        if (docs.has(param.data._id)) throw new Error('duplicate _id')
        docs.set(param.data._id, { ...param.data })
        return { _id: param.data._id }
      },
      where(cond: { _id: string; updatedAt: number }) {
        return {
          async update(param: { data: Record<string, unknown> }) {
            let updated = 0
            const d = docs.get(cond._id)
            if (d && d.updatedAt === cond.updatedAt) {
              docs.set(cond._id, { ...d, ...param.data })
              updated = 1
            }
            return { stats: { updated } }
          },
        }
      },
    }
  }
  return { collection, docs }
}

type CloudFn = (event: Record<string, unknown>) => Promise<Record<string, unknown>>

/** 加载真实云函数源码，只把 wx-server-sdk 换成假的 */
function loadCloudFunction(sdk: unknown): CloudFn {
  const src = readFileSync(
    fileURLToPath(new URL('../cloudfunctions/weightSync/index.js', import.meta.url)),
    'utf8'
  )
  const mod = { exports: {} as Record<string, unknown> }
  const fakeRequire = (id: string): unknown => (id === 'wx-server-sdk' ? sdk : require(id))
  new Function('require', 'module', 'exports', src)(fakeRequire, mod, mod.exports)
  return mod.exports.main as CloudFn
}

let db: ReturnType<typeof makeDatabase>
let main: CloudFn
let openid: string | undefined = OPENID
/** 每次 push 前插一脚，用来制造并发 */
let beforePush: (() => Promise<void>) | null = null
/** 每台设备一份本地存储，模拟两台手机 */
const devices = new Map<string, Map<string, unknown>>()
let currentDevice = ''
let storage: Map<string, unknown>

function useDevice(name: string): void {
  if (!devices.has(name)) devices.set(name, new Map())
  storage = devices.get(name)!
  currentDevice = name
}

function visibleRecords(): { date: string; weight: number; deleted?: true }[] {
  return loadRawRecords()
    .filter((r) => !r.deleted)
    .map((r) => ({ date: r.date, weight: r.weight }))
}

beforeEach(() => {
  clock = 1_700_000_000_000
  Date.now = () => (clock += 1)
  env.id = 'test-env'
  openid = OPENID
  beforePush = null
  devices.clear()
  db = makeDatabase()
  main = loadCloudFunction({
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    getWXContext: () => ({ OPENID: openid }),
    database: () => ({ collection: db.collection }),
  })

  ;(globalThis as any).wx = {
    getStorageSync(key: string) {
      return storage.get(key)
    },
    setStorageSync(key: string, val: unknown) {
      storage.set(key, val)
    },
    removeStorageSync(key: string) {
      storage.delete(key)
    },
    cloud: {
      async callFunction(param: { name: string; data?: Record<string, unknown> }) {
        const data = param.data || {}
        if (data.action === 'push' && beforePush) {
          const hook = beforePush
          beforePush = null
          await hook()
        }
        return { result: await main(data) }
      },
    },
  }
  useDevice('A')
})

describe('云函数基本契约', () => {
  it('拿不到 openid → NO_AUTH，客户端报可读错误', async () => {
    openid = undefined
    await expect(syncNow()).resolves.toEqual({ status: 'error', message: '未获取到微信身份' })
  })

  it('action 非法 → BAD_ACTION', async () => {
    await expect(main({ action: 'hack' })).resolves.toEqual({ ok: false, code: 'BAD_ACTION' })
  })

  it('pull 时云端无 doc → exists:false、updatedAt:0（首次同步走 add）', async () => {
    await expect(main({ action: 'pull' })).resolves.toMatchObject({
      ok: true,
      exists: false,
      snapshot: null,
      updatedAt: 0,
    })
  })

  it('snapshot 形状不对 → BAD_SNAPSHOT，不会写脏数据进库', async () => {
    await expect(main({ action: 'push', snapshot: { records: 'nope' }, baseUpdatedAt: 0 })).resolves.toEqual({
      ok: false,
      code: 'BAD_SNAPSHOT',
    })
    expect(db.docs.size).toBe(0)
  })
})

describe('两台设备往返', () => {
  it('A 同步 → B 换设备拉回来', async () => {
    useDevice('A')
    upsertRecord('2026-09-01', 70)
    upsertRecord('2026-09-02', 69.5)
    await expect(syncNow()).resolves.toMatchObject({ status: 'ok' })
    expect(db.docs.size).toBe(1)

    useDevice('B')
    await expect(syncNow()).resolves.toMatchObject({ status: 'ok' })
    expect(visibleRecords()).toEqual([
      { date: '2026-09-01', weight: 70 },
      { date: '2026-09-02', weight: 69.5 },
    ])
    expect(getSyncStatus().bound).toBe(true)
  })

  it('B 改了某天 + 删了某天 → A 同步后都能看到', async () => {
    useDevice('A')
    upsertRecord('2026-09-01', 70)
    upsertRecord('2026-09-02', 69.5)
    await syncNow()

    useDevice('B')
    await syncNow()
    upsertRecord('2026-09-02', 68)
    removeRecordById(loadRawRecords().find((r) => r.date === '2026-09-01')!._id)
    await syncNow()

    useDevice('A')
    await syncNow()
    expect(visibleRecords()).toEqual([{ date: '2026-09-02', weight: 68 }])
  })

  it('B 删掉的那天在 A 重新记录 → 复活，且不会再被墓碑盖掉', async () => {
    useDevice('A')
    upsertRecord('2026-09-01', 70)
    await syncNow()

    useDevice('B')
    await syncNow()
    removeRecordById(loadRawRecords()[0]._id)
    await syncNow()

    useDevice('A')
    await syncNow()
    expect(visibleRecords()).toEqual([])

    upsertRecord('2026-09-01', 71)
    await syncNow()

    useDevice('B')
    await syncNow()
    expect(visibleRecords()).toEqual([{ date: '2026-09-01', weight: 71 }])
  })

  it('并发：A 拉取后 B 抢先推送 → A 收到 CONFLICT 重试，两边数据都不丢', async () => {
    useDevice('A')
    upsertRecord('2026-09-01', 70)

    useDevice('B')
    upsertRecord('2026-09-02', 65)
    useDevice('A')

    // A 拉完快照、正要 push 的那一刻，让 B 完成一次完整同步
    beforePush = async () => {
      const saved = currentDevice
      useDevice('B')
      await syncNow()
      useDevice(saved)
    }

    await expect(syncNow()).resolves.toMatchObject({ status: 'ok' })

    const snapshot = db.docs.get(OPENID)!.snapshot as { records: { date: string }[] }
    expect(snapshot.records.map((r) => r.date)).toEqual(['2026-09-01', '2026-09-02'])
    // A 本地也应该已经合并进了 B 的数据
    expect(visibleRecords()).toEqual([
      { date: '2026-09-01', weight: 70 },
      { date: '2026-09-02', weight: 65 },
    ])
  })

  it('档案与单位偏好也一起同步', async () => {
    useDevice('A')
    wx.setStorageSync('weight_profile', {
      _id: 'profile_local',
      heightCm: 175,
      targetWeight: 65,
      updatedAt: Date.now(),
    })
    wx.setStorageSync('weight_unit', { unit: 'kg', updatedAt: Date.now() })
    await syncNow()

    useDevice('B')
    expect(loadUnitPref().unit).toBe('jin') // 同步前还是默认值
    await syncNow()
    expect(loadUnitPref().unit).toBe('kg')
    expect(wx.getStorageSync('weight_profile')).toMatchObject({ heightCm: 175, targetWeight: 65 })
  })

  it('两端一致时不回写：不会无谓刷新云端的版本号', async () => {
    useDevice('A')
    upsertRecord('2026-09-01', 70)
    await syncNow()
    const updatedAt = db.docs.get(OPENID)!.updatedAt

    await syncNow()
    expect(db.docs.get(OPENID)!.updatedAt).toBe(updatedAt)
  })
})
