import { BMI_THRESHOLDS } from '../config'
import type { BmiResult } from '../models/types'

/**
 * BMI 计算与分级。分级用中国成人标准（超重 ≥24、肥胖 ≥28），
 * 比 WHO 标准（25 / 30）更严 —— 改标准就改 config.BMI_THRESHOLDS。
 */
export function calcBmi(weightKg: number, heightCm: number): BmiResult | null {
  if (!weightKg || !heightCm) return null
  const m = heightCm / 100
  const raw = weightKg / (m * m)
  // 分级必须用未取整的 raw：先 round 再比会把 23.98 抬成 24.0 判成「超重」
  // （如 69.3kg / 170cm，真实 BMI 23.979 属正常）。value 只用于展示。
  const value = Math.round(raw * 10) / 10

  if (raw < BMI_THRESHOLDS.underweight) {
    return { value, level: 'underweight', label: '偏瘦', color: '#4a90d9' }
  }
  if (raw < BMI_THRESHOLDS.normal) {
    return { value, level: 'normal', label: '正常', color: '#34c759' }
  }
  if (raw < BMI_THRESHOLDS.overweight) {
    return { value, level: 'overweight', label: '超重', color: '#ff9500' }
  }
  return { value, level: 'obese', label: '肥胖', color: '#ff3b30' }
}

/**
 * 由身高反推「正常」BMI 区间对应的体重区间，用于给目标体重做参考提示。
 *
 * 取整方向不能用 round：两端都必须落在 [18.5, 24) 内，否则提示出来的
 * 端点值自己会被 calcBmi 判成偏瘦/超重，UI 自相矛盾。
 * 下界向上取整；上界取「小于 24×m² 的最大 1 位小数」。
 */
export function healthyWeightRange(heightCm: number): { min: number; max: number } | null {
  if (!heightCm) return null
  const m = heightCm / 100
  return {
    min: Math.ceil(BMI_THRESHOLDS.underweight * m * m * 10) / 10,
    max: (Math.ceil(BMI_THRESHOLDS.normal * m * m * 10) - 1) / 10,
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
  // start ≈ target，即「维持体重」型目标：没有可走的距离，也就无从判断方向。
  // 按减重语义处理 —— 到了或低于目标算达成。不能用 current === target：
  // 维持 70kg 而当前 69.9kg 属于达成，浮点相等却会判成 0%。
  if (Math.abs(total) < 0.05) return current <= target + 0.05 ? 100 : 0
  const done = start - current
  const pct = (done / total) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}
