/** 数据模型定义。改动这里时，云数据库里的既有文档不会自动迁移 —— 新增字段一律给可选或在读取处兜默认值。 */

/** 一条体重记录。约束：同一 _openid 下 date 唯一（由 record.upsertByDate 保证，数据库层无唯一索引）。 */
export interface WeightRecord {
  _id: string
  /** 云开发自动写入，客户端不要手动赋值 */
  _openid?: string
  /** 'YYYY-MM-DD'。用字符串而非 Date：便于按天 upsert、字典序即时间序、免时区问题 */
  date: string
  /** 单位 kg，保留 1 位小数 */
  weight: number
  note?: string
  /** 毫秒时间戳 */
  createdAt: number
  updatedAt: number
}

/** 用户档案，每个 _openid 一条。 */
export interface UserProfile {
  _id: string
  _openid?: string
  /** 身高，cm。0 表示未填写 —— BMI 相关 UI 需据此隐藏 */
  heightCm: number
  /** 目标体重，kg。0 表示未设定 */
  targetWeight: number
  reminderEnabled: boolean
  /** 提醒时间，0-23 整点 */
  reminderHour: number
  updatedAt: number
}

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
