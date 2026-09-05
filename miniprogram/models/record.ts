import { PAGE_SIZE, USE_LOCAL_SERVER } from '../config'
import { cmd, recordsCol } from './db'
import { httpDelete, httpGet, httpPost } from './http'
import type { WeightRecord } from './types'

/**
 * 体重记录的数据访问层。页面里不要直连数据库/服务，统一走这里。
 *
 * 两种模式（见 config.ts 的 USE_LOCAL_SERVER）：
 *  - 本地模式：所有记录一次拉全量，在内存里排序/筛选（个人数据量小，
 *    每天一条，哪怕十年也就三千多条，一次全量完全没问题）；
 *  - 云开发模式：维持原云数据库分页逻辑。
 *
 * 关键约束（云模式）：小程序端单次 collection.get() 最多返回 20 条。
 */

/** 本地模式：全量记录（升序） */
async function allLocal(): Promise<WeightRecord[]> {
  return httpGet<WeightRecord[]>('/api/records')
}

/** 分页拉取，按日期倒序。用于历史列表。 */
export async function listPage(skip: number, limit = PAGE_SIZE): Promise<WeightRecord[]> {
  if (USE_LOCAL_SERVER) {
    const all = await allLocal()
    const desc = all.slice().reverse()
    return desc.slice(skip, skip + limit)
  }
  const res = await recordsCol().orderBy('date', 'desc').skip(skip).limit(limit).get()
  return res.data as WeightRecord[]
}

/**
 * 拉取 fromDate（含）之后的全部记录，按日期升序。用于图表。
 * 云模式内部循环分页绕开 20 条上限；maxPages 是防跑飞的兜底。
 */
export async function fetchAllSince(fromDate: string, maxPages = 100): Promise<WeightRecord[]> {
  if (USE_LOCAL_SERVER) {
    const all = await allLocal()
    return all.filter((r) => r.date >= fromDate)
  }
  const out: WeightRecord[] = []
  for (let page = 0; page < maxPages; page++) {
    const res = await recordsCol()
      .where({ date: cmd().gte(fromDate) })
      .orderBy('date', 'asc')
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .get()
    out.push(...(res.data as WeightRecord[]))
    if (res.data.length < PAGE_SIZE) break
  }
  return out
}

/** 全部记录（升序）。图表的 'all' 范围用。 */
export function fetchAll(): Promise<WeightRecord[]> {
  return fetchAllSince('0000-00-00')
}

/** 指定日期的记录，无则 null */
export async function getByDate(date: string): Promise<WeightRecord | null> {
  if (USE_LOCAL_SERVER) {
    const all = await allLocal()
    return all.find((r) => r.date === date) ?? null
  }
  const res = await recordsCol().where({ date }).limit(1).get()
  return (res.data[0] as WeightRecord | undefined) ?? null
}

/** 最新一条（日期最大），无则 null */
export async function getLatest(): Promise<WeightRecord | null> {
  if (USE_LOCAL_SERVER) {
    const all = await allLocal()
    return all[all.length - 1] ?? null // 服务端按 date 升序维护
  }
  const res = await recordsCol().orderBy('date', 'desc').limit(1).get()
  return (res.data[0] as WeightRecord | undefined) ?? null
}

/** 最早一条（日期最小），用作目标进度的起始体重 */
export async function getEarliest(): Promise<WeightRecord | null> {
  if (USE_LOCAL_SERVER) {
    const all = await allLocal()
    return all[0] ?? null
  }
  const res = await recordsCol().orderBy('date', 'asc').limit(1).get()
  return (res.data[0] as WeightRecord | undefined) ?? null
}

/**
 * 按日期写入：当天已有记录则覆盖，否则新增。
 * 「每天一条」是这个 App 的核心不变量：本地模式由服务端保证，
 * 云模式靠先查后写保证 —— 所有写入路径都必须经过本函数。
 */
export async function upsertByDate(
  date: string,
  weight: number,
  note?: string
): Promise<void> {
  if (USE_LOCAL_SERVER) {
    await httpPost('/api/records', { date, weight, note: note ?? '' })
    return
  }
  const now = Date.now()
  const existing = await getByDate(date)

  if (existing) {
    await recordsCol()
      .doc(existing._id)
      .update({ data: { weight, note: note ?? '', updatedAt: now } })
    return
  }

  await recordsCol().add({
    data: { date, weight, note: note ?? '', createdAt: now, updatedAt: now },
  })
}

export async function removeRecord(id: string): Promise<void> {
  if (USE_LOCAL_SERVER) {
    await httpDelete(`/api/records/${encodeURIComponent(id)}`)
    return
  }
  await recordsCol().doc(id).remove()
}

export async function countRecords(): Promise<number> {
  if (USE_LOCAL_SERVER) {
    const all = await allLocal()
    return all.length
  }
  const res = await recordsCol().count()
  return res.total
}
