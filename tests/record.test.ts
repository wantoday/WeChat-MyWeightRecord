import { beforeEach, describe, expect, it } from 'vitest'
import { LOCAL_SERVER_URL } from '../miniprogram/config'
import * as record from '../miniprogram/models/record'

/**
 * 数据访问层测试：用一个假的 wx.request 顶替小程序运行时，
 * 验证「页面调用 → 发出什么请求 → 怎么解释响应」这一层的逻辑。
 *
 * 重点覆盖两条容易回归的设计：
 *  1. 同一时刻的多个读合并成一个请求（inflight）；
 *  2. 写成功后作废在飞的读，避免紧随其后的刷新读到旧快照。
 */

interface Call {
  method: string
  path: string
  data?: any
}

let calls: Call[] = []
let store: any[] = []

/** 极简的服务端替身，只实现 record.ts 用到的三个端点 */
function installFakeWx(): void {
  ;(globalThis as any).wx = {
    request(opts: any) {
      const path = String(opts.url).replace(LOCAL_SERVER_URL, '')
      calls.push({ method: opts.method, path, data: opts.data })

      // 异步返回，才能真实反映「请求还在飞」的并发场景
      setTimeout(() => {
        if (opts.method === 'GET' && path === '/api/records') {
          opts.success({ statusCode: 200, data: store.slice() })
          return
        }
        if (opts.method === 'POST' && path === '/api/records') {
          const { date, weight, note } = opts.data
          const found = store.find((r) => r.date === date)
          if (found) {
            found.weight = weight
            if (note !== undefined) found.note = note
          } else {
            store.push({ _id: `r_${date}`, date, weight, note: note ?? '' })
            store.sort((a, b) => (a.date < b.date ? -1 : 1))
          }
          opts.success({ statusCode: 200, data: { ok: true } })
          return
        }
        if (opts.method === 'DELETE' && path.startsWith('/api/records/')) {
          const id = decodeURIComponent(path.slice('/api/records/'.length))
          store = store.filter((r) => r._id !== id)
          opts.success({ statusCode: 200, data: { ok: true } })
          return
        }
        opts.success({ statusCode: 404, data: { error: 'not found' } })
      }, 0)
    },
  }
}

function seed(dates: [string, number][]): void {
  store = dates.map(([date, weight]) => ({ _id: `r_${date}`, date, weight, note: '' }))
}

beforeEach(() => {
  calls = []
  installFakeWx()
  seed([
    ['2026-08-30', 72],
    ['2026-08-31', 71.5],
    ['2026-09-01', 71],
    ['2026-09-02', 70.4],
  ])
})

describe('读取', () => {
  it('listPage 倒序分页', async () => {
    expect((await record.listPage(0, 2)).map((r) => r.date)).toEqual(['2026-09-02', '2026-09-01'])
    expect((await record.listPage(2, 2)).map((r) => r.date)).toEqual(['2026-08-31', '2026-08-30'])
    expect(await record.listPage(4, 2)).toEqual([])
  })

  it('fetchAllSince 按日期字符串过滤，结果升序', async () => {
    const rows = await record.fetchAllSince('2026-09-01')
    expect(rows.map((r) => r.date)).toEqual(['2026-09-01', '2026-09-02'])
  })

  it('getEarliest / getLatest / getByDate', async () => {
    expect((await record.getEarliest())?.date).toBe('2026-08-30')
    expect((await record.getLatest())?.date).toBe('2026-09-02')
    expect((await record.getByDate('2026-09-01'))?.weight).toBe(71)
    expect(await record.getByDate('2026-07-01')).toBeNull()
  })

  it('countRecords 返回全部条数', async () => {
    expect(await record.countRecords()).toBe(4)
  })

  it('fetchAll 返回副本，调用方改动不污染后续读取', async () => {
    const rows = await record.fetchAll()
    rows.pop()
    expect(await record.countRecords()).toBe(4)
  })

  it('空数据时不炸', async () => {
    store = []
    expect(await record.getLatest()).toBeNull()
    expect(await record.getEarliest()).toBeNull()
    expect(await record.listPage(0, 20)).toEqual([])
  })
})

describe('并发合并', () => {
  it('同时发起的多个读只打一次 /api/records', async () => {
    const [recent, earliest, count] = await Promise.all([
      record.listPage(0, 2),
      record.getEarliest(),
      record.countRecords(),
    ])

    expect(recent).toHaveLength(2)
    expect(earliest?.date).toBe('2026-08-30')
    expect(count).toBe(4)
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1)
  })

  it('先后发起的读各自重新请求，不吃过期缓存', async () => {
    await record.countRecords()
    await record.countRecords()
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2)
  })
})

describe('写入', () => {
  it('upsertByDate 发 POST /api/records', async () => {
    await record.upsertByDate('2026-09-03', 70.1)

    const post = calls.find((c) => c.method === 'POST')
    expect(post?.path).toBe('/api/records')
    expect(post?.data).toEqual({ date: '2026-09-03', weight: 70.1 })
    expect(store.map((r) => r.date)).toContain('2026-09-03')
  })

  it('不传 note 时请求体里没有 note 字段（避免清空已有备注）', async () => {
    await record.upsertByDate('2026-09-01', 70.9)
    expect(calls.find((c) => c.method === 'POST')?.data).not.toHaveProperty('note')
  })

  it('传了 note 就带上', async () => {
    await record.upsertByDate('2026-09-01', 70.9, '空腹')
    expect(calls.find((c) => c.method === 'POST')?.data).toMatchObject({ note: '空腹' })
  })

  it('写完立刻读，读到的是写后的数据', async () => {
    await record.upsertByDate('2026-09-02', 69.9)
    expect((await record.getLatest())?.weight).toBe(69.9)
  })

  it('写入后的读取不会复用写之前的在飞请求', async () => {
    const reading = record.countRecords() // 故意不 await，让它在写之前起飞
    await record.upsertByDate('2026-09-03', 70)

    expect(await reading).toBe(4) // 旧请求返回它起飞时的快照，符合预期
    expect(await record.countRecords()).toBe(5) // 写之后的读必须看到新记录
  })

  it('removeRecord 按 id 发 DELETE', async () => {
    await record.removeRecord('r_2026-09-01')

    const del = calls.find((c) => c.method === 'DELETE')
    expect(del?.path).toBe('/api/records/r_2026-09-01')
    expect(store.map((r) => r.date)).not.toContain('2026-09-01')
    expect(await record.countRecords()).toBe(3)
  })
})

describe('错误处理', () => {
  it('非 2xx 响应 reject，并带上服务端的 error 文案', async () => {
    ;(globalThis as any).wx = {
      request(opts: any) {
        setTimeout(() => opts.success({ statusCode: 400, data: { error: 'date 必须形如 YYYY-MM-DD' } }), 0)
      },
    }
    await expect(record.upsertByDate('bad-date', 70)).rejects.toThrow('date 必须形如 YYYY-MM-DD')
  })

  it('连不上服务时的报错提示里带地址和启动方式', async () => {
    ;(globalThis as any).wx = {
      request(opts: any) {
        setTimeout(() => opts.fail({ errMsg: 'request:fail' }), 0)
      },
    }
    await expect(record.countRecords()).rejects.toThrow('start-server.bat')
  })
})
