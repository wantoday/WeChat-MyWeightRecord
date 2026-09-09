import { describe, expect, it } from 'vitest'
import {
  mergeProfile,
  mergeRecords,
  mergeSnapshot,
  mergeUnit,
  sanitizeSnapshot,
  snapshotEquals,
} from '../miniprogram/utils/merge'
import type { SyncSnapshot, UnitPref, UserProfile, WeightRecord } from '../miniprogram/models/types'

/**
 * 合并逻辑测试 —— 跨设备同步的核心语义全在这里，纯函数、不依赖 wx。
 * 重点：逐条 last-write-wins（按 date 为 key，平手本地赢）+ 删除墓碑的双向传播。
 */

const NOW = 1_700_000_000_000

function rec(
  date: string,
  weight: number,
  updatedAt: number,
  extra: Partial<WeightRecord> = {}
): WeightRecord {
  return { _id: `r_${date}`, date, weight, createdAt: updatedAt, updatedAt, ...extra }
}

function profile(heightCm: number, targetWeight: number, updatedAt: number): UserProfile {
  return { _id: 'profile_local', heightCm, targetWeight, updatedAt }
}

function unit(unit: 'jin' | 'kg', updatedAt: number): UnitPref {
  return { unit, updatedAt }
}

function snap(records: WeightRecord[], p: UserProfile, u: UnitPref): SyncSnapshot {
  return { records, profile: p, unit: u }
}

const EMPTY_PROFILE = profile(0, 0, 0)
const EMPTY_UNIT = unit('jin', 0)

describe('mergeRecords', () => {
  it('远端为空 → 保留本地', () => {
    const local = [rec('2026-09-01', 70, 100)]
    expect(mergeRecords(local, [])).toEqual(local)
  })

  it('本地为空 → 取远端', () => {
    const remote = [rec('2026-09-01', 70, 100)]
    expect(mergeRecords([], remote)).toEqual(remote)
  })

  it('同一天两端都有 → updatedAt 大的赢', () => {
    const local = [rec('2026-09-01', 70, 100)]
    const remote = [rec('2026-09-01', 72, 200)]
    expect(mergeRecords(local, remote)[0].weight).toBe(72)
  })

  it('同一天本地更新 → 本地赢', () => {
    const local = [rec('2026-09-01', 70, 300)]
    const remote = [rec('2026-09-01', 72, 200)]
    expect(mergeRecords(local, remote)[0].weight).toBe(70)
  })

  it('updatedAt 相等 → 本地赢（本机刚改的更符合预期）', () => {
    const local = [rec('2026-09-01', 70, 200)]
    const remote = [rec('2026-09-01', 72, 200)]
    expect(mergeRecords(local, remote)[0].weight).toBe(70)
  })

  it('远端墓碑 vs 本地更新的记录 → 本地赢，记录复活', () => {
    const local = [rec('2026-09-01', 70, 200)]
    const remote = [rec('2026-09-01', 72, 100, { deleted: true })]
    const merged = mergeRecords(local, remote)
    expect(merged).toHaveLength(1)
    expect(merged[0].deleted).toBeUndefined()
    expect(merged[0].weight).toBe(70)
  })

  it('本地墓碑 vs 远端更旧的记录 → 墓碑赢，删除能同步出去', () => {
    const local = [rec('2026-09-01', 70, 200, { deleted: true })]
    const remote = [rec('2026-09-01', 72, 100)]
    const merged = mergeRecords(local, remote)
    expect(merged).toHaveLength(1)
    expect(merged[0].deleted).toBe(true)
  })

  it('两边不同的天 → 都保留，按 date 升序', () => {
    const local = [rec('2026-09-02', 70, 100)]
    const remote = [rec('2026-09-01', 71, 100), rec('2026-09-03', 69, 100)]
    expect(mergeRecords(local, remote).map((r) => r.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ])
  })
})

