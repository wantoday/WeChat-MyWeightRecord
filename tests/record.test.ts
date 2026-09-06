import { beforeEach, describe, expect, it } from 'vitest'
import * as record from '../miniprogram/models/record'

/**
 * 数据访问层测试：用一个假的 wx 本地存储顶替小程序运行时，
 * 验证「页面调用 → 读写手机存储 → 数据形状」这一层的逻辑。
 *
 * 重点覆盖两条容易回归的设计：
 *  1. 每天一条：同一天写入是覆盖而不是新增；
 *  2. 只改体重、不传 note 时，不会清掉已有备注。
 */

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
  }
}

function seed(dates: [string, number][]): void {
  // 直接写一份符合存储格式的数组，模拟手机里已有的历史数据
  const rows = dates.map(([date, weight]) => ({
    _id: `r_${date}`,
    date,
    weight,
    note: '',
    createdAt: 1,
    updatedAt: 1,
  }))
  wx.setStorageSync('weight_records', rows)
}

beforeEach(() => {
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

  it('getBefore 返回所选日期之前最近一条，无则 null', async () => {
    expect((await record.getBefore('2026-09-01'))?.date).toBe('2026-08-31')
    expect((await record.getBefore('2026-09-03'))?.date).toBe('2026-09-02')
    expect(await record.getBefore('2026-08-30')).toBeNull()
    expect(await record.getBefore('2026-07-01')).toBeNull()
  })

  it('countRecords 返回全部条数', async () => {
    expect(await record.countRecords()).toBe(4)
  })

  it('fetchAll 返回的数据被改动后，不影响后续读取', async () => {
    const rows = await record.fetchAll()
    rows.pop()
    expect(await record.countRecords()).toBe(4)
  })

  it('空数据时不炸', async () => {
    wx.setStorageSync('weight_records', [])
    expect(await record.getLatest()).toBeNull()
    expect(await record.getEarliest()).toBeNull()
    expect(await record.listPage(0, 20)).toEqual([])
  })
})

describe('并发读', () => {
  it('Promise.all 同时读多个视角，结果一致', async () => {
    const [recent, earliest, count] = await Promise.all([
      record.listPage(0, 2),
      record.getEarliest(),
      record.countRecords(),
    ])

    expect(recent).toHaveLength(2)
    expect(earliest?.date).toBe('2026-08-30')
    expect(count).toBe(4)
  })
})

describe('写入', () => {
  it('upsertByDate 新增一条', async () => {
    await record.upsertByDate('2026-09-03', 70.1)

    expect(await record.countRecords()).toBe(5)
    expect((await record.getByDate('2026-09-03'))?.weight).toBe(70.1)
  })

  it('同一天写入是覆盖而不是新增', async () => {
    await record.upsertByDate('2026-09-02', 69.9)
    await record.upsertByDate('2026-09-02', 69.6)

    expect(await record.countRecords()).toBe(4)
    expect((await record.getByDate('2026-09-02'))?.weight).toBe(69.6)
  })

  it('不传 note 时保留已有备注（只改体重不清备注）', async () => {
    await record.upsertByDate('2026-09-01', 70.9, '空腹')
    await record.upsertByDate('2026-09-01', 70.6)

    expect((await record.getByDate('2026-09-01'))?.note).toBe('空腹')
  })

  it('传了 note 就更新备注', async () => {
    await record.upsertByDate('2026-09-01', 70.9, '运动后')
    expect((await record.getByDate('2026-09-01'))?.note).toBe('运动后')
  })

  it('传空字符串才清空备注', async () => {
    await record.upsertByDate('2026-09-01', 70.9, '空腹')
    await record.upsertByDate('2026-09-01', 70.9, '')
    expect((await record.getByDate('2026-09-01'))?.note).toBe('')
  })

  it('写完立刻读，读到的是写后的数据', async () => {
    await record.upsertByDate('2026-09-02', 69.9)
    expect((await record.getLatest())?.weight).toBe(69.9)
  })

  it('新记录带 _id 和时间戳', async () => {
    await record.upsertByDate('2026-09-03', 70.1)
    const row = await record.getByDate('2026-09-03')
    expect(row?._id).toBe('r_2026-09-03')
    expect(typeof row?.createdAt).toBe('number')
    expect(typeof row?.updatedAt).toBe('number')
  })

  it('removeRecord 按 id 删除', async () => {
    await record.removeRecord('r_2026-09-01')

    expect(await record.getByDate('2026-09-01')).toBeNull()
    expect(await record.countRecords()).toBe(3)
  })
})

describe('校验', () => {
  it('非法日期 reject', async () => {
    await expect(record.upsertByDate('bad-date', 70)).rejects.toThrow('date 必须形如 YYYY-MM-DD')
  })

  it('体重越界 reject', async () => {
    await expect(record.upsertByDate('2026-09-03', 10)).rejects.toThrow('体重必须在')
    await expect(record.upsertByDate('2026-09-03', 301)).rejects.toThrow('体重必须在')
  })
})
