import { ensureProfile } from '../../models/profile'
import * as records from '../../models/record'
import type { ChartRange, WeightRecord } from '../../models/types'
import { drawWeightChart, summarize } from '../../utils/chart'
import type { ChartPoint } from '../../utils/chart'
import { daysAgoStr } from '../../utils/date'

/**
 * 趋势页。
 *
 * Canvas 2D 节点必须等 onReady 之后才查得到，而切 tab 回来只触发 onShow，
 * 所以用 canvasReady 标记：onReady 里初始化一次画布并落下 ctx，
 * onShow 只负责取数 + 重绘（若画布还没就绪则跳过绘制，由 onReady 兜底）。
 */

const RANGES: { key: ChartRange; label: string; days: number }[] = [
  { key: 'week', label: '近 7 天', days: 7 },
  { key: 'month', label: '近 30 天', days: 30 },
  { key: 'all', label: '全部', days: 0 },
]

Page({
  data: {
    ranges: RANGES,
    range: 'month' as ChartRange,
    loading: true,
    hasData: false,
    stat: null as { min: number; max: number; avg: number; delta: number } | null,
    count: 0,
  },

  /** 画布上下文与尺寸，非渲染数据所以不放 data */
  ctx: null as WechatMiniprogram.CanvasContext | null,
  cssWidth: 0,
  cssHeight: 0,
  points: [] as ChartPoint[],
  targetWeight: 0,

  onReady() {
    this.initCanvas(() => this.redraw())
  },

  onShow() {
    void this.load()
  },

  /** 查询 canvas 节点、按 dpr 放大位图、缓存 ctx。回调在初始化完成后触发。 */
  initCanvas(done: () => void): void {
    wx.createSelectorQuery()
      .select('#weight-chart')
      .fields({ node: true, size: true })
      .exec((res) => {
        const ref = res[0]
        if (!ref || !ref.node) {
          console.warn('[chart] canvas node not found')
          return
        }
        const canvas = ref.node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getWindowInfo().pixelRatio

        // canvas 位图尺寸 = CSS 尺寸 × dpr，再 scale(dpr) —— 否则高分屏上线条发虚
        canvas.width = ref.width * dpr
        canvas.height = ref.height * dpr
        ctx.scale(dpr, dpr)

        this.ctx = ctx
        this.cssWidth = ref.width
        this.cssHeight = ref.height
        done()
      })
  },

  async load(): Promise<void> {
    const range = this.data.range
    const days = RANGES.find((r) => r.key === range)?.days ?? 0

    try {
      const [profile, rows] = await Promise.all([
        ensureProfile(),
        days > 0 ? records.fetchAllSince(daysAgoStr(days - 1)) : records.fetchAll(),
      ])

      this.points = rows.map((r: WeightRecord) => ({ date: r.date, weight: r.weight }))
      this.targetWeight = profile.targetWeight

      this.setData({
        loading: false,
        hasData: this.points.length > 0,
        count: this.points.length,
        stat: summarize(this.points),
      })
      this.redraw()
    } catch (err) {
      this.setData({ loading: false, hasData: false })
      console.error('[chart] load failed', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  redraw(): void {
    if (!this.ctx) return
    drawWeightChart(this.ctx, {
      width: this.cssWidth,
      height: this.cssHeight,
      points: this.points,
      targetWeight: this.targetWeight,
    })
  },

  onRangeTap(e: WechatMiniprogram.TapEvent): void {
    const key = e.currentTarget.dataset.key as ChartRange
    if (key === this.data.range) return
    this.setData({ range: key, loading: true })
    void this.load()
  },
})
