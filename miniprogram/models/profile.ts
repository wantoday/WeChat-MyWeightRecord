import { httpGet, httpPost } from './http'
import type { UserProfile } from './types'

/**
 * 用户档案访问层。
 *
 * 本地服务单人使用，全局只维护一份档案；首次读取时服务端自动建默认档案，
 * 所以客户端不需要「先查再建」那套逻辑（也就不存在并发建出两份的问题）。
 *
 * 三个 tab 页都会在自己的 onShow 里调 ensureProfile，inflight 把同一时刻的
 * 多次调用合并成一个请求；settle 后清空，下次 onShow 仍会重新读服务端。
 */

let inflight: Promise<UserProfile> | null = null

export function ensureProfile(): Promise<UserProfile> {
  if (!inflight) {
    const p = httpGet<UserProfile>('/api/profile').finally(() => {
      if (inflight === p) inflight = null
    })
    inflight = p
  }
  return inflight
}

/**
 * 局部更新档案，服务端按字段合并并刷新 updatedAt。
 * 服务端只接受 PROFILE_DEFAULTS 里已知的键，新增字段要同步过去。
 */
export async function saveProfile(
  patch: Partial<Omit<UserProfile, '_id'>>
): Promise<void> {
  await httpPost('/api/profile', patch)
  inflight = null // 作废在飞的读，避免紧随其后的刷新拿到旧档案
}
