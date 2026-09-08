import { describe, expect, it, vi } from 'vitest'
import { drawWeightChart, summarize } from '../miniprogram/utils/chart'

/**
 * 图表的单位换算：点集一律以 kg 传入，y 轴刻度 / 目标线 / 留白按 unit 换算。
 * 这里用假 ctx 收集 fillText，检查刻度文本 —— 斤应正好是 kg 的两倍。
 */
function fakeCtx() {
  const texts: string[] = []
  const ctx = {
    texts,
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    setLineDash: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fillText: (s: string) => {
      texts.push(s)
    },
  }
  return ctx as unknown as WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D & {
    texts: string[]
  }
}

/** y 轴刻度是 toFixed(1) 的数字，x 轴标签是日期文本，按形状筛出前者 */
function yTicks(texts: string[]): number[] {
  return texts.filter((t) => /^\d+\.\d$/.test(t)).map(Number)
}

const POINTS = [
  { date: '2026-09-01', weight: 70 },
  { date: '2026-09-02', weight: 71 },
]

const SIZE = { width: 320, height: 220 }

describe('drawWeightChart 的 y 轴刻度', () => {
  it('斤的刻度是 kg 的两倍（含上下留白与最小跨度）', () => {
    const kg = fakeCtx()
    drawWeightChart(kg, { ...SIZE, points: POINTS, unit: 'kg' })
    const jin = fakeCtx()
    drawWeightChart(jin, { ...SIZE, points: POINTS, unit: 'jin' })

    const kgTicks = yTicks(kg.texts)
    expect(kgTicks).toEqual([69.5, 70, 70.5, 71, 71.5])
    expect(yTicks(jin.texts)).toEqual(kgTicks.map((v) => v * 2))
  })

  it('省略 unit 时按 kg 画，与显式传 kg 一致', () => {
    const implicit = fakeCtx()
    drawWeightChart(implicit, { ...SIZE, points: POINTS })
    const explicit = fakeCtx()
    drawWeightChart(explicit, { ...SIZE, points: POINTS, unit: 'kg' })
    expect(implicit.texts).toEqual(explicit.texts)
  })

  it('单点数据被强行撑开的跨度也按单位换算（kg 2 → 斤 4）', () => {
    const kg = fakeCtx()
    drawWeightChart(kg, { ...SIZE, points: [{ date: '2026-09-01', weight: 70 }], unit: 'kg' })
    const jin = fakeCtx()
    drawWeightChart(jin, { ...SIZE, points: [{ date: '2026-09-01', weight: 70 }], unit: 'jin' })

    const kgTicks = yTicks(kg.texts)
    expect(kgTicks[kgTicks.length - 1] - kgTicks[0]).toBe(2)
    const jinTicks = yTicks(jin.texts)
    expect(jinTicks[jinTicks.length - 1] - jinTicks[0]).toBe(4)
    expect(jinTicks).toEqual(kgTicks.map((v) => v * 2))
  })

  it('目标体重会被纳入 y 轴范围，且按单位换算', () => {
    const jin = fakeCtx()
    drawWeightChart(jin, { ...SIZE, points: POINTS, targetWeight: 65, unit: 'jin' })
    const ticks = yTicks(jin.texts)
    // 目标 65kg = 130 斤，比数据下界更低，必须落在刻度范围内
    expect(ticks[0]).toBeLessThanOrEqual(130)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(142)
  })

  it('空点集只清屏，不画刻度', () => {
    const ctx = fakeCtx()
    drawWeightChart(ctx, { ...SIZE, points: [], unit: 'jin' })
    expect(ctx.texts).toEqual([])
  })
})

describe('summarize 按单位换算', () => {
  it('kg 为默认单位', () => {
    expect(summarize(POINTS)).toEqual({ min: 70, max: 71, avg: 70.5, delta: 1 })
    expect(summarize(POINTS, 'kg')).toEqual({ min: 70, max: 71, avg: 70.5, delta: 1 })
  })

  it('斤模式下 min/max/avg/delta 全部翻倍', () => {
    expect(summarize(POINTS, 'jin')).toEqual({ min: 140, max: 142, avg: 141, delta: 2 })
  })

  it('delta 是「末 - 首」，减重为负', () => {
    const down = [
      { date: '2026-09-01', weight: 71 },
      { date: '2026-09-02', weight: 70.5 },
    ]
    expect(summarize(down, 'kg')?.delta).toBe(-0.5)
    expect(summarize(down, 'jin')?.delta).toBe(-1)
  })

  it('空点集返回 null', () => {
    expect(summarize([], 'jin')).toBeNull()
  })
})
