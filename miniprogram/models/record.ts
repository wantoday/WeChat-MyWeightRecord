import { PAGE_SIZE } from '../config'
import { httpDelete, httpGet, httpPost } from './http'
import type { WeightRecord } from './types'

/**
 * 体重记录的数据访问层。页面里不要直连服务，统一走这里。
 *
 * 取数策略：一次拉全量，在内存里排序/筛选。个人数据量小 —— 每天一条，
 * 十年也就三千多条 —— 全量传输比在本地服务上再造一套查询/分页协议划算。
 *
 * 并发合并：一次 onShow 往往同时要「最近两条」和「最早一条」（见 pages/index），
 * 各自发请求会把同一份全量数据拉两遍。inflight 让同一时刻的多个读共用一个请求，
 * settle 后即清空，所以下次 onShow 仍会重新读服务端 —— 这不是缓存，没有陈旧问题。
 * 写操作会主动作废在飞的读（见 invalidate），避免「写完立刻刷新却读到旧快照」。
 */

let inflight: Promise<WeightRecord[]> | null = null

/** 全量记录，按 date 升序（顺序由服务端维护） */
function allRecords(): Promise<WeightRecord[]> {
  if (!inflight) {
    const p = httpGet<WeightRecord[]>('/api/records').finally(() => {
      // 只清自己：写操作可能已经把 inflight 换成 null 或新的请求
      if (inflight === p) inflight = null
    })
    inflight = p
  }
  return inflight
}

/** 作废在飞的读。任何写成功后都要调，否则紧随其后的刷新可能拿到写之前的快照。 */
function invalidate(): void {
  inflight = null
}

/** 分页拉取，按日期倒序。用于历史列表。 */
export async function listPage(skip: number, limit = PAGE_SIZE): Promise<WeightRecord[]> {
  const all = await allRecords()
  return all.slice().reverse().slice(skip, skip + limit)
}

/** 拉取 fromDate（含）之后的全部记录，按日期升序。用于图表。 */
export async function fetchAllSince(fromDate: string): Promise<WeightRecord[]> {
  const all = await allRecords()
  return all.filter((r) => r.date >= fromDate)
}

/** 全部记录（升序）。图表的 'all' 范围用。 */
export async function fetchAll(): Promise<WeightRecord[]> {
  const all = await allRecords()
  return all.slice() // 复制一份，避免调用方改到共享数组
}

/** 指定日期的记录，无则 null */
export async function getByDate(date: string): Promise<WeightRecord | null> {
  const all = await allRecords()
  return all.find((r) => r.date === date) ?? null
}

/** 最新一条（日期最大），无则 null */
export async function getLatest(): Promise<WeightRecord | null> {
  const all = await allRecords()
  return all[all.length - 1] ?? null
}

/** 最早一条（日期最小），用作目标进度的起始体重 */
export async function getEarliest(): Promise<WeightRecord | null> {
  const all = await allRecords()
  return all[0] ?? null
}

/**
 * 按日期写入：当天已有记录则覆盖，否则新增。
 * 「每天一条」是这个 App 的核心不变量，由服务端按 date 查重保证 ——
 * 所有写入路径都必须经过本函数，不要在页面里直接 POST。
 */
export async function upsertByDate(date: string, weight: number, note?: string): Promise<void> {
  // note 不传就不发这个字段：服务端只在收到 note 时才覆盖它，
  // 否则「从记录页只改体重」会把当天已有的备注清空。
  const body: { date: string; weight: number; note?: string } = { date, weight }
  if (note !== undefined) body.note = note
  await httpPost('/api/records', body)
  invalidate()
}

export async function removeRecord(id: string): Promise<void> {
  await httpDelete(`/api/records/${encodeURIComponent(id)}`)
  invalidate()
}

export async function countRecords(): Promise<number> {
  const all = await allRecords()
  return all.length
}
