import type { SyncSnapshot, UnitPref, UserProfile, WeightRecord, WeightUnit } from '../models/types'

/**
 * 多设备合并逻辑 —— 纯函数：不碰 wx API、不调 Date.now()（时间由参数传入）。
 *
 * 策略是逐条 last-write-wins，按 date 做 key：
 *   - 「每天一条」是本 App 的核心不变量，date 天然唯一，比 _id 更适合当合并键；
 *   - 删除是软删除（墓碑），墓碑也带 updatedAt，所以 LWW 不用为它特判：
 *     远端墓碑赢 → 本地那条也被标记删除；本地新记录赢 → 墓碑被清掉，记录复活。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function byDate(a: { date: string }, b: { date: string }): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
}

/**
 * 时间戳归一化。钳到 now 是关键：设备时钟偏快的那台，
 * 它写的记录会永久赢过其它设备 —— 钳位把这种偏差限制在「刚刚」。
 */
function clampTs(v: unknown, now: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), now) : 0
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function isWeightUnit(v: unknown): v is WeightUnit {
  return v === 'jin' || v === 'kg'
}

function sanitizeRecord(raw: unknown, now: number): WeightRecord | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.date !== 'string' || !DATE_RE.test(raw.date)) return null
  if (typeof raw.weight !== 'number' || !Number.isFinite(raw.weight)) return null

  const updatedAt = clampTs(raw.updatedAt, now)
  const createdAt = clampTs(raw.createdAt, now)
  const record: WeightRecord = {
    _id: typeof raw._id === 'string' && raw._id ? raw._id : `r_${raw.date}`,
    date: raw.date,
    weight: raw.weight,
    updatedAt,
    createdAt: createdAt || updatedAt,
  }
  if (typeof raw.note === 'string') record.note = raw.note
  if (raw.deleted === true) record.deleted = true
  return record
}

function sanitizeProfile(raw: unknown, now: number): UserProfile {
  if (!isPlainObject(raw)) return { _id: 'profile_local', heightCm: 0, targetWeight: 0, updatedAt: 0 }
  const pick = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0
  return {
    _id: 'profile_local',
    heightCm: pick(raw.heightCm),
    targetWeight: pick(raw.targetWeight),
    updatedAt: clampTs(raw.updatedAt, now),
  }
}

function sanitizeUnit(raw: unknown, now: number): UnitPref {
  const unit = isPlainObject(raw) ? raw.unit : raw
  if (!isWeightUnit(unit)) return { unit: 'jin', updatedAt: 0 }
  // 老格式（裸字符串）没有时间戳可比对，兜底为 0 —— 老数据永远不赢远端
  return { unit, updatedAt: isPlainObject(raw) ? clampTs(raw.updatedAt, now) : 0 }
}

/**
 * 校验并清洗一份远端快照。返回 null 表示远端这份数据不可用（当作「远端为空」）。
 * 远端数据来自网络，形状不可信 —— 脏数据必须在这里挡掉，不能流进本地存储。
 */
export function sanitizeSnapshot(raw: unknown, now: number): SyncSnapshot | null {
  if (!isPlainObject(raw) || !Array.isArray(raw.records)) return null

  const records: WeightRecord[] = []
  const seen = new Set<string>()
  for (const item of raw.records) {
    const record = sanitizeRecord(item, now)
    if (!record || seen.has(record.date)) continue // 远端重复也只取一条，守住「每天一条」
    seen.add(record.date)
    records.push(record)
  }
  records.sort(byDate)

  return {
    records,
    profile: sanitizeProfile(raw.profile, now),
    unit: sanitizeUnit(raw.unit, now),
  }
}

/** 逐条 LWW 合并。先铺远端，再用本地覆盖 —— 平手算本地赢（本机刚改的更符合预期）。 */
export function mergeRecords(local: WeightRecord[], remote: WeightRecord[]): WeightRecord[] {
  const byDateMap = new Map<string, WeightRecord>()
  for (const r of remote) byDateMap.set(r.date, r)
  for (const l of local) {
    const r = byDateMap.get(l.date)
    if (!r || l.updatedAt >= r.updatedAt) byDateMap.set(l.date, l)
  }
  return Array.from(byDateMap.values()).sort(byDate)
}

export function mergeProfile(local: UserProfile, remote: UserProfile): UserProfile {
  return remote.updatedAt > local.updatedAt ? { ...remote, _id: 'profile_local' } : local
}

export function mergeUnit(local: UnitPref, remote: UnitPref): UnitPref {
  return remote.updatedAt > local.updatedAt ? remote : local
}

/**
 * 合并两份快照。remote 为 null 表示远端还没有数据（首次绑定），结果就是本地。
 * 传入前请确保 remote 已经过 sanitizeSnapshot。
 */
export function mergeSnapshot(local: SyncSnapshot, remote: SyncSnapshot | null): SyncSnapshot {
  if (!remote) return local
  return {
    records: mergeRecords(local.records, remote.records),
    profile: mergeProfile(local.profile, remote.profile),
    unit: mergeUnit(local.unit, remote.unit),
  }
}

/** 判断合并结果是否与远端一致 —— 一致就没必要回写，省一次 push。 */
export function snapshotEquals(a: SyncSnapshot, b: SyncSnapshot): boolean {
  if (
    a.profile.heightCm !== b.profile.heightCm ||
    a.profile.targetWeight !== b.profile.targetWeight ||
    a.profile.updatedAt !== b.profile.updatedAt
  ) {
    return false
  }
  if (a.unit.unit !== b.unit.unit || a.unit.updatedAt !== b.unit.updatedAt) return false
  if (a.records.length !== b.records.length) return false
  for (let i = 0; i < a.records.length; i++) {
    const x = a.records[i]
    const y = b.records[i]
    if (
      x.date !== y.date ||
      x.weight !== y.weight ||
      x.updatedAt !== y.updatedAt ||
      (x.note ?? '') !== (y.note ?? '') ||
      (x.deleted === true) !== (y.deleted === true)
    ) {
      return false
    }
  }
  return true
}
