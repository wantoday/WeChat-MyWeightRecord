import { profileCol } from './db'
import type { UserProfile } from './types'

/**
 * 用户档案访问层。每个 _openid 一条文档；首次读取时若不存在则自动建默认档案。
 */

const DEFAULTS: Omit<UserProfile, '_id' | '_openid'> = {
  heightCm: 0,
  targetWeight: 0,
  reminderEnabled: false,
  reminderHour: 20,
  updatedAt: 0,
}

/** 读取档案；不存在则创建一条默认档案并返回。 */
export async function ensureProfile(): Promise<UserProfile> {
  const res = await profileCol().limit(1).get()
  const found = res.data[0]
  if (found) {
    // 兼容旧文档缺字段的情况：读取处兜默认值，不做数据库迁移
    return { ...DEFAULTS, ...found }
  }

  const now = Date.now()
  const data = { ...DEFAULTS, updatedAt: now }
  const added = await profileCol().add({ data })
  return { ...data, _id: added._id }
}

/** 局部更新档案。会自动刷新 updatedAt。 */
export async function saveProfile(
  id: string,
  patch: Partial<Omit<UserProfile, '_id' | '_openid'>>
): Promise<void> {
  await profileCol().doc(id).update({
    data: { ...patch, updatedAt: Date.now() },
  })
}
