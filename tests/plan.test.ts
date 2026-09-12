import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 好友计划的测试：真客户端 + 真云函数。
 *
 * 与 tests/cloud-sync.test.ts 同一套做法：直接加载 cloudfunctions/weightPlan/index.js
 * 的真实源码，只把 wx-server-sdk 换成内存实现 —— 手写一个假云函数只能证明客户端
 * 逻辑自洽，抓不到两端字段契约不一致（邀请码归一化、points 清洗、isMe 标记）。
 *
 * 这验证的是逻辑契约，不是真实网络：云函数部署、真实 openid 仍然只能在开发者工具里验证。
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

import { PLAN_POINT_LIMIT, WEIGHT_RANGE } from '../miniprogram/config'
import {
  createPlan,
  fetchMembers,
  isPlanEnabled,
  joinPlan,
  leavePlan,
  loadPlan,
  pushMyPoints,
} from '../miniprogram/models/plan'
import { upsertRecord } from '../miniprogram/models/storage'
import { toPlanPoints } from '../miniprogram/utils/plan'

type Doc = Record<string, unknown> & { _id: string }

/** 内存版云数据库，只实现本云函数用到的那几个调用 */
function makeDatabase() {
  const stores = new Map<string, Map<string, Doc>>()
  const storeOf = (name: string): Map<string, Doc> => {
    if (!stores.has(name)) stores.set(name, new Map())
    return stores.get(name)!
  }
  const matches = (doc: Doc, cond: Record<string, unknown>): boolean =>
    Object.keys(cond).every((k) => doc[k] === cond[k])

  const collection = (name: string) => {
    // 集合没建时云开发会直接报错 —— 这里也照做，NO_COLLECTION 那条路径才测得出来
    if (name !== 'plans' && name !== 'plan_members') {
      throw new Error(`collection not exists: ${name}`)
    }
    const store = storeOf(name)
    return {
      async add(param: { data: Doc }) {
        if (!param.data._id) throw new Error('_id required')
        if (store.has(param.data._id)) throw new Error(`duplicate _id: ${param.data._id}`)
        store.set(param.data._id, { ...param.data })
        return { _id: param.data._id }
      },
      doc(id: string) {
        return {
          async get() {
            const d = store.get(id)
            if (!d) throw new Error(`document does not exist: ${id}`)
            return { data: d }
          },
          async set(param: { data: Record<string, unknown> }) {
            store.set(id, { ...param.data, _id: id })
            return { stats: { updated: 1 } }
          },
          async update(param: { data: Record<string, unknown> }) {
            const d = store.get(id)
            if (!d) return { stats: { updated: 0 } }
            store.set(id, { ...d, ...param.data, _id: id })
            return { stats: { updated: 1 } }
          },
        }
      },
      where(cond: Record<string, unknown>) {
        let limit = Infinity
        const api = {
          limit(n: number) {
            limit = n
            return api
          },
          async get() {
            return { data: [...store.values()].filter((d) => matches(d, cond)).slice(0, limit) }
          },
          async remove() {
            let removed = 0
            for (const [id, d] of [...store]) {
              if (matches(d, cond)) {
                store.delete(id)
                removed += 1
              }
            }
            return { stats: { removed } }
          },
        }
        return api
      },
    }
  }
  return { collection, stores }
}

type CloudFn = (event: Record<string, unknown>) => Promise<Record<string, unknown>>

function loadCloudFunction(sdk: unknown): CloudFn {
  const src = readFileSync(
    fileURLToPath(new URL('../cloudfunctions/weightPlan/index.js', import.meta.url)),
    'utf8'
  )
  const mod = { exports: {} as Record<string, unknown> }
  const fakeRequire = (id: string): unknown => (id === 'wx-server-sdk' ? sdk : require(id))
  new Function('require', 'module', 'exports', src)(fakeRequire, mod, mod.exports)
  return mod.exports.main as CloudFn
}

