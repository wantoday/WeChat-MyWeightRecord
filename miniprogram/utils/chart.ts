import type { WeightUnit } from '../models/types'
import { toShortLabel } from './date'
import { fromKg } from './unit'

/**
 * 体重折线图绘制（Canvas 2D 接口，非旧版 wx.createCanvasContext）。
 *
 * 这里只负责「给定点集，画到 ctx 上」，不碰页面状态，方便单独调整视觉。
 * 调用方需自己完成节点查询、dpr 缩放和尺寸设置（见 pages/chart/chart.ts）。
 *
 * 点集一律传 kg（存储单位），展示单位通过 opts.unit 指定，
 * y 轴刻度 / 目标线 / 留白都在这里换算 —— 调用方不必先换算再传进来。
 */

export interface ChartPoint {
  date: string
  weight: number
}

export interface DrawOptions {
  /** CSS 像素下的绘图区尺寸（不是 canvas.width，后者已乘 dpr） */
  width: number
  height: number
  /** 点集，weight 单位 kg */
  points: ChartPoint[]
  /** 目标体重（kg），>0 时画一条虚线参考线 */
  targetWeight?: number
  /** y 轴展示单位，默认 kg */
  unit?: WeightUnit
}

const PADDING = { top: 20, right: 16, bottom: 28, left: 40 }
const BRAND = '#07c160'

export function drawWeightChart(
  ctx: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
  opts: DrawOptions
): void {
  const { width, height, points, targetWeight = 0, unit = 'kg' } = opts
  ctx.clearRect(0, 0, width, height)

  if (points.length === 0) return

  const plotW = width - PADDING.left - PADDING.right
  const plotH = height - PADDING.top - PADDING.bottom

  // 全部纵向计算都在展示单位下进行（含留白与最小跨度），换算一次存成 ys
  const ys = points.map((p) => fromKg(p.weight, unit))
  const target = fromKg(targetWeight, unit)
  const MARGIN = fromKg(0.5, unit)
  const MIN_SPAN = fromKg(2, unit)

  // y 轴范围：数据 min/max 上下各留 0.5kg，并把目标线纳入范围，避免它被画到区域外
  const weights = ys.slice()
  if (targetWeight > 0) weights.push(target)
  let lo = Math.min(...weights) - MARGIN
  let hi = Math.max(...weights) + MARGIN
  // 全部数据相同时会得到零高度区间，强行撑开 2kg 免除以 0
  if (hi - lo < MIN_SPAN) {
    const mid = (hi + lo) / 2
    lo = mid - MIN_SPAN / 2
    hi = mid + MIN_SPAN / 2
  }

  const xOf = (i: number): number =>
    points.length === 1
      ? PADDING.left + plotW / 2
      : PADDING.left + (i / (points.length - 1)) * plotW
  const yOf = (w: number): number =>
    PADDING.top + (1 - (w - lo) / (hi - lo)) * plotH

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

  /* 折线下方渐变填充 */
  const grad = ctx.createLinearGradient(0, PADDING.top, 0, PADDING.top + plotH)
  grad.addColorStop(0, 'rgba(7,193,96,0.22)')
  grad.addColorStop(1, 'rgba(7,193,96,0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.moveTo(xOf(0), PADDING.top + plotH)
  ys.forEach((w, i) => ctx.lineTo(xOf(i), yOf(w)))
  ctx.lineTo(xOf(points.length - 1), PADDING.top + plotH)
  ctx.closePath()
  ctx.fill()

  /* 折线本体 */
  ctx.strokeStyle = BRAND
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ys.forEach((w, i) => {
    const x = xOf(i)
    const y = yOf(w)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  /* 数据点：点多时只画首尾，否则会糊成一片 */
  const showDots = points.length <= 31
  if (showDots) {
    ctx.fillStyle = '#ffffff'
    ys.forEach((w, i) => {
      ctx.beginPath()
      ctx.arc(xOf(i), yOf(w), 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    })
  }

  /* x 轴标签：最多 3 个（首 / 中 / 尾），避免重叠 */
  ctx.fillStyle = '#8a8a8e'
  ctx.textBaseline = 'top'
  const idxs =
    points.length === 1
      ? [0]
      : [0, Math.floor((points.length - 1) / 2), points.length - 1]
  const uniq = idxs.filter((v, i) => idxs.indexOf(v) === i)
  uniq.forEach((i) => {
    ctx.textAlign = i === 0 ? 'left' : i === points.length - 1 ? 'right' : 'center'
    ctx.fillText(toShortLabel(points[i].date), xOf(i), PADDING.top + plotH + 8)
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
