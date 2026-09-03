import { REMINDER_TMPL_ID } from '../../config'
import { ensureProfile, saveProfile } from '../../models/profile'
import { countRecords } from '../../models/record'
import type { UserProfile } from '../../models/types'
import { healthyWeightRange } from '../../utils/bmi'

/** picker 的可选整点 */
const HOURS = Array.from({ length: 24 }, (_, i) => `${i}:00`)

/**
 * 设置页：身高、目标体重、每日提醒。
 *
 * 提醒依赖微信订阅消息。注意一次性订阅的额度是「授权一次 = 可推一条」，
 * 所以 remindDaily 云函数每天推送会逐日消耗额度 —— 真正长期可用需要在
 * 小程序后台申请「长期订阅」（仅部分类目开放）。当前实现是一次性订阅，
 * 每次用户在本页开启/重新点击提醒时补充一次额度。
 */
Page({
  data: {
    loading: true,
    profileId: '',
    heightCm: 0,
    targetWeight: 0,
    reminderEnabled: false,
    reminderHour: 20,
    hours: HOURS,
    hourLabel: '20:00',
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
        profileId: profile._id,
        heightCm: profile.heightCm,
        targetWeight: profile.targetWeight,
        reminderEnabled: profile.reminderEnabled,
        reminderHour: profile.reminderHour,
        hourLabel: HOURS[profile.reminderHour] ?? '20:00',
        rangeText: range ? `健康区间 ${range.min}–${range.max}kg` : '',
        recordCount: count,
      })
    } catch (err) {
      this.setData({ loading: false })
      console.error('[profile] load failed', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
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
    const patch: Partial<Omit<UserProfile, '_id' | '_openid'>> =
      field === 'heightCm'
        ? { heightCm: Math.round(value) }
        : { targetWeight: Math.round(value * 10) / 10 }

    try {
      await saveProfile(this.data.profileId, patch)
      await this.load()
    } catch (err) {
      console.error('[profile] save failed', err)
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  onEditHeight() {
    void this.editNumber('heightCm', '身高', '输入身高 cm', 100, 250)
  },

  onEditTarget() {
    void this.editNumber('targetWeight', '目标体重', '输入目标体重 kg', 20, 300)
  },

  async onToggleReminder(e: WechatMiniprogram.CustomEvent<{ value: boolean }>): Promise<void> {
    const on = e.detail.value

    if (on && !REMINDER_TMPL_ID) {
      // 没配模板 ID 时开关不该假装生效，回滚 UI 并说明
      this.setData({ reminderEnabled: false })
      void wx.showModal({
        title: '未配置提醒模板',
        content: '请在小程序后台申请订阅消息模板，并把模板 ID 填入 miniprogram/config.ts 的 REMINDER_TMPL_ID',
        showCancel: false,
      })
      return
    }

    if (on) {
      try {
        const res = await wx.requestSubscribeMessage({ tmplIds: [REMINDER_TMPL_ID] })
        if (res[REMINDER_TMPL_ID] !== 'accept') {
          this.setData({ reminderEnabled: false })
          wx.showToast({ title: '未授权，无法提醒', icon: 'none' })
          return
        }
      } catch (err) {
        this.setData({ reminderEnabled: false })
        console.error('[profile] subscribe failed', err)
        wx.showToast({ title: '授权失败', icon: 'none' })
        return
      }
    }

    try {
      await saveProfile(this.data.profileId, { reminderEnabled: on })
      this.setData({ reminderEnabled: on })
    } catch (err) {
      console.error('[profile] save reminder failed', err)
      wx.showToast({ title: '保存失败', icon: 'none' })
      await this.load()
    }
  },

  async onPickHour(e: WechatMiniprogram.CustomEvent<{ value: string }>): Promise<void> {
    const hour = Number(e.detail.value)
    try {
      await saveProfile(this.data.profileId, { reminderHour: hour })
      this.setData({ reminderHour: hour, hourLabel: HOURS[hour] })
    } catch (err) {
      console.error('[profile] save hour failed', err)
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },
})