describe('mergeSnapshot', () => {
  it('remote 为 null（远端还没有数据）→ 结果就是本地', () => {
    const local = snap([rec('2026-09-01', 70, 100)], profile(175, 65, 100), unit('kg', 100))
    expect(mergeSnapshot(local, null)).toBe(local)
  })

  it('profile 按 updatedAt 胜出', () => {
    const local = profile(170, 60, 100)
    const remote = profile(180, 70, 200)
    expect(mergeProfile(local, remote).heightCm).toBe(180)
    expect(mergeProfile(remote, local).heightCm).toBe(180)
  })

  it('unit 按 updatedAt 胜出', () => {
    expect(mergeUnit(unit('jin', 100), unit('kg', 200)).unit).toBe('kg')
    expect(mergeUnit(unit('jin', 300), unit('kg', 200)).unit).toBe('jin')
  })

  it('合并结果满足「每天一条」且按 date 升序', () => {
    const local = [rec('2026-09-02', 70, 100), rec('2026-09-02', 71, 150)]
    const remote = [rec('2026-09-01', 72, 100), rec('2026-09-02', 73, 120)]
    const merged = mergeSnapshot(snap(local, EMPTY_PROFILE, EMPTY_UNIT), snap(remote, EMPTY_PROFILE, EMPTY_UNIT))
    expect(merged.records.map((r) => r.date)).toEqual(['2026-09-01', '2026-09-02'])
  })
})

describe('sanitizeSnapshot', () => {
  it('丢掉日期非法 / 体重非数字的脏数据', () => {
    const raw = {
      records: [
        rec('2026-09-01', 70, 100),
        { date: '2026/09/02', weight: 70, updatedAt: 100 },
        { date: '2026-09-03', weight: 'abc', updatedAt: 100 },
        null,
      ],
      profile: EMPTY_PROFILE,
      unit: EMPTY_UNIT,
    }
    const clean = sanitizeSnapshot(raw, NOW)
    expect(clean && clean.records.map((r) => r.date)).toEqual(['2026-09-01'])
  })

  it('把未来时间戳钳到 now，防时钟快的设备永久赢', () => {
    const raw = { records: [rec('2026-09-01', 70, NOW + 999999)], profile: EMPTY_PROFILE, unit: EMPTY_UNIT }
    const clean = sanitizeSnapshot(raw, NOW)
    expect(clean && clean.records[0].updatedAt).toBe(NOW)
  })

  it('远端重复日期只保留一条', () => {
    const raw = {
      records: [rec('2026-09-01', 70, 100), rec('2026-09-01', 71, 200)],
      profile: EMPTY_PROFILE,
      unit: EMPTY_UNIT,
    }
    expect(sanitizeSnapshot(raw, NOW)?.records).toHaveLength(1)
  })

  it('形状不对 → 返回 null（当作远端为空）', () => {
    expect(sanitizeSnapshot(null, NOW)).toBeNull()
    expect(sanitizeSnapshot({ records: 'nope' }, NOW)).toBeNull()
  })

  it('老格式 unit（裸字符串）兜底为 jin 且 updatedAt 为 0', () => {
    const clean = sanitizeSnapshot({ records: [], profile: EMPTY_PROFILE, unit: 'kg' }, NOW)
    expect(clean && clean.unit).toEqual({ unit: 'kg', updatedAt: 0 })
  })
})

describe('snapshotEquals', () => {
  const a = snap([rec('2026-09-01', 70, 100)], profile(175, 65, 100), unit('kg', 100))

  it('完全相同 → true', () => {
    const b = snap([rec('2026-09-01', 70, 100)], profile(175, 65, 100), unit('kg', 100))
    expect(snapshotEquals(a, b)).toBe(true)
  })

  it('体重 / 墓碑 / profile 任一不同 → false', () => {
    expect(snapshotEquals(a, snap([rec('2026-09-01', 71, 100)], EMPTY_PROFILE, EMPTY_UNIT))).toBe(false)
    expect(
      snapshotEquals(a, snap([rec('2026-09-01', 70, 100, { deleted: true })], profile(175, 65, 100), unit('kg', 100)))
    ).toBe(false)
    expect(snapshotEquals(a, snap([rec('2026-09-01', 70, 100)], profile(176, 65, 100), unit('kg', 100)))).toBe(false)
  })
})
