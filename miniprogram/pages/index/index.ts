import { WEIGHT_RANGE } from '../../config'
import { ensureProfile } from '../../models/profile'
import * as records from '../../models/record'
import { loadWeightUnit, saveWeightUnit } from '../../models/storage'
import type { BmiResult, WeightUnit } from '../../models/types'
import { calcBmi, targetProgress } from '../../utils/bmi'
import { toFriendlyLabel, todayStr } from '../../utils/date'
import { formatWeight, fromKg, roundKgForStore, toKg, unitLabel } from '../../utils/unit'

/**
 * 打卡页：录入今天的体重，并汇总 BMI / 目标进度 / 与上次的变化。
 *
 * 单位：默认「斤」，可在录入卡手动切到 kg。存储统一用 kg，
 * 只在录入（toKg）和展示（fromKg/formatWeight）时换算，避免污染数据层。
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
    /** 已保存的今日体重（kg），0 表示今天还没打卡 */
    savedWeight: 0,
    /** 单位（存储偏好，默认斤） */
    unit: 'jin' as WeightUnit,
    unitLabel: '斤',
    /** 与上一条记录的差值描述，如 '比 3天前 轻 0.4kg'，按当前单位展示 */
    deltaText: '',
    /** 上一条记录的日期/体重（kg），切单位时用来重算 deltaText */
    prevDate: '',
    prevWeightKg: 0,
    bmi: null as BmiResult | null,
    heightCm: 0,
    targetWeight: 0,
    /** 目标卡标题文案，按当前单位展示，如 '目标 140斤' */
    targetText: '',
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
      const unit = loadWeightUnit()

      this.setData({
        loading: false,
        savedWeight,
        input: savedWeight ? formatWeight(savedWeight, unit) : '',
        unit,
        unitLabel: unitLabel(unit),
        prevDate: prev?.date ?? '',
        prevWeightKg: prev?.weight ?? 0,
        heightCm: profile.heightCm,
        targetWeight: profile.targetWeight,
        targetText: profile.targetWeight
          ? `${formatWeight(profile.targetWeight, unit)}${unitLabel(unit)}`
          : '',
        bmi: calcBmi(current, profile.heightCm),
        progress: targetProgress(earliest?.weight ?? 0, current, profile.targetWeight),
        deltaText: this.buildDeltaText(savedWeight, prev?.date ?? '', prev?.weight ?? 0, unit),
      })
    } catch (err) {
      this.setData({ loading: false })
      console.error('[index] refresh failed', err)
      wx.showToast({ title: '加载失败，请重试', icon: 'none', duration: 2500 })
    }
  },

  /**
   * 拼「与上次相比」的文案，按传入单位展示。
   * 今天已打卡 → 和 prev 比出增减；今天没打卡 → 只报最近一次的值。
   */
  buildDeltaText(
    savedWeight: number,
    prevDate: string,
    prevWeightKg: number,
    unit: WeightUnit
  ): string {
    if (!prevDate) return ''
    const label = unitLabel(unit)

    if (!savedWeight) {
      return `上次 ${toFriendlyLabel(prevDate)} ${formatWeight(prevWeightKg, unit)}${label}`
    }

    const deltaKg = Math.round((savedWeight - prevWeightKg) * 10) / 10
    if (deltaKg === 0) return `与 ${toFriendlyLabel(prevDate)} 持平`
    const delta = Math.round(fromKg(deltaKg, unit) * 10) / 10
    const verb = deltaKg < 0 ? '轻' : '重'
    return `比 ${toFriendlyLabel(prevDate)} ${verb} ${Math.abs(delta)}${label}`
  },

  onInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ input: e.detail.value })
  },

  /** 切换单位：换算输入框里的值，持久化偏好，并重算依赖单位的展示文案 */
  onUnitTap(e: WechatMiniprogram.CustomEvent<{ unit: WeightUnit }>) {
    const unit = e.currentTarget.dataset.unit as WeightUnit
    if (unit === this.data.unit) return
    const oldUnit = this.data.unit

    let input = this.data.input
    const n = Number(input)
    if (input && !Number.isNaN(n)) {
      input = formatWeight(toKg(n, oldUnit), unit)
    }

    saveWeightUnit(unit)
    this.setData({
      unit,
      unitLabel: unitLabel(unit),
      input,
      targetText: this.data.targetWeight
        ? `${formatWeight(this.data.targetWeight, unit)}${unitLabel(unit)}`
        : '',
      deltaText: this.buildDeltaText(
        this.data.savedWeight,
        this.data.prevDate,
        this.data.prevWeightKg,
        unit
      ),
    })
  },

  async onSave(): Promise<void> {
    // 挡住重入：按钮是个 view，saving 只改了样式，光靠 UI 拦不住连点。
    // 「每天一条」本身由存储层按 date 查重保证，但连点会触发两次保存、弹两次 toast。
    if (this.data.saving) return

    const weight = Number(this.data.input)
    // 先按当前单位换算成 kg 再校验（存储与区间都以 kg 为准）
    const kg = roundKgForStore(toKg(weight, this.data.unit), this.data.unit)
    if (!weight || Number.isNaN(weight) || kg < WEIGHT_RANGE.min || kg > WEIGHT_RANGE.max) {
      const min = fromKg(WEIGHT_RANGE.min, this.data.unit)
      const max = fromKg(WEIGHT_RANGE.max, this.data.unit)
      wx.showToast({
        title: `请输入 ${min}-${max}${this.data.unitLabel} 之间的体重`,
        icon: 'none',
      })
      return
    }

    this.setData({ saving: true })
    try {
      await records.upsertByDate(this.data.date, kg)
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
