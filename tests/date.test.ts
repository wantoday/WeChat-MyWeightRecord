import { describe, it, expect } from 'vitest'
import {
  toDateStr,
  todayStr,
  fromDateStr,
  daysAgoStr,
  diffDays,
  toShortLabel,
  toFriendlyLabel,
} from '../miniprogram/utils/date'

describe('date utils', () => {
  it('toDateStr 按本地时区格式化并补零', () => {
    expect(toDateStr(new Date(2024, 0, 5))).toBe('2024-01-05')
    expect(toDateStr(new Date(2024, 11, 31))).toBe('2024-12-31')
    expect(toDateStr(new Date(2024, 9, 1))).toBe('2024-10-01')
  })

  it('todayStr 返回今天（本地）的日期字符串', () => {
    expect(todayStr()).toBe(toDateStr(new Date()))
  })

  it('fromDateStr 解析为本地零点（不能直接用 new Date(str)）', () => {
    const d = fromDateStr('2024-01-05')
    expect(d.getFullYear()).toBe(2024)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(5)
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
  })

  it('daysAgoStr 返回 n 天前的日期字符串，且与原实现自洽', () => {
    expect(daysAgoStr(0)).toBe(todayStr())
    expect(diffDays(todayStr(), daysAgoStr(1))).toBe(1)
    expect(diffDays(todayStr(), daysAgoStr(7))).toBe(7)
    expect(diffDays(todayStr(), daysAgoStr(-1))).toBe(-1)
  })

  it('diffDays 计算日期差（a - b），含跨月', () => {
    expect(diffDays('2024-01-10', '2024-01-05')).toBe(5)
    expect(diffDays('2024-02-01', '2024-01-31')).toBe(1)
    expect(diffDays('2024-01-01', '2024-01-01')).toBe(0)
    expect(diffDays('2024-01-01', '2024-01-05')).toBe(-4)
    expect(diffDays('2024-03-01', '2024-02-01')).toBe(29) // 2024 闰年 2 月 29 天
  })

  it('toShortLabel 转 M/D，去掉前导零', () => {
    expect(toShortLabel('2024-01-05')).toBe('1/5')
    expect(toShortLabel('2024-11-30')).toBe('11/30')
  })

  it('toFriendlyLabel 区分 今天/昨天/具体日期', () => {
    expect(toFriendlyLabel(todayStr())).toBe('今天')
    expect(toFriendlyLabel(daysAgoStr(1))).toBe('昨天')
    expect(toFriendlyLabel('2024-01-05')).toBe('1月5日')
    expect(toFriendlyLabel('2024-12-31')).toBe('12月31日')
  })
})
