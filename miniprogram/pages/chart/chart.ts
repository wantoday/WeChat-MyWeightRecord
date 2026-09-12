import { isPlanEnabled, fetchMembers, loadPlan } from '../../models/plan'
import { ensureProfile } from '../../models/profile'
import * as records from '../../models/record'
import { loadWeightUnit } from '../../models/storage'
import type {
  ChartRange,
  PlanLocal,
  PlanMember,
  WeightRecord,
  WeightUnit,
} from '../../models/types'
import { drawWeightChart, summarize } from '../../utils/chart'
import type { ChartPoint, ChartSeries } from '../../utils/chart'
import { daysAgoStr } from '../../utils/date'
import { MY_COLOR, memberStat, seriesColor } from '../../utils/plan'
import { unitLabel } from '../../utils/unit'

/**
 * 趋势页。
 *
 * 单位跟随打卡页的偏好（存储里的 weight_unit）：每次 onShow 重读，
 * 所以在打卡页切完斤/kg 再切回来，y 轴刻度与区间统计会一起换算。
 *
 * Canvas 2D 节点必须等 onReady 之后才查得到，而切 tab 回来只触发 onShow。
 *
 * 关键时序：onReady 时 hasData 还是 false，wxss 的 .chart-canvas.is-hidden
 * 把高度压成 0，此刻量到的尺寸是 0 —— 不能拿它初始化位图，否则整页图表永久空白。
 * 所以 initCanvas 遇到零尺寸就不缓存、保持未就绪，由 redraw 在真正有数据、
 * 布局已恢复之后重试一次。绘制统一从 setData 的回调里触发，确保量到的是新布局。
 *
 * 好友计划：已加入时把好友的曲线和自己的叠在一张图上对比（utils/chart 的多系列），
 * 好友数据拉取失败只影响好友那几条线，自己的图照常画。
 */

const RANGES: { key: ChartRange; label: string; days: number }[] = [
  { key: 'week', label: '近 7 天', days: 7 },
  { key: 'month', label: '近 30 天', days: 30 },
  { key: 'all', label: '全部', days: 0 },
]

/** 好友数据 30 秒内不重复拉：onShow 每次切 tab 都会触发，没必要回回打云函数 */
const FETCH_TTL = 30000

interface LegendItem {
  id: string
  name: string
  color: string
  /** 最新体重，已按展示单位换算 */
  latest: number
  /** 首→尾变化，已按展示单位换算。减重为负 */
  delta: number
  isMe: boolean
}

