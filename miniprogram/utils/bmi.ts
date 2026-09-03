import { BMI_THRESHOLDS } from '../config'
import type { BmiResult } from '../models/types'

/**
 * BMI 计算与分级。分级用中国成人标准（超重 ≥24、肥胖 ≥28），
 * 比 WHO 标准（25 / 30）更严 —— 改标准就改 config.BMI_THRESHOLDS。
 */
export function calcBmi(weightKg: number, heightCm: number): BmiResult | null {
  if (!weightKg || !heightCm) return null
  const m = heightCm / 100
  const value = Math.round((weightKg / (m * m)) * 10) / 10

  if (value < BMI_THRESHOLDS.underweight) {
    return { value, level: 'underweight', label: '偏瘦', color: '#4a90d9' }
  }
  if (value < BMI_THRESHOLDS.normal) {
    return { value, level: 'normal', label: '正常', color: '#34c759' }
  }
  if (value < BMI_THRESHOLDS.overweight) {
    return { value, level: 'overweight', label: '超重', color: '#ff9500' }
  }
  return { value, level: 'obese', label: '肥胖', color: '#ff3b30' }
}

/** 由身高反推「正常」BMI 区间对应的体重区间，用于给目标体重做参考提示 */
export function healthyWeightRange(heightCm: number): { min: number; max: number } | null {
  if (!heightCm) return null
  const m = heightCm / 100
  return {
    min: Math.round(BMI_THRESHOLDS.underweight * m * m * 10) / 10,
    max: Math.round((BMI_THRESHOLDS.normal - 0.1) * m * m * 10) / 10,
  }
}

/**
 * 减重/增重进度百分比。
 * start 为起始体重（首条记录），current 当前，target 目标。
 * 返回 0-100；方向自适应（减重和增重都按「已走完的比例」算）。
 */
export function targetProgress(start: number, current: number, target: number): number {
  if (!target || !start) return 0
  const total = start - target
  if (Math.abs(total) < 0.05) return current === target ? 100 : 0
  const done = start - current
  const pct = (done / total) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}
