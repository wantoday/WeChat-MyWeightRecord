import type { WeightUnit } from '../models/types'
import { diffDays, fromDateStr, toDateStr, toShortLabel } from './date'
import { fromKg } from './unit'

/**
 * 体重折线图绘制（Canvas 2D 接口，非旧版 wx.createCanvasContext）。
 *
 * 这里只负责「给定点集，画到 ctx 上」，不碰页面状态，方便单独调整视觉。
 * 调用方需自己完成节点查询、dpr 缩放和尺寸设置（见 pages/chart/chart.ts）。
 *
 * 点集一律传 kg（存储单位），展示单位通过 opts.unit 指定，
 * y 轴刻度 / 目标线 / 留白都在这里换算 —— 调用方不必先换算再传进来。
 *
 * 支持多条线（好友计划）：传 series，每条线一个颜色；
 * 只画自己时沿用 points 快捷入口，内部同样当成一条 series。
 */

export interface ChartPoint {
  date: string
  weight: number
}

/** 一条线。date 相同的点按日期对齐到同一 x，所以不同人的点能叠在一根时间轴上。 */
export interface ChartSeries {
  name?: string
  /** weight 单位 kg，按 date 升序（乱序也能画，这里会先排一遍） */
  points: ChartPoint[]
  color?: string
  /** 重点线（我的）：加粗 + 渐变填充 + 数据点；好友线只画细线，人多了才不糊 */
  emphasized?: boolean
}

export interface DrawOptions {
  /** CSS 像素下的绘图区尺寸（不是 canvas.width，后者已乘 dpr） */
  width: number
  height: number
  /** 单条线的快捷入口，与 series 二选一 */
  points?: ChartPoint[]
  /** 多条线（好友对比）。传了它，points 会被忽略 */
  series?: ChartSeries[]
  /** 目标体重（kg），>0 时画一条虚线参考线 */
  targetWeight?: number
  /** y 轴展示单位，默认 kg */
  unit?: WeightUnit
}

const PADDING = { top: 20, right: 16, bottom: 28, left: 40 }
const BRAND = '#07c160'

/** 起止日期中间那一天，用于 x 轴中间那个标签 */
function addDays(date: string, days: number): string {
  const d = fromDateStr(date)
  d.setDate(d.getDate() + days)
  return toDateStr(d)
}

