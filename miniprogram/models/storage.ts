import { WEIGHT_RANGE } from '../config'
import type {
  PlanLocal,
  SyncMeta,
  UnitPref,
  UserProfile,
  WeightRecord,
  WeightUnit,
} from './types'

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
const SYNC_META_KEY = 'weight_sync_meta'
const PLAN_KEY = 'weight_plan'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function compareByDate(a: { date: string }, b: { date: string }): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0
}

/** 读取全部记录（按 date 升序），并兜底清洗脏数据 */
/** 读取全部记录（按 date 升序），并兜底清洗脏数据。已删除的墓碑不返回 —— 页面无感。 */
export function loadRecords(): WeightRecord[] {
  return loadRawRecords().filter((r) => !r.deleted)
}

/**
 * 读取全部记录（含已删除的墓碑），按 date 升序。
 * 只给同步层用：墓碑本身也要能同步到别的设备，不能在读取时就丢掉。
 */
export function loadRawRecords(): WeightRecord[] {
  const raw = wx.getStorageSync(RECORDS_KEY)
  if (!Array.isArray(raw)) return []
  return (raw as WeightRecord[])
    .filter((r) => r && typeof r.date === 'string' && typeof r.weight === 'number')
    .sort(compareByDate)
}

/** 整体覆盖写入记录数组（含墓碑）。只给同步层用：页面写入一律走 upsertRecord。 */
export function saveRawRecords(rows: WeightRecord[]): void {
  saveRecords(rows)
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

  const rows = loadRawRecords()
  const found = rows.find((r) => r.date === date)
  const now = Date.now()

  if (found) {
    const updated: WeightRecord = { ...found, weight, updatedAt: now }
    if (found.deleted) delete updated.deleted // 复活：重新记录同一天，清掉墓碑
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
/** 按 _id 删除，返回是否真的删掉了。软删除：保留墓碑，否则别的设备无从得知删除 */
export function removeRecordById(id: string): boolean {
  const rows = loadRawRecords()
  const found = rows.find((r) => r._id === id)
  if (!found) return false
  rows[rows.indexOf(found)] = { ...found, deleted: true, updatedAt: Date.now() }
  saveRecords(rows)
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
/**
 * 读取单位偏好及其最后修改时间。
 * 向后兼容：老版本在 UNIT_KEY 下存的是裸字符串 'jin' / 'kg'，那时没有时间戳 ——
 * 兜底为 0，这样同步时老数据永远不赢远端。
 */
export function loadUnitPref(): UnitPref {
  const v: unknown = wx.getStorageSync(UNIT_KEY)
  if (v && typeof v === 'object') {
    const p = v as Partial<UnitPref>
    if (p.unit === 'kg' || p.unit === 'jin') {
      return { unit: p.unit, updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0 }
    }
  }
  if (v === 'kg') return { unit: 'kg', updatedAt: 0 }
  return { unit: 'jin', updatedAt: 0 }
}

export function saveUnitPref(pref: UnitPref): void {
  wx.setStorageSync(UNIT_KEY, pref)
}

/** 读取体重单位偏好，默认斤（打卡页专用，存储仍统一 kg） */
export function loadWeightUnit(): WeightUnit {
  return loadUnitPref().unit
}

export function saveWeightUnit(unit: WeightUnit): void {
  saveUnitPref({ unit, updatedAt: Date.now() })
}

/**
 * 整体覆盖档案。只给同步层用 ——
 * saveProfile 会把 updatedAt 刷成 now，那样就丢掉了远端记录的时间戳。
 */
export function saveRawProfile(profile: UserProfile): void {
  wx.setStorageSync(PROFILE_KEY, profile)
}

/** 读取同步状态（上次同步时间、是否已绑定）。只存在本机，从不上云。 */
export function loadSyncMeta(): SyncMeta {
  const raw: unknown = wx.getStorageSync(SYNC_META_KEY)
  if (raw && typeof raw === 'object') {
    const m = raw as Partial<SyncMeta>
    return {
      lastSyncAt: typeof m.lastSyncAt === 'number' ? m.lastSyncAt : 0,
      bound: m.bound === true,
    }
  }
  return { lastSyncAt: 0, bound: false }
}

export function saveSyncMeta(meta: SyncMeta): void {
  wx.setStorageSync(SYNC_META_KEY, meta)
}

/**
 * 本机加入的减肥计划；没加入过返回 null。
 * 字段缺失一律当成「没加入」—— 不做迁移，宁可让用户重新输一次邀请码，
 * 也好过拿半个 planId 去请求云端。
 */
export function loadPlanLocal(): PlanLocal | null {
  const raw: unknown = wx.getStorageSync(PLAN_KEY)
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<PlanLocal>
  if (typeof p.planId !== 'string' || !p.planId) return null
  if (typeof p.code !== 'string' || !p.code) return null
  return {
    planId: p.planId,
    name: typeof p.name === 'string' ? p.name : '',
    code: p.code,
    nickname: typeof p.nickname === 'string' ? p.nickname : '',
    joinedAt: typeof p.joinedAt === 'number' ? p.joinedAt : 0,
  }
}

export function savePlanLocal(plan: PlanLocal): void {
  wx.setStorageSync(PLAN_KEY, plan)
}

/** 退出计划：抹掉本机记录。云端的成员数据由云函数删除，不归这里管。 */
export function clearPlanLocal(): void {
  wx.removeStorageSync(PLAN_KEY)
}