let db: ReturnType<typeof makeDatabase>
let main: CloudFn
let openid: string | undefined = 'openid-a'
let storage: Map<string, unknown>
let callCount = 0

/** 换一个「用户」：清掉本机存储 + 换 openid，模拟另一台手机 */
function useUser(id: string): void {
  openid = id
  storage = new Map()
}

function seedLocal(points: { date: string; weight: number }[]): void {
  points.forEach((p) => upsertRecord(p.date, p.weight))
}

beforeEach(() => {
  env.id = 'test-env'
  callCount = 0
  db = makeDatabase()
  main = loadCloudFunction({
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    getWXContext: () => ({ OPENID: openid }),
    database: () => ({ collection: db.collection }),
  })
  useUser('openid-a')
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
        callCount += 1
        expect(param.name).toBe('weightPlan')
        return { result: await main(param.data || {}) }
      },
    },
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('toPlanPoints：上传前的数据裁剪', () => {
  it('只保留 date 与 weight，备注之类的一律不上云', () => {
    const rows = [
      { date: '2026-09-01', weight: 70, note: '聚餐后', _id: 'r_1', createdAt: 1 },
      { date: '2026-09-02', weight: 69.5, note: '' },
    ]
    expect(toPlanPoints(rows)).toEqual([
      { date: '2026-09-01', weight: 70 },
      { date: '2026-09-02', weight: 69.5 },
    ])
  })

  it('按日期升序，并保留 1 位小数', () => {
    expect(
      toPlanPoints([
        { date: '2026-09-03', weight: 68.4444 },
        { date: '2026-09-01', weight: 70 },
      ])
    ).toEqual([
      { date: '2026-09-01', weight: 70 },
      { date: '2026-09-03', weight: 68.4 },
    ])
  })

  it('超过上限时只留最近的 PLAN_POINT_LIMIT 条', () => {
    const rows = Array.from({ length: PLAN_POINT_LIMIT + 5 }, (_, i) => ({
      date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      weight: 70,
    }))
    const out = toPlanPoints(rows)
    expect(out).toHaveLength(PLAN_POINT_LIMIT)
    expect(out[0].date).toBe(rows[5].date)
  })
})

