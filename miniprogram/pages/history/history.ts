import { PAGE_SIZE } from '../../config'
import * as records from '../../models/record'
import type { WeightRecord } from '../../models/types'
import { toFriendlyLabel } from '../../utils/date'

/** 列表行的视图模型：把展示用的文案预先算好，wxml 里不做逻辑 */
interface Row {
  _id: string
  date: string
  label: string
  weight: number
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
 */
Page({
  data: {
    rows: [] as Row[],
    loading: true,
    loadingMore: false,
    noMore: false,
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
    this.setData({ loading: true, noMore: false })
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
        rows: this.buildRows(this.raw),
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
  buildRows(raw: WeightRecord[]): Row[] {
    return raw.map((r, i) => {
      const prev = raw[i + 1]
      let delta = ''
      let deltaDir: Row['deltaDir'] = ''
      if (prev) {
        const d = Math.round((r.weight - prev.weight) * 10) / 10
        deltaDir = d < 0 ? 'down' : d > 0 ? 'up' : 'flat'
        delta = d === 0 ? '±0' : `${d > 0 ? '+' : ''}${d}`
      }
      return {
        _id: r._id,
        date: r.date,
        label: toFriendlyLabel(r.date),
        weight: r.weight,
        delta,
        deltaDir,
        note: r.note ?? '',
      }
    })
  },

  async onTapRow(e: WechatMiniprogram.TapEvent): Promise<void> {
    const { date, weight } = e.currentTarget.dataset
    const res = await wx.showModal({
      title: `修改 ${toFriendlyLabel(date)}`,
      editable: true,
      placeholderText: '输入体重 kg',
      content: weight,
    })
    if (!res.confirm) return

    const next = Number(res.content)
    if (!next || Number.isNaN(next) || next < 20 || next > 300) {
      wx.showToast({ title: '请输入 20-300 之间的体重', icon: 'none' })
      return
    }

    try {
      await records.upsertByDate(date, Math.round(next * 10) / 10)
      wx.showToast({ title: '已更新', icon: 'success' })
      await this.reload()
    } catch (err) {
      console.error('[history] update failed', err)
      wx.showToast({ title: '更新失败', icon: 'none' })
    }
  },

  async onLongPressRow(e: WechatMiniprogram.TapEvent): Promise<void> {
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
