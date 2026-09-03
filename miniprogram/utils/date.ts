/**
 * 日期工具。
 *
 * 全项目统一用 'YYYY-MM-DD' 本地日期字符串作为「一天」的标识，
 * 不要在数据层传 Date 对象或时间戳做日期比较 —— 会踩时区坑。
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Date → 'YYYY-MM-DD'（按设备本地时区） */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 今天的 'YYYY-MM-DD' */
export function todayStr(): string {
  return toDateStr(new Date())
}

/** 'YYYY-MM-DD' → Date（本地时间 00:00）。注意不能用 new Date(str)，iOS 对 '-' 分隔解析不一致。 */
export function fromDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** n 天前的 'YYYY-MM-DD'（n 可为负数表示未来） */
export function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toDateStr(d)
}

/** 两个日期字符串相差的天数（a - b） */
export function diffDays(a: string, b: string): number {
  const ms = fromDateStr(a).getTime() - fromDateStr(b).getTime()
  return Math.round(ms / 86400000)
}

/** 'YYYY-MM-DD' → 'M/D'，用于图表轴标签 */
export function toShortLabel(s: string): string {
  const [, m, d] = s.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 'YYYY-MM-DD' → '今天' / '昨天' / 'M月D日'，用于列表 */
export function toFriendlyLabel(s: string): string {
  const delta = diffDays(todayStr(), s)
  if (delta === 0) return '今天'
  if (delta === 1) return '昨天'
  const [, m, d] = s.split('-')
  return `${Number(m)}月${Number(d)}日`
}
