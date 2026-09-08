import { PAGE_SIZE, WEIGHT_RANGE } from '../../config'
import * as records from '../../models/record'
import { loadWeightUnit } from '../../models/storage'
import type { WeightRecord, WeightUnit } from '../../models/types'
import { toFriendlyLabel } from '../../utils/date'
import { deltaIn, formatWeight, fromKg, roundKgForStore, toKg, unitLabel } from '../../utils/unit'

/** 列表行的视图模型：把展示用的文案预先算好，wxml 里不做逻辑 */
interface Row {
  _id: string
  date: string
  label: string
  /** 按当前单位格式化好的体重字符串（记录本身仍是 kg） */
  weight: string
  /** 与前一天记录的差值文案，如 '-0.4'；无参照时为 '' */
  delta: string
  deltaDir: 'down' | 'up' | 'flat' | ''
  note: string
}

/**
 * 历史记录页：倒序分页列表，点击改体重，长按删。
 *
 * delta 需要相邻两条记录，跨页时前一页最后一条要参与计算，
 * 所以保留原始 raw 数组，每次追加后整体重算（见 buildRows）。
 *
 * 单位跟随打卡页的偏好（存储里的 weight_unit），每次 reload 重读 ——
 * 列表值、差值、以及点击后的修改弹窗都按它换算，存储始终是 kg。
 */
Page({
  data: {
    rows: [] as Row[],
    loading: true,
    loadingMore: false,
    noMore: false,
    unit: 'jin' as WeightUnit,
    unitLabel: '斤',
  },

  /** 原始记录（desc），rows 由它派生 */
  raw: [] as WeightRecord[],

  onShow() {
    // 从打卡页新增记录后切回来要能看到，所以每次显示都重置重拉
    void this.reload()
  },

  async onPullDownRefresh() {
    await this.reload()
    wx.stopPullDownRefresh()
  },

  async reload(): Promise<void> {
    this.raw = []
    // 先落单位再取数：loadMore → buildRows 读的是 this.data.unit
    const unit = loadWeightUnit()
    this.setData({ loading: true, noMore: false, unit, unitLabel: unitLabel(unit) })
    await this.loadMore()
    this.setData({ loading: false })
  },

  onReachBottom() {
    if (this.data.noMore || this.data.loadingMore) return
    void this.loadMore()
  },

  async loadMore(): Promise<void> {
    this.setData({ loadingMore: true })
    try {
      const batch = await records.listPage(this.raw.length, PAGE_SIZE)
      this.raw = this.raw.concat(batch)
      this.setData({
        rows: this.buildRows(this.raw, this.data.unit),
        noMore: batch.length < PAGE_SIZE,
      })
    } catch (err) {
      console.error('[history] load failed', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loadingMore: false })
    }
  },

  /** raw（倒序）→ 视图行。下一个元素是更早的记录，所以 delta = 本条 - 下一条。 */
  buildRows(raw: WeightRecord[], unit: WeightUnit): Row[] {
    return raw.map((r, i) => {
      const prev = raw[i + 1]
      let delta = ''
      let deltaDir: Row['deltaDir'] = ''
      if (prev) {
        const d = deltaIn(r.weight - prev.weight, unit)
        deltaDir = d < 0 ? 'down' : d > 0 ? 'up' : 'flat'
        delta = d === 0 ? '±0' : `${d > 0 ? '+' : ''}${d}`
      }
      return {
        _id: r._id,
        date: r.date,
        label: toFriendlyLabel(r.date),
        weight: formatWeight(r.weight, unit),
        delta,
        deltaDir,
        note: r.note ?? '',
      }
    })
  },

  async onTapRow(e: WechatMiniprogram.CustomEvent): Promise<void> {
    // dataset.weight 已是当前单位下的展示值：弹窗里改的、下面校验的都按该单位算
    const { date, weight } = e.currentTarget.dataset
    const unit = this.data.unit
    const label = this.data.unitLabel
    const res = await wx.showModal({
      title: `修改 ${toFriendlyLabel(date)}`,
      editable: true,
      placeholderText: `输入体重 ${label}`,
      content: weight,
    })
    if (!res.confirm) return

    const next = Number(res.content)
    // 区间以 kg 为准（config.WEIGHT_RANGE），所以先换算再比
    const kg = roundKgForStore(toKg(next, unit), unit)
    if (!next || Number.isNaN(next) || kg < WEIGHT_RANGE.min || kg > WEIGHT_RANGE.max) {
      const min = fromKg(WEIGHT_RANGE.min, unit)
      const max = fromKg(WEIGHT_RANGE.max, unit)
      wx.showToast({ title: `请输入 ${min}-${max}${label} 之间的体重`, icon: 'none' })
      return
    }

    try {
      await records.upsertByDate(date, kg)
      wx.showToast({ title: '已更新', icon: 'success' })
      await this.reload()
    } catch (err) {
      console.error('[history] update failed', err)
      wx.showToast({ title: '更新失败', icon: 'none' })
    }
  },

  async onLongPressRow(e: WechatMiniprogram.CustomEvent): Promise<void> {
    const { id, date } = e.currentTarget.dataset
    const res = await wx.showModal({
      title: '删除记录',
      content: `确定删除 ${toFriendlyLabel(date)} 的记录？`,
      confirmText: '删除',
      confirmColor: '#ff3b30',
    })
    if (!res.confirm) return

    try {
      await records.removeRecord(id)
      wx.showToast({ title: '已删除', icon: 'success' })
      await this.reload()
    } catch (err) {
      console.error('[history] remove failed', err)
      wx.showToast({ title: '删除失败', icon: 'none' })
    }
  },
})
