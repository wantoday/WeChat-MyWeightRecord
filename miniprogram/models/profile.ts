import * as store from './storage'
import type { UserProfile } from './types'

/**
 * 用户档案访问层：数据存手机本地，全局只有一份。
 * 首次读取返回默认档案；合并更新只接受身高 / 目标体重两个已知键。
 * 保持 Promise 签名，页面无需改动。
 */

export async function ensureProfile(): Promise<UserProfile> {
  return store.loadProfile()
}

export async function saveProfile(
  patch: Partial<Omit<UserProfile, '_id'>>
): Promise<void> {
  store.saveProfile(patch)
}
