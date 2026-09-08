import { HEIGHT_RANGE, WEIGHT_RANGE } from '../../config'
import { ensureProfile, saveProfile } from '../../models/profile'
import { countRecords } from '../../models/record'
import { loadWeightUnit } from '../../models/storage'
import type { UserProfile, WeightUnit } from '../../models/types'
import { healthyWeightRange } from '../../utils/bmi'
import { formatWeight, fromKg, roundKgForStore, toKg, unitLabel } from '../../utils/unit'

/**
 * 设置页：身高、目标体重、累计记录数。
 *
 * 体重相关的展示与录入跟随打卡页的单位偏好（每次 onShow 重读），
 * 目标体重存储仍是 kg —— 换算只发生在这一层。
 */
Page({
  data: {
    loading: true,
    heightCm: 0,
    /** 目标体重，kg（0 未设定）。展示用 targetText */
    targetWeight: 0,
    /** 按当前单位格式化的目标体重，如 '140 斤' */
    targetText: '',
    /** 由身高推出的健康体重区间提示，按当前单位 */
    rangeText: '',
    recordCount: 0,
    unit: 'jin' as WeightUnit,
    unitLabel: '斤',
  },

  onShow() {
    void this.load()
  },

  async load(): Promise<void> {
    try {
      const [profile, count] = await Promise.all([ensureProfile(), countRecords()])
      const range = healthyWeightRange(profile.heightCm)
      const unit = loadWeightUnit()
      const label = unitLabel(unit)
      this.setData({
        loading: false,
        heightCm: profile.heightCm,
        targetWeight: profile.targetWeight,
        targetText: profile.targetWeight
          ? `${formatWeight(profile.targetWeight, unit)} ${label}`
          : '',
        rangeText: range
          ? `健康区间 ${formatWeight(range.min, unit)}–${formatWeight(range.max, unit)}${label}`
          : '',
        recordCount: count,
        unit,
        unitLabel: label,
      })
    } catch (err) {
      this.setData({ loading: false })
      console.error('[profile] load failed', err)
      wx.showToast({ title: '加载失败，请重试', icon: 'none', duration: 2500 })
    }
  },

  /**
   * 弹窗输入一个数字：取消返回 null，越界会 toast 后返回 null。
   * min/max/current 都用调用方所在的单位 —— 换算与落库归调用方，这里只管取数校验。
   */
  async promptNumber(
    title: string,
    placeholder: string,
    current: string,
    min: number,
    max: number,
    suffix: string
  ): Promise<number | null> {
    const res = await wx.showModal({
      title,
      editable: true,
      placeholderText: placeholder,
      content: current,
    })
    if (!res.confirm) return null

    const value = Number(res.content)
    if (!value || Number.isNaN(value) || value < min || value > max) {
      wx.showToast({ title: `请输入 ${min}-${max}${suffix} 之间的数值`, icon: 'none' })
      return null
    }
    return value
  },

  /**
   * 存档并重载。patch 一律写成字面量，不要用计算属性名 `{ [field]: v }` ——
   * 后者在旧版 tsc 下会被推断成 { [x: string]: number }，丢掉字段名的类型信息。
   */
  async save(patch: Partial<Omit<UserProfile, '_id'>>): Promise<void> {
    try {
      await saveProfile(patch)
      await this.load()
    } catch (err) {
      console.error('[profile] save failed', err)
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  async onEditHeight(): Promise<void> {
    const cm = await this.promptNumber(
      '身高',
      '输入身高 cm',
      this.data.heightCm ? String(this.data.heightCm) : '',
      HEIGHT_RANGE.min,
      HEIGHT_RANGE.max,
      'cm'
    )
    if (cm === null) return
    await this.save({ heightCm: Math.round(cm) })
  },

  /** 目标体重按当前单位录入与校验，落库前换算回 kg（区间以 kg 为准） */
  async onEditTarget(): Promise<void> {
    const unit = this.data.unit
    const label = this.data.unitLabel
    const value = await this.promptNumber(
      '目标体重',
      `输入目标体重 ${label}`,
      this.data.targetWeight ? formatWeight(this.data.targetWeight, unit) : '',
      fromKg(WEIGHT_RANGE.min, unit),
      fromKg(WEIGHT_RANGE.max, unit),
      label
    )
    if (value === null) return
    await this.save({ targetWeight: roundKgForStore(toKg(value, unit), unit) })
  },
})
