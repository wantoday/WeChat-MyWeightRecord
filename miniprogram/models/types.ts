/**
 * 数据模型定义 —— 客户端与 local-server 共用同一套形状。
 *
 * 服务端已有的 JSON 文件不会自动迁移：新增字段一律给可选或在读取处兜默认值，
 * 并同步 local-server/server.js 的 PROFILE_DEFAULTS（否则客户端存了会被静默丢弃）。
 */

/** 一条体重记录。约束：date 唯一（由 server.js 的 upsertRecord 保证）。 */
export interface WeightRecord {
  _id: string
  /** 'YYYY-MM-DD'。用字符串而非 Date：便于按天 upsert、字典序即时间序、免时区问题 */
  date: string
  /** 单位 kg，保留 1 位小数 */
  weight: number
  note?: string
  /** 毫秒时间戳 */
  createdAt: number
  updatedAt: number
  /**
   * 软删除墓碑：true 表示这一天的记录已删除。
   * 不展示、但必须保留 —— 否则「删除」这件事同步不到别的设备。
   * 老数据没有这个键，等价于未删除。
   */
  deleted?: true
}

/** 用户档案。本地服务单人使用，全局只有一份（_id 固定为 'profile_local'）。 */
export interface UserProfile {
  _id: string
  /** 身高，cm。0 表示未填写 —— BMI 相关 UI 需据此隐藏 */
  heightCm: number
  /** 目标体重，kg。0 表示未设定 */
  targetWeight: number
  updatedAt: number
}

/** 体重录入/展示单位：存储统一用 kg，斤仅用于打卡页的录入与展示换算 */
export type WeightUnit = 'jin' | 'kg'

/** BMI 分级 */
export type BmiLevel = 'underweight' | 'normal' | 'overweight' | 'obese'

export interface BmiResult {
  value: number
  level: BmiLevel
  label: string
  /** 用于 UI 着色 */
  color: string
}

/** 图表的时间范围 */
export type ChartRange = 'week' | 'month' | 'all'

/**
 * 单位偏好 + 它的最后修改时间。
 * 单独一个 'jin' / 'kg' 无法判断谁更新，带上 updatedAt 才能做 last-write-wins。
 */
export interface UnitPref {
  unit: WeightUnit
  updatedAt: number
}

/** 一次同步上传 / 下载的全部数据。整体读写，不做增量协议（数据量很小）。 */
export interface SyncSnapshot {
  records: WeightRecord[]
  profile: UserProfile
  unit: UnitPref
}

/** 同步状态。只存在本机，从不上云。 */
export interface SyncMeta {
  /** 上次成功同步的服务器时间戳，0 表示从未同步过 */
  lastSyncAt: number
  /** 是否已成功连上过云 —— 即「已绑定」 */
  bound: boolean
}

/**
 * 上传到好友计划的点。**只有日期和体重** ——
 * 备注、身高、目标体重一律不上云：计划里别人只需要知道「哪天多重」。
 */
export interface PlanPoint {
  /** 'YYYY-MM-DD' */
  date: string
  /** kg，1 位小数 */
  weight: number
}

/**
 * 计划里的一个成员（服务端返回的形状）。
 * 注意没有 openid —— 服务端会剥掉，客户端拿别人的 openid 也没用。
 */
export interface PlanMember {
  /** 列表用的稳定 key（按 joinedAt 升序编号），不含 openid */
  id: string
  nickname: string
  points: PlanPoint[]
  updatedAt: number
  /** 是不是「我」—— 客户端拿不到自己的 openid，只能靠服务端标记 */
  isMe: boolean
}

/** 计划概要。id 与 code 同一个值：6 位邀请码就是 plan 的 _id。 */
export interface PlanInfo {
  id: string
  name: string
  code: string
}

/** 本机记住的「我加入了哪个计划」。只存在本机，从不上云。 */
export interface PlanLocal {
  planId: string
  name: string
  code: string
  nickname: string
  joinedAt: number
}
