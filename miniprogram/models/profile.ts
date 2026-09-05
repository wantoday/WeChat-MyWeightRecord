import { USE_LOCAL_SERVER } from '../config'
import { profileCol } from './db'
import { httpGet, httpPost } from './http'
import type { UserProfile } from './types'

/**
 * 用户档案访问层。
 *  - 本地模式：服务端维护全局唯一一份档案（首次读取自动建默认档案）；
 *  - 云开发模式：每个 _openid 一条文档；首次读取时若不存在则自动建默认档案。
 */

const DEFAULTS: Omit<UserProfile, '_id' | '_openid'> = {
  heightCm: 0,
  targetWeight: 0,
  reminderEnabled: false,
  reminderHour: 20,
  updatedAt: 0,
}

/** 当前在飞的 ensureProfile，用于合并并发调用 */
let inflight: Promise<UserProfile> | null = null

/**
 * 读取档案；不存在则创建一条默认档案并返回。
 *
 * 三个 tab 页都在自己的 onShow 里调它，而首次建档是「先查后建」：
 * 若 add 还没返回就切了 tab，第二次调用照样查不到档案，于是建出第二条。
 * 之后每次 limit(1) 读到哪条不确定，表现为「在『我的』改完身高，切回首页又没了」。
 * 所以并发调用合并成同一个 promise；settle 后清空，下次 onShow 仍会重新读库。
 */
export function ensureProfile(): Promise<UserProfile> {
  if (!inflight) {
    inflight = loadOrCreate().finally(() => {
      inflight = null
    })
  }
  return inflight
}

async function loadOrCreate(): Promise<UserProfile> {
  if (USE_LOCAL_SERVER) {
    return httpGet<UserProfile>('/api/profile')
  }
  // orderBy 把「已有多条时读哪条」定下来，否则不同页面可能读到不同档案
  const res = await profileCol().orderBy('_id', 'asc').limit(1).get()
  const found = res.data[0]
  if (found) {
    // 兼容旧文档缺字段的情况：读取处兜默认值，不做数据库迁移
    // _id 在官方类型里是 string | number，统一转成 string 供 doc() 使用
    return { ...DEFAULTS, ...found, _id: String(found._id ?? '') }
  }

  const now = Date.now()
  const data = { ...DEFAULTS, updatedAt: now }
  const added = await profileCol().add({ data })
  return { ...data, _id: String(added._id) }
}

/** 局部更新档案。会自动刷新 updatedAt。 */
export async function saveProfile(
  id: string,
  patch: Partial<Omit<UserProfile, '_id' | '_openid'>>
): Promise<void> {
  if (USE_LOCAL_SERVER) {
    await httpPost('/api/profile', patch)
    return
  }
  await profileCol().doc(id).update({
    data: { ...patch, updatedAt: Date.now() },
  })
}
