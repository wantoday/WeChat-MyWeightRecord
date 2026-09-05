import { HEIGHT_RANGE, WEIGHT_RANGE } from '../../config'
import { ensureProfile, saveProfile } from '../../models/profile'
import { countRecords } from '../../models/record'
import type { UserProfile } from '../../models/types'
import { healthyWeightRange } from '../../utils/bmi'

/** 设置页：身高、目标体重、累计记录数。 */
Page({
  data: {
    loading: true,
    heightCm: 0,
    targetWeight: 0,
    /** 由身高推出的健康体重区间提示 */
    rangeText: '',
    recordCount: 0,
  },

  onShow() {
    void this.load()
  },

  async load(): Promise<void> {
    try {
      const [profile, count] = await Promise.all([ensureProfile(), countRecords()])
      const range = healthyWeightRange(profile.heightCm)
      this.setData({
        loading: false,
        heightCm: profile.heightCm,
        targetWeight: profile.targetWeight,
        rangeText: range ? `健康区间 ${range.min}–${range.max}kg` : '',
        recordCount: count,
      })
    } catch (err) {
      this.setData({ loading: false })
      console.error('[profile] load failed', err)
      wx.showToast({ title: '加载失败，请确认本地服务已启动', icon: 'none', duration: 2500 })
    }
  },

  /** 统一的「弹窗输入一个数字并存库」流程 */
  async editNumber(
    field: 'heightCm' | 'targetWeight',
    title: string,
    placeholder: string,
    min: number,
    max: number
  ): Promise<void> {
    const current = this.data[field]
    const res = await wx.showModal({
      title,
      editable: true,
      placeholderText: placeholder,
      content: current ? String(current) : '',
    })
    if (!res.confirm) return

    const value = Number(res.content)
    if (!value || Number.isNaN(value) || value < min || value > max) {
      wx.showToast({ title: `请输入 ${min}-${max} 之间的数值`, icon: 'none' })
      return
    }

    // 显式构造 patch 而不用计算属性名 `{ [field]: v }` —— 后者在旧版 tsc 下
    // 会被推断成 { [x: string]: number }，丢掉字段名的类型信息
    const patch: Partial<Omit<UserProfile, '_id'>> =
      field === 'heightCm'
        ? { heightCm: Math.round(value) }
        : { targetWeight: Math.round(value * 10) / 10 }

    try {
      await saveProfile(patch)
      await this.load()
    } catch (err) {
      console.error('[profile] save failed', err)
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  onEditHeight() {
    void this.editNumber('heightCm', '身高', '输入身高 cm', HEIGHT_RANGE.min, HEIGHT_RANGE.max)
  },

  onEditTarget() {
    void this.editNumber('targetWeight', '目标体重', '输入目标体重 kg', WEIGHT_RANGE.min, WEIGHT_RANGE.max)
  },
})