Page({
  data: {
    ranges: RANGES,
    range: 'month' as ChartRange,
    loading: true,
    hasData: false,
    /** 统计值已按 unit 换算，不再是 kg */
    stat: null as { min: number; max: number; avg: number; delta: number } | null,
    count: 0,
    /** 展示单位（跟随打卡页偏好），记录仍以 kg 存储 */
    unit: 'jin' as WeightUnit,
    unitLabel: '斤',
    /** 没配云环境 ID 时整张好友计划卡隐藏 */
    planEnabled: false,
    hasPlan: false,
    planName: '',
    planCode: '',
    /** 图例：我的 + 每位好友一行。只有自己时不展示（下方统计卡已经够了） */
    legend: [] as LegendItem[],
    friendHint: '',
  },

  /** 画布上下文与尺寸，非渲染数据所以不放 data */
  ctx: null as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D | null,
  cssWidth: 0,
  cssHeight: 0,
  points: [] as ChartPoint[],
  /** 本次要画的全部线，我的在第一条 */
  series: [] as ChartSeries[],
  targetWeight: 0,
  /** 好友数据的内存缓存 + 上次拉取时间 */
  friendMembers: null as PlanMember[] | null,
  lastFetchAt: 0,
  friendError: '',

  onReady() {
    this.initCanvas(() => this.redraw())
  },

  onShow() {
    void this.load()
  },

  /**
   * 查询 canvas 节点、按 dpr 放大位图、缓存 ctx。done 只在初始化成功后触发。
   * 量到零尺寸（无数据时 canvas 被 is-hidden 折叠）就直接放弃，等下次重试。
   */
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
        if (!ref.width || !ref.height) return

        const canvas = ref.node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getWindowInfo().pixelRatio

        // canvas 位图尺寸 = CSS 尺寸 × dpr，再 scale(dpr) —— 否则高分屏上线条发虚。
        // 给 width/height 赋值会重置 ctx 的变换矩阵，所以重复初始化不会叠加 scale。
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
    const fromDate = days > 0 ? daysAgoStr(days - 1) : ''
    const local = isPlanEnabled() ? loadPlan() : null

    try {
      const [profile, rows, friends] = await Promise.all([
        ensureProfile(),
        fromDate ? records.fetchAllSince(fromDate) : records.fetchAll(),
        this.loadFriends(local),
      ])

      this.points = rows.map((r: WeightRecord) => ({ date: r.date, weight: r.weight }))
      this.targetWeight = profile.targetWeight
      const unit = loadWeightUnit()

      const friendSeries: ChartSeries[] = []
      const legend: LegendItem[] = []
      const mine = memberStat(this.points, unit)
      if (mine) {
        legend.push({
          id: 'me',
          name: '我',
          color: MY_COLOR,
          latest: mine.latest,
          delta: mine.delta,
          isMe: true,
        })
      }
      friends.members.forEach((m) => {
        if (m.isMe) return // 「我」已经用本地数据画了，云端那份只是给别人看的
        const pts = fromDate ? m.points.filter((p) => p.date >= fromDate) : m.points
        if (pts.length === 0) return
        const color = seriesColor(friendSeries.length + 1)
        friendSeries.push({ name: m.nickname, points: pts, color })
        const stat = memberStat(pts, unit)
        legend.push({
          id: m.id,
          name: m.nickname,
          color,
          latest: stat ? stat.latest : 0,
          delta: stat ? stat.delta : 0,
          isMe: false,
        })
      })

      this.series = [
        { name: '我', points: this.points, color: MY_COLOR, emphasized: true },
        ...friendSeries,
      ].filter((s) => s.points.length > 0)

      // 在 setData 回调里重绘：此时 hasData 已生效、canvas 恢复了高度，
      // initCanvas 才量得到真实尺寸（见文件头时序说明）
      this.setData(
        {
          loading: false,
          hasData: this.series.length > 0,
          count: this.points.length,
          unit,
          unitLabel: unitLabel(unit),
          stat: summarize(this.points, unit),
          planEnabled: isPlanEnabled(),
          hasPlan: !!local,
          planName: local ? local.name : '',
          planCode: local ? local.code : '',
          legend,
          friendHint: friends.error,
        },
        () => this.redraw()
      )
    } catch (err) {
      this.setData({ loading: false, hasData: false })
      console.error('[chart] load failed', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  /**
   * 拉好友曲线。失败不抛 —— 只让好友那几条线消失，自己的图照常画。
   * 缓存命中时直接复用，避免切 tab 就打云函数。
   */
  async loadFriends(local: PlanLocal | null): Promise<{ members: PlanMember[]; error: string }> {
    this.friendError = ''
    if (!local) return { members: [], error: '' }
    if (this.friendMembers && Date.now() - this.lastFetchAt < FETCH_TTL) {
      return { members: this.friendMembers, error: '' }
    }
    try {
      const res = await fetchMembers()
      this.friendMembers = res ? res.members : null
      this.lastFetchAt = Date.now()
    } catch (err) {
      // 失败时保留上一次成功的数据（哪怕旧一点），总比把好友的线整个抹掉好
      console.warn('[chart] 好友数据拉取失败', err)
      this.friendError = '好友数据加载失败，稍后自动重试'
    }
    return { members: this.friendMembers ?? [], error: this.friendError }
  },

  redraw(): void {
    // cssHeight 为 0 说明 onReady 那次量到的是被折叠的 canvas，得等有数据后重量一次
    if (!this.ctx || !this.cssHeight) {
      if (this.series.length > 0) this.initCanvas(() => this.redraw())
      return
    }
    drawWeightChart(this.ctx, {
      width: this.cssWidth,
      height: this.cssHeight,
      series: this.series,
      targetWeight: this.targetWeight,
      unit: this.data.unit,
    })
  },

  onRangeTap(e: WechatMiniprogram.CustomEvent): void {
    const key = e.currentTarget.dataset.key as ChartRange
    if (key === this.data.range) return
    this.setData({ range: key, loading: true })
    void this.load()
  },

  goPlan(): void {
    wx.navigateTo({ url: '/pages/plan/plan' })
  },
})
