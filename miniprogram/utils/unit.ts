import type { WeightUnit } from '../models/types'

/**
 * 体重单位换算。存储统一用 kg（图表 / BMI / 历史记录都基于 kg），
 * 斤只在打卡页的录入与展示时换算 —— 换算关系固定：1 斤 = 0.5 kg。
 */

/** 1 kg 对应的斤数 */
export const JIN_PER_KG = 2

/** 按单位把「用户输入/展示值」换算成 kg */
export function toKg(value: number, unit: WeightUnit): number {
  return unit === 'jin' ? value / JIN_PER_KG : value
}

/** 按单位把 kg 换算成展示值 */
export function fromKg(kg: number, unit: WeightUnit): number {
  return unit === 'jin' ? kg * JIN_PER_KG : kg
}

/**
 * 存储时的精度：kg 输入保留 1 位小数（既有约定）；
 * 斤输入保留 2 位小数 —— 否则 141.5 斤 = 70.75kg 被四舍五入成 70.8kg，
 * 下次打开会显示成 141.6 斤，出现「越记越重」的假漂移。
 */
export function roundKgForStore(kg: number, unit: WeightUnit): number {
  const digits = unit === 'jin' ? 100 : 10
  return Math.round(kg * digits) / digits
}

/** 按单位格式化展示值：去掉多余的 .0，保留自然精度（最多 2 位小数） */
export function formatWeight(kg: number, unit: WeightUnit): string {
  const v = fromKg(kg, unit)
  return String(Math.round(v * 100) / 100)
}

/** 单位的中文/缩写标签 */
export function unitLabel(unit: WeightUnit): string {
  return unit === 'jin' ? '斤' : 'kg'
}
