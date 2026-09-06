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
