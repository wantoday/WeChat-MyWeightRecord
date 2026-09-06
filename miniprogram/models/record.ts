import { PAGE_SIZE } from '../config'
import * as store from './storage'
import type { WeightRecord } from './types'

/**
 * 体重记录的数据访问层。页面里不要直连存储，统一走这里。
 *
 * 数据存在手机本地（wx 本地存储），读取即全量内存操作；
 * 个人数据量小 —— 每天一条，十年也就三千多条 —— 全量处理足够快。
 * 所有导出函数保持 Promise 签名，页面无需改动。
 */

/** 分页拉取，按日期倒序。用于历史列表。 */
export async function listPage(skip: number, limit = PAGE_SIZE): Promise<WeightRecord[]> {
  const all = store.loadRecords()
  return all.slice().reverse().slice(skip, skip + limit)
}

/** 拉取 fromDate（含）之后的全部记录，按日期升序。用于图表。 */
export async function fetchAllSince(fromDate: string): Promise<WeightRecord[]> {
  const all = store.loadRecords()
  return all.filter((r) => r.date >= fromDate)
}

/** 全部记录（升序）。图表的 'all' 范围用。 */
export async function fetchAll(): Promise<WeightRecord[]> {
  return store.loadRecords()
}

/** 指定日期的记录，无则 null */
export async function getByDate(date: string): Promise<WeightRecord | null> {
  const all = store.loadRecords()
  return all.find((r) => r.date === date) ?? null
}

/** 指定日期之前最近一条记录（严格早于 date），无则 null。补登记时用作参考与差值对比。 */
export async function getBefore(date: string): Promise<WeightRecord | null> {
  const all = store.loadRecords()
  let prev: WeightRecord | null = null
  for (const r of all) {
    if (r.date >= date) break
    prev = r
  }
  return prev
}

/** 最新一条（日期最大），无则 null */
export async function getLatest(): Promise<WeightRecord | null> {
  const all = store.loadRecords()
  return all[all.length - 1] ?? null
}

/** 最早一条（日期最小），用作目标进度的起始体重 */
export async function getEarliest(): Promise<WeightRecord | null> {
  const all = store.loadRecords()
  return all[0] ?? null
}

/**
 * 按日期写入：当天已有记录则覆盖，否则新增。
 * 「每天一条」是核心不变量；note 不传保留原备注，传 '' 才清空。
 */
export async function upsertByDate(date: string, weight: number, note?: string): Promise<void> {
  store.upsertRecord(date, weight, note)
}

export async function removeRecord(id: string): Promise<void> {
  store.removeRecordById(id)
}

export async function countRecords(): Promise<number> {
  return store.loadRecords().length
}
