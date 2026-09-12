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

/**
 * 记录折线路径的假 ctx：按 beginPath 分组，用来校验多条线的对齐与 y 轴范围。
 * 网格线也是 moveTo/lineTo，靠「分组」把它们和真正的折线区分开。
 */
function pathCtx() {
  const groups: { x: number; y: number }[][] = []
  const texts: string[] = []
  let current: { x: number; y: number }[] = []
  const ctx = {
    groups,
    texts,
    clearRect: vi.fn(),
    beginPath() {
      current = []
      groups.push(current)
    },
    closePath: vi.fn(),
    moveTo: (x: number, y: number) => current.push({ x, y }),
    lineTo: (x: number, y: number) => current.push({ x, y }),
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
    groups: { x: number; y: number }[][]
    texts: string[]
  }
}

describe('drawWeightChart 的多条线（好友对比）', () => {
  it('不同人的同一天落在同一个 x 上，且按自然日等距', () => {
    const ctx = pathCtx()
    drawWeightChart(ctx, {
      ...SIZE,
      series: [
        // 我：1 号、2 号、3 号连着记（体重故意不同，好和水平网格线区分）
        {
          emphasized: true,
          points: [
            { date: '2026-09-01', weight: 70 },
            { date: '2026-09-02', weight: 69 },
            { date: '2026-09-03', weight: 71 },
          ],
        },
        // 好友：只记了 1 号和 3 号，中间空一天
        {
          points: [
            { date: '2026-09-01', weight: 68 },
            { date: '2026-09-03', weight: 67 },
          ],
        },
      ],
      unit: 'kg',
    })

    // 我的三个点：1/2/3 号等距
    const mine = ctx.groups.find((g) => g.length === 3)
    expect(mine).toBeTruthy()
    const [a, b, c] = mine as { x: number; y: number }[]
    expect(b.x - a.x).toBeCloseTo(c.x - b.x, 5)
    // 好友少了 2 号，3 号那个点必须和我的 3 号落在同一个 x 上 ——
    // 否则「同一天」会被画到两个位置，多人趋势就失真了
    const friend = ctx.groups.find(
      (g) => g.length === 2 && Math.abs(g[0].x - a.x) < 0.001 && g[0].y !== a.y
    ) as { x: number; y: number }[]
    expect(friend).toBeTruthy()
    expect(friend[1].x).toBeCloseTo(c.x, 5)
  })

  it('y 轴范围跨所有线，好友更重也不会画出框外', () => {
    const ctx = pathCtx()
    drawWeightChart(ctx, {
      ...SIZE,
      series: [
        { points: [{ date: '2026-09-01', weight: 60 }] },
        { points: [{ date: '2026-09-01', weight: 90 }] },
      ],
      unit: 'kg',
    })
    const ticks = yTicks(ctx.texts)
    expect(Math.min(...ticks)).toBeLessThan(60)
    expect(Math.max(...ticks)).toBeGreaterThan(90)
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