export function drawWeightChart(
  ctx: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
  opts: DrawOptions
): void {
  const { width, height, targetWeight = 0, unit = 'kg' } = opts
  ctx.clearRect(0, 0, width, height)

  const all: ChartSeries[] = (opts.series ?? (opts.points ? [{ points: opts.points }] : []))
    .filter((s) => s.points.length > 0)
    .map((s, i) => ({
      ...s,
      points: s.points.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
      // 只画一条线时它就是「我的」，加粗填充；多条线时由调用方用 emphasized 指定
      emphasized: s.emphasized ?? (opts.series ? false : i === 0),
    }))
  if (all.length === 0) return

  const plotW = width - PADDING.left - PADDING.right
  const plotH = height - PADDING.top - PADDING.bottom

  /*
   * x 轴按「自然日」而不是点序：多人的记录日期对不上，
   * 按点序画会让「3 号」和「10 号」落在同一个位置，趋势就失真了。
   * 日期跨度由全部线的日期并集决定。
   */
  let start = all[0].points[0].date
  let end = start
  for (const s of all) {
    for (const p of s.points) {
      if (p.date < start) start = p.date
      if (p.date > end) end = p.date
    }
  }
  const rawSpan = diffDays(end, start)
  const span = Math.max(1, rawSpan)
  const xOf = (date: string): number =>
    rawSpan === 0
      ? PADDING.left + plotW / 2
      : PADDING.left + (diffDays(date, start) / span) * plotW

  // 全部纵向计算都在展示单位下进行（含留白与最小跨度），换算一次存成 ys
  const ysOf = (s: ChartSeries): number[] => s.points.map((p) => fromKg(p.weight, unit))
  const flatYs = all.reduce<number[]>((acc, s) => acc.concat(ysOf(s)), [])
  const target = fromKg(targetWeight, unit)
  const MARGIN = fromKg(0.5, unit)
  const MIN_SPAN = fromKg(2, unit)

  // y 轴范围：所有线的 min/max 各留 0.5kg，并把目标线纳入范围，避免它被画到区域外
  const weights = flatYs.slice()
  if (targetWeight > 0) weights.push(target)
  let lo = Math.min(...weights) - MARGIN
  let hi = Math.max(...weights) + MARGIN
  // 全部数据相同时会得到零高度区间，强行撑开 2kg 免除以 0
  if (hi - lo < MIN_SPAN) {
    const mid = (hi + lo) / 2
    lo = mid - MIN_SPAN / 2
    hi = mid + MIN_SPAN / 2
  }

  const yOf = (w: number): number => PADDING.top + (1 - (w - lo) / (hi - lo)) * plotH

  /* 横向网格 + y 轴刻度 */
  ctx.lineWidth = 1
  ctx.strokeStyle = '#ececf0'
  ctx.fillStyle = '#8a8a8e'
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const GRID = 4
  for (let i = 0; i <= GRID; i++) {
    const w = lo + ((hi - lo) * i) / GRID
    const y = yOf(w)
    ctx.beginPath()
    ctx.moveTo(PADDING.left, y)
    ctx.lineTo(PADDING.left + plotW, y)
    ctx.stroke()
    ctx.fillText(w.toFixed(1), PADDING.left - 6, y)
  }

  /* 目标线 */
  if (targetWeight > 0) {
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = '#ff9500'
    ctx.beginPath()
    ctx.moveTo(PADDING.left, yOf(target))
    ctx.lineTo(PADDING.left + plotW, yOf(target))
    ctx.stroke()
    ctx.setLineDash([])
  }

  /* 每条线：重点线（我的）带渐变填充与数据点，好友线只描一条细线 */
  const showDots = all.length === 1 && all[0].points.length <= 31
  all.forEach((s) => {
    const ys = ysOf(s)
    const color = s.color ?? BRAND

    if (s.emphasized) {
      const grad = ctx.createLinearGradient(0, PADDING.top, 0, PADDING.top + plotH)
      grad.addColorStop(0, 'rgba(7,193,96,0.22)')
      grad.addColorStop(1, 'rgba(7,193,96,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.moveTo(xOf(s.points[0].date), PADDING.top + plotH)
      ys.forEach((w, i) => ctx.lineTo(xOf(s.points[i].date), yOf(w)))
      ctx.lineTo(xOf(s.points[s.points.length - 1].date), PADDING.top + plotH)
      ctx.closePath()
      ctx.fill()
    }

    ctx.strokeStyle = color
    ctx.lineWidth = s.emphasized ? 2.5 : 1.5
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    ys.forEach((w, i) => {
      const x = xOf(s.points[i].date)
      const y = yOf(w)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    if (showDots) {
      ctx.fillStyle = '#ffffff'
      ys.forEach((w, i) => {
        ctx.beginPath()
        ctx.arc(xOf(s.points[i].date), yOf(w), 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      })
    }
  })

  /* x 轴标签：首 / 中 / 尾，按整张图的日期范围取，不能按某一条线的点序 */
  ctx.fillStyle = '#8a8a8e'
  ctx.textBaseline = 'top'
  const labels =
    rawSpan === 0 ? [start] : [start, addDays(start, Math.round(rawSpan / 2)), end]
  const uniq = labels.filter((v, i) => labels.indexOf(v) === i)
  uniq.forEach((date, i) => {
    ctx.textAlign = i === 0 ? 'left' : i === uniq.length - 1 ? 'right' : 'center'
    ctx.fillText(toShortLabel(date), xOf(date), PADDING.top + plotH + 8)
  })
}

/** 区间统计，展示在图表下方。points 传 kg，结果按 unit 换算成展示值 */
export function summarize(
  points: ChartPoint[],
  unit: WeightUnit = 'kg'
): {
  min: number
  max: number
  avg: number
  delta: number
} | null {
  if (points.length === 0) return null
  const ws = points.map((p) => fromKg(p.weight, unit))
  const sum = ws.reduce((a, b) => a + b, 0)
  const r1 = (n: number): number => Math.round(n * 10) / 10
  return {
    min: r1(Math.min(...ws)),
    max: r1(Math.max(...ws)),
    avg: r1(sum / ws.length),
    delta: r1(ws[ws.length - 1] - ws[0]),
  }
}
