import { WEIGHT_RANGE } from '../config'
import type { UserProfile, WeightRecord, WeightUnit } from './types'

/**
 * 手机本地存储后端 —— 替代 local-server，数据直接存在手机里。
 *
 * 用微信小程序本地存储（wx.getStorageSync / wx.setStorageSync）持久化，
 * 不依赖电脑、不依赖网络，打开即用。
 *
 * 注意：小程序本地存储会随「清理微信缓存 / 卸载重装」而丢失，
 * 也不做多端同步。需要长期保留的数据，建议定期导出（见根目录 README）。
 */

const RECORDS_KEY = 'weight_records'
const PROFILE_KEY = 'weight_profile'
const UNIT_KEY = 'weight_unit'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function compareByDate(a: { date: string }, b: { date: string }): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
}

/** 读取全部记录（按 date 升序），并兜底清洗脏数据 */
export function loadRecords(): WeightRecord[] {
  const raw = wx.getStorageSync(RECORDS_KEY)
  if (!Array.isArray(raw)) return []
  return (raw as WeightRecord[])
    .filter((r) => r && typeof r.date === 'string' && typeof r.weight === 'number')
    .sort(compareByDate)
}

function saveRecords(rows: WeightRecord[]): void {
  wx.setStorageSync(RECORDS_KEY, rows)
}

/**
 * 按日期写入：当天已有则覆盖，否则新增。「每天一条」是 App 的核心不变量。
 * note 不传则保留原备注，传 '' 才清空。返回写入后的记录。
 */
export function upsertRecord(date: string, weight: number, note?: string): WeightRecord {
  if (!DATE_RE.test(date)) throw new Error('date 必须形如 YYYY-MM-DD')
  if (!(weight >= WEIGHT_RANGE.min && weight <= WEIGHT_RANGE.max)) {
    throw new Error(`体重必须在 ${WEIGHT_RANGE.min}–${WEIGHT_RANGE.max}kg 之间`)
  }

  const rows = loadRecords()
  const found = rows.find((r) => r.date === date)
  const now = Date.now()

  if (found) {
    const updated: WeightRecord = { ...found, weight, updatedAt: now }
    if (note !== undefined) updated.note = note
    rows[rows.indexOf(found)] = updated
    saveRecords(rows)
    return updated
  }

  const created: WeightRecord = {
    _id: `r_${date}`,
    date,
    weight,
    note: note ?? '',
    createdAt: now,
    updatedAt: now,
  }
  rows.push(created)
  rows.sort(compareByDate)
  saveRecords(rows)
  return created
}

/** 按 _id 删除，返回是否真的删掉了 */
export function removeRecordById(id: string): boolean {
  const rows = loadRecords()
  const next = rows.filter((r) => r._id !== id)
  if (next.length === rows.length) return false
  saveRecords(next)
  return true
}

/** 读取用户档案；无则返回默认档案（首次保存时才落盘） */
export function loadProfile(): UserProfile {
  const raw = wx.getStorageSync(PROFILE_KEY)
  if (raw && typeof raw === 'object') {
    const p = raw as Partial<UserProfile>
    return {
      _id: 'profile_local',
      heightCm: typeof p.heightCm === 'number' ? p.heightCm : 0,
      targetWeight: typeof p.targetWeight === 'number' ? p.targetWeight : 0,
      updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0,
    }
  }
  return { _id: 'profile_local', heightCm: 0, targetWeight: 0, updatedAt: 0 }
}

/** 合并更新档案：只接受已知键，刷新 updatedAt，返回最新档案 */
export function saveProfile(
  patch: Partial<Pick<UserProfile, 'heightCm' | 'targetWeight'>>
): UserProfile {
  const current = loadProfile()
  const next: UserProfile = {
    _id: 'profile_local',
    heightCm: patch.heightCm ?? current.heightCm,
    targetWeight: patch.targetWeight ?? current.targetWeight,
    updatedAt: Date.now(),
  }
  wx.setStorageSync(PROFILE_KEY, next)
  return next
}

/** 读取体重单位偏好，默认斤（打卡页专用，存储仍统一 kg） */
export function loadWeightUnit(): WeightUnit {
  const v = wx.getStorageSync(UNIT_KEY)
  return v === 'kg' ? 'kg' : 'jin'
}

export function saveWeightUnit(unit: WeightUnit): void {
  wx.setStorageSync(UNIT_KEY, unit)
}