describe('云函数 weightPlan', () => {
  it('create 生成 6 位邀请码，并把自己写进成员表', async () => {
    const res = await main({
      action: 'create',
      name: '夏天一起瘦',
      nickname: '小明',
      points: [{ date: '2026-09-01', weight: 70 }],
    })
    expect(res.ok).toBe(true)
    const plan = res.plan as { id: string; name: string; code: string }
    expect(plan.code).toMatch(/^[A-Z0-9]{6}$/)
    expect(plan.name).toBe('夏天一起瘦')

    const members = (await main({ action: 'members', planId: plan.id })).members as {
      nickname: string
      points: unknown[]
      isMe: boolean
    }[]
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ nickname: '小明', isMe: true })
    expect(members[0].points).toEqual([{ date: '2026-09-01', weight: 70 }])
  })

  it('两个计划的邀请码不同', async () => {
    const a = await main({ action: 'create', name: 'A', nickname: 'a' })
    const b = await main({ action: 'create', name: 'B', nickname: 'b' })
    expect((a.plan as { code: string }).code).not.toBe((b.plan as { code: string }).code)
  })

  it('join 时邀请码大小写 / 空格都会被归一', async () => {
    const created = (await main({ action: 'create', name: 'P', nickname: 'a' })).plan as {
      code: string
    }
    const res = await main({ action: 'join', code: ` ${created.code.toLowerCase()} `, nickname: 'b' })
    expect(res.ok).toBe(true)
    expect((res.plan as { code: string }).code).toBe(created.code)
  })

  it('邀请码不存在 / 格式不对 → NO_PLAN / BAD_CODE', async () => {
    await expect(main({ action: 'join', code: 'ZZZZZZ', nickname: 'b' })).resolves.toMatchObject({
      ok: false,
      code: 'NO_PLAN',
    })
    await expect(main({ action: 'join', code: 'ABC', nickname: 'b' })).resolves.toMatchObject({
      ok: false,
      code: 'BAD_CODE',
    })
  })

  it('两个人的 push 互不影响（每人一个独立 doc）', async () => {
    const plan = (await main({ action: 'create', name: 'P', nickname: 'a' })).plan as { id: string }
    useUser('openid-b')
    await main({ action: 'join', code: plan.id, nickname: 'b' })

    await main({ action: 'push', planId: plan.id, points: [{ date: '2026-09-02', weight: 65 }] })
    useUser('openid-a')
    await main({ action: 'push', planId: plan.id, points: [{ date: '2026-09-02', weight: 80 }] })

    const members = (await main({ action: 'members', planId: plan.id })).members as {
      nickname: string
      points: { date: string; weight: number }[]
      isMe: boolean
    }[]
    expect(members).toHaveLength(2)
    const mine = members.find((m) => m.isMe)
    const other = members.find((m) => !m.isMe)
    expect(mine?.points).toEqual([{ date: '2026-09-02', weight: 80 }])
    expect(other?.points).toEqual([{ date: '2026-09-02', weight: 65 }])
  })

  it('members 不返回 openid，isMe 只标在调用者自己那一条', async () => {
    const plan = (await main({ action: 'create', name: 'P', nickname: 'a' })).plan as { id: string }
    useUser('openid-b')
    await main({ action: 'join', code: plan.id, nickname: 'b' })

    const res = await main({ action: 'members', planId: plan.id })
    const members = res.members as Record<string, unknown>[]
    expect(members.filter((m) => m.isMe === true)).toHaveLength(1)
    expect(members.find((m) => m.isMe === true)?.nickname).toBe('b')
    // openid 既不在字段里，也不能从 id / _id 里反推出来
    members.forEach((m) => {
      expect(m.openid).toBeUndefined()
      expect(String(m.id)).not.toContain('openid')
    })
    expect(JSON.stringify(members)).not.toContain('openid')
  })

  it('push 会丢掉非法点，并把超量点截断', async () => {
    const plan = (await main({ action: 'create', name: 'P', nickname: 'a' })).plan as { id: string }
    const tooMany = Array.from({ length: PLAN_POINT_LIMIT + 3 }, (_, i) => ({
      date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      weight: 70,
    }))
    await main({
      action: 'push',
      planId: plan.id,
      points: [
        { date: '2026-09-01', weight: WEIGHT_RANGE.min },
        { date: '2026-09-02', weight: 999 }, // 超区间，丢
        { date: '2026-13-40', weight: 70 }, // 非法日期，丢
        { date: '2026-09-03', weight: WEIGHT_RANGE.max },
        ...tooMany,
      ] as unknown as Record<string, unknown>[],
    })

    const points = ((await main({ action: 'members', planId: plan.id })).members as {
      isMe: boolean
      points: { date: string; weight: number }[]
    }[])[0].points
    expect(points).toHaveLength(PLAN_POINT_LIMIT)
    expect(points.every((p) => p.weight >= WEIGHT_RANGE.min && p.weight <= WEIGHT_RANGE.max)).toBe(true)
    // 被截断的是最早的那些，最靠后的合法点必须还在
    expect(points.some((p) => p.date === '2026-09-03')).toBe(true)
  })

  it('人满之后第 11 个人加入 → FULL（自己已在册除外）', async () => {
    const plan = (await main({ action: 'create', name: 'P', nickname: 'a' })).plan as { id: string }
    for (let i = 2; i <= 10; i++) {
      useUser(`openid-${i}`)
      await expect(main({ action: 'join', code: plan.id, nickname: `n${i}` })).resolves.toMatchObject({
        ok: true,
      })
    }
    useUser('openid-11')
    await expect(main({ action: 'join', code: plan.id, nickname: 'n11' })).resolves.toMatchObject({
      ok: false,
      code: 'FULL',
    })
    // 已经在计划里的人改昵称不受名额限制
    useUser('openid-2')
    await expect(main({ action: 'join', code: plan.id, nickname: '改名了' })).resolves.toMatchObject({
      ok: true,
    })
  })

  it('leave 只删掉自己，别人还在', async () => {
    const plan = (await main({ action: 'create', name: 'P', nickname: 'a' })).plan as { id: string }
    useUser('openid-b')
    await main({ action: 'join', code: plan.id, nickname: 'b' })
    await main({ action: 'leave', planId: plan.id })

    const members = (await main({ action: 'members', planId: plan.id })).members as {
      nickname: string
    }[]
    expect(members.map((m) => m.nickname)).toEqual(['a'])
  })

  it('集合没建 → NO_COLLECTION，而不是含糊的 INTERNAL', async () => {
    const broken = loadCloudFunction({
      DYNAMIC_CURRENT_ENV: 'test-env',
      init() {},
      getWXContext: () => ({ OPENID: openid }),
      database: () => ({
        collection: () => {
          throw new Error('collection not exists')
        },
      }),
    })
    await expect(broken({ action: 'create', name: 'P', nickname: 'a' })).resolves.toMatchObject({
      ok: false,
      code: 'NO_COLLECTION',
    })
  })
})

