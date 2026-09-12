import { PLAN_POINT_LIMIT } from '../config'
import type { PlanPoint, WeightUnit } from '../models/types'
import { fromKg } from './unit'

/**
 * 好友计划的纯函数：点集转换、配色、摘要。
 * 不碰 wx API、不调 Date.now()，方便单测。
 */

/**
 * 本地记录 → 上传用的点集。
 *
 * 只取 date 与 weight：**备注不上云** —— 计划里别人只需要知道「哪天多重」。
 * 按 date 升序，只留最近 PLAN_POINT_LIMIT 条：既够画一年多的曲线，
 * 也不会让云函数入参越滚越大。
 */
export function toPlanPoints(rows: { date: string; weight: number }[]): PlanPoint[] {
  return rows
    .map((r) => ({ date: r.date, weight: Math.round(r.weight * 10) / 10 }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-PLAN_POINT_LIMIT)
}

/** 我的线固定品牌绿；好友按顺序取调色板，人多时循环（>7 人也还能分辨） */
const FRIEND_COLORS = ['#ff9500', '#5b8ff9', '#f5576c', '#9b6bff', '#00c2c7', '#f7b500', '#7a8bff']
export const MY_COLOR = '#07c160'

export function seriesColor(index: number): string {
  if (index <= 0) return MY_COLOR
  return FRIEND_COLORS[(index - 1) % FRIEND_COLORS.length]
}

/**
 * 图例上的一句摘要：最新体重 + 首→尾变化，**已按展示单位换算**并保留 1 位。
 * 没点返回 null。减重时 delta 为负（与 summarize 的语义一致）。
 */
export function memberStat(
  points: PlanPoint[],
  unit: WeightUnit = 'kg'
): { latest: number; delta: number } | null {
  if (points.length === 0) return null
  const first = points[0].weight
  const last = points[points.length - 1].weight
  const r1 = (n: number): number => Math.round(n * 10) / 10
  return {
    latest: r1(fromKg(last, unit)),
    delta: r1(fromKg(last - first, unit)),
  }
}
