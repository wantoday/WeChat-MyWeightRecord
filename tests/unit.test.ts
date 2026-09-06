import { describe, expect, it } from 'vitest'
import { loadWeightUnit, saveWeightUnit } from '../miniprogram/models/storage'
import { formatWeight, fromKg, roundKgForStore, toKg, unitLabel } from '../miniprogram/utils/unit'

describe('单位换算', () => {
  it('kg ↔ 斤', () => {
    expect(toKg(142, 'jin')).toBe(71)
    expect(toKg(141.5, 'jin')).toBe(70.75)
    expect(toKg(70, 'kg')).toBe(70)
    expect(fromKg(71, 'jin')).toBe(142)
    expect(fromKg(70.75, 'jin')).toBe(141.5)
  })

  it('存储精度：kg 保留 1 位小数，斤换算后保留 2 位小数（避免假漂移）', () => {
    expect(roundKgForStore(70.25, 'kg')).toBe(70.3)
    expect(roundKgForStore(71.25, 'jin')).toBe(71.25)
    expect(roundKgForStore(141.5 / 2, 'jin')).toBe(70.75)
  })

  it('formatWeight 按单位展示，去掉多余的 .0', () => {
    expect(formatWeight(71, 'kg')).toBe('71')
    expect(formatWeight(70.4, 'kg')).toBe('70.4')
    expect(formatWeight(70, 'jin')).toBe('140')
    expect(formatWeight(70.75, 'jin')).toBe('141.5')
  })

  it('unitLabel', () => {
    expect(unitLabel('jin')).toBe('斤')
    expect(unitLabel('kg')).toBe('kg')
  })
})

describe('单位偏好持久化', () => {
  function installFakeWx(): void {
    const mem = new Map<string, unknown>()
    ;(globalThis as any).wx = {
      getStorageSync(key: string) {
        return mem.get(key)
      },
      setStorageSync(key: string, val: unknown) {
        mem.set(key, val)
      },
      removeStorageSync(key: string) {
        mem.delete(key)
      },
    }
  }

  it('未设置时默认斤', () => {
    installFakeWx()
    expect(loadWeightUnit()).toBe('jin')
  })

  it('保存后可读回，且非法值回退斤', () => {
    installFakeWx()
    saveWeightUnit('kg')
    expect(loadWeightUnit()).toBe('kg')
    saveWeightUnit('jin')
    expect(loadWeightUnit()).toBe('jin')
  })
})
