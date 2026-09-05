import { WEIGHT_RANGE } from '../../config'
import { ensureProfile } from '../../models/profile'
import * as records from '../../models/record'
import type { BmiResult } from '../../models/types'
import { calcBmi, targetProgress } from '../../utils/bmi'
import { toFriendlyLabel, todayStr } from '../../utils/date'

/**
 * 打卡页：录入今天的体重，并汇总 BMI / 目标进度 / 与上次的变化。
 *
 * 数据在 onShow 而非 onLoad 里刷新 —— 从「我的」改完身高或从「记录」删掉记录后
 * 切回本页，必须重算。
 */
Page({
  data: {
    loading: true,
    /** 当前录入的日期，固定为今天 */
    date: '',
    dateLabel: '',
    /** 输入框里的字符串。用 string 而非 number：需要允许中间态如 '65.' */
    input: '',
    /** 已保存的今日体重，0 表示今天还没打卡 */
    savedWeight: 0,
    /** 与上一条记录的差值描述，如 '比 3天前 轻 0.4kg' */
    deltaText: '',
    bmi: null as BmiResult | null,
    heightCm: 0,
    targetWeight: 0,
    /** 目标完成度 0-100 */
    progress: 0,
    saving: false,
  },

  onShow() {
    void this.refresh()
  },

  async onPullDownRefresh() {
    await this.refresh()
    wx.stopPullDownRefresh()
  },

  async refresh(): Promise<void> {
    const date = todayStr()
    this.setData({ date, dateLabel: toFriendlyLabel(date) })

    try {
      // 取最近两条：用于判断今天有没有打卡，以及和「上一次」做对比
      const [profile, recent, earliest] = await Promise.all([
        ensureProfile(),
        records.listPage(0, 2),
        records.getEarliest(),
      ])

      const isToday = recent[0]?.date === date
      const savedWeight = isToday ? recent[0].weight : 0
      const prev = isToday ? recent[1] : recent[0]
      // 当前体重：优先今天的；没打卡就用最近一条，好让 BMI / 进度仍有意义
      const current = savedWeight || recent[0]?.weight || 0

      this.setData({
        loading: false,
        savedWeight,
        input: savedWeight ? String(savedWeight) : '',
        heightCm: profile.heightCm,
        targetWeight: profile.targetWeight,
        bmi: calcBmi(current, profile.heightCm),
        progress: targetProgress(earliest?.weight ?? 0, current, profile.targetWeight),
        deltaText: this.buildDeltaText(savedWeight, prev ?? null),
      })
    } catch (err) {
      this.setData({ loading: false })
      console.error('[index] refresh failed', err)
      wx.showToast({ title: '加载失败，请确认本地服务已启动', icon: 'none', duration: 2500 })
    }
  },

  /**
   * 拼「与上次相比」的文案。
   * 今天已打卡 → 和 prev（上一条历史记录）比出增减；今天没打卡 → 只报最近一次的值。
   */
  buildDeltaText(savedWeight: number, prev: { date: string; weight: number } | null): string {
    if (!prev) return ''

    if (!savedWeight) {
      return `上次 ${toFriendlyLabel(prev.date)} ${prev.weight}kg`
    }

    const delta = Math.round((savedWeight - prev.weight) * 10) / 10
    if (delta === 0) return `与 ${toFriendlyLabel(prev.date)} 持平`
    const verb = delta < 0 ? '轻' : '重'
    return `比 ${toFriendlyLabel(prev.date)} ${verb} ${Math.abs(delta)}kg`
  },

  onInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ input: e.detail.value })
  },

  async onSave(): Promise<void> {
    // 挡住重入：按钮是个 view，saving 只改了样式，光靠 UI 拦不住连点。
    // 「每天一条」本身由服务端按 date 查重保证，但连点会发两次请求、弹两次 toast，
    // 而且第二次的 refresh 可能先于第一次返回，把界面刷成中间态。
    if (this.data.saving) return

    const weight = Number(this.data.input)
    // 合法区间之外几乎必然是误输入（少打小数点、多打一位）
    if (!weight || Number.isNaN(weight) || weight < WEIGHT_RANGE.min || weight > WEIGHT_RANGE.max) {
      wx.showToast({ title: `请输入 ${WEIGHT_RANGE.min}-${WEIGHT_RANGE.max} 之间的体重`, icon: 'none' })
      return
    }

    this.setData({ saving: true })
    try {
      await records.upsertByDate(this.data.date, Math.round(weight * 10) / 10)
      wx.showToast({ title: this.data.savedWeight ? '已更新' : '打卡成功', icon: 'success' })
      await this.refresh()
    } catch (err) {
      console.error('[index] save failed', err)
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },
})