describe('客户端 models/plan', () => {
  it('createPlan 之后本机记住计划，code 是 6 位', async () => {
    seedLocal([{ date: '2026-09-01', weight: 70 }])
    const plan = await createPlan('夏天一起瘦', '小明')
    expect(plan.code).toMatch(/^[A-Z0-9]{6}$/)
    expect(loadPlan()).toMatchObject({ planId: plan.code, name: '夏天一起瘦', nickname: '小明' })
  })

  it('joinPlan 之后本机记住计划，并能拉到成员', async () => {
    const created = await createPlan('P', 'a')
    useUser('openid-b')
    seedLocal([{ date: '2026-09-05', weight: 65 }])
    await joinPlan(created.code, 'b')

    const res = await fetchMembers()
    expect(res?.plan.code).toBe(created.code)
    const mine = res?.members.find((m) => m.isMe)
    expect(mine?.nickname).toBe('b')
    expect(mine?.points).toEqual([{ date: '2026-09-05', weight: 65 }])
  })

  it('pushMyPoints 只传日期和体重，备注留在本地', async () => {
    const created = await createPlan('P', 'a')
    upsertRecord('2026-09-07', 69.5, '今天的备注')

    await expect(pushMyPoints()).resolves.toBe(true)

    const remote = (await main({ action: 'members', planId: created.id })).members as {
      isMe: boolean
      points: Record<string, unknown>[]
    }[]
    expect(remote[0].points).toEqual([{ date: '2026-09-07', weight: 69.5 }])
    expect(JSON.stringify(remote)).not.toContain('备注')
  })

  it('没加入计划时 pushMyPoints 直接返回 false，一次云调用都不发', async () => {
    seedLocal([{ date: '2026-09-01', weight: 70 }])
    await expect(pushMyPoints()).resolves.toBe(false)
    expect(callCount).toBe(0)
  })

  it('leavePlan 抹掉本机记录', async () => {
    await createPlan('P', 'a')
    await leavePlan()
    expect(loadPlan()).toBeNull()
  })

  it('云函数报错时抛出能直接 toast 的人话', async () => {
    await expect(joinPlan('ZZZZZZ', 'b')).rejects.toThrow('邀请码不存在')
  })

  it('没配云环境 ID 时整个功能关闭', async () => {
    env.id = ''
    expect(isPlanEnabled()).toBe(false)
    await expect(pushMyPoints()).resolves.toBe(false)
    await expect(createPlan('P', 'a')).rejects.toThrow('未开启云同步')
    expect(callCount).toBe(0)
  })
})
