import { describe, it, expect } from 'vitest'
import { calcBmi, healthyWeightRange, targetProgress } from '../miniprogram/utils/bmi'

describe('calcBmi（中国成人标准）', () => {
  it('正常：60kg / 170cm → 20.8', () => {
    const r = calcBmi(60, 170)
    expect(r?.value).toBe(20.8)
    expect(r?.level).toBe('normal')
    expect(r?.label).toBe('正常')
  })

  it('偏瘦：50kg / 170cm → 17.3', () => {
    const r = calcBmi(50, 170)!
    expect(r.level).toBe('underweight')
    expect(r.value).toBe(17.3)
  })

  it('超重（中国标准 ≥24，比 WHO 更严）：70kg / 170cm → 24.2', () => {
    const r = calcBmi(70, 170)!
    expect(r.level).toBe('overweight')
    expect(r.value).toBe(24.2)
  })

  it('肥胖（≥28）：85kg / 170cm → 29.4', () => {
    const r = calcBmi(85, 170)!
    expect(r.level).toBe('obese')
    expect(r.value).toBe(29.4)
  })

  it('分级用未取整的 raw：69.3kg / 170cm 真实 BMI 23.979 应判正常，即使展示值四舍五入到 24.0', () => {
    const r = calcBmi(69.3, 170)!
    expect(r.level).toBe('normal')
    expect(r.value).toBe(24)
  })

  it('缺体重或身高时返回 null', () => {
    expect(calcBmi(0, 170)).toBeNull()
    expect(calcBmi(70, 0)).toBeNull()
  })
})

describe('healthyWeightRange（由身高反推正常区间）', () => {
  it('170cm → [53.5, 69.3]，两端自身都会被 calcBmi 判为正常', () => {
    const range = healthyWeightRange(170)!
    expect(range.min).toBe(53.5)
    expect(range.max).toBe(69.3)
    // 端点自洽：min 不偏瘦、max 不超重
    expect(calcBmi(range.min, 170)!.level).toBe('normal')
    expect(calcBmi(range.max, 170)!.level).toBe('normal')
  })

  it('155cm → 下界向上取整', () => {
    const range = healthyWeightRange(155)!
    // 18.5 * 1.55^2 = 44.44625 → ceil(444.4625)/10 = 44.5
    expect(range.min).toBe(44.5)
  })

  it('未填身高返回 null', () => {
    expect(healthyWeightRange(0)).toBeNull()
  })
})

describe('targetProgress（减/增重方向自适应，0-100）', () => {
  it('减重进行到一半：80 → 70，目标 60 = 50%', () => {
    expect(targetProgress(80, 70, 60)).toBe(50)
  })

  it('增重进行到一半：50 → 60，目标 70 = 50%', () => {
    expect(targetProgress(50, 60, 70)).toBe(50)
  })

  it('超额完成被钳制到 100', () => {
    expect(targetProgress(80, 59, 60)).toBe(100)
    expect(targetProgress(80, 55, 60)).toBe(100)
  })

  it('反向恶化被钳制到 0', () => {
    expect(targetProgress(80, 90, 60)).toBe(0)
  })

  it('维持型目标（start≈target）：到或低于目标算达成', () => {
    expect(targetProgress(70, 69.9, 70)).toBe(100)
    expect(targetProgress(70, 70, 70)).toBe(100)
    expect(targetProgress(70, 70.1, 70)).toBe(0)
  })

  it('无目标或无起点返回 0', () => {
    expect(targetProgress(70, 60, 0)).toBe(0)
    expect(targetProgress(0, 60, 60)).toBe(0)
  })
})
