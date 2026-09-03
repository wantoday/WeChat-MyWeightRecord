import { COLLECTION } from '../config'
import type { UserProfile, WeightRecord } from './types'

/**
 * 云数据库句柄。
 *
 * 懒初始化：wx.cloud.database() 必须在 wx.cloud.init() 之后调用，
 * 而 init 在 app.ts 的 onLaunch 里。模块顶层直接取 database() 在某些
 * 启动时序下会拿到未初始化的实例，所以一律走 db() 函数。
 */

let _db: WechatMiniprogram.DBDatabase | null = null

function db(): WechatMiniprogram.DBDatabase {
  if (!_db) _db = wx.cloud.database()
  return _db
}

export function recordsCol(): WechatMiniprogram.DBCollection<WeightRecord> {
  return db().collection<WeightRecord>(COLLECTION.records)
}

export function profileCol(): WechatMiniprogram.DBCollection<UserProfile> {
  return db().collection<UserProfile>(COLLECTION.profile)
}

/** 查询指令，等价于官方文档里的 db.command */
export function cmd(): WechatMiniprogram.DBCommand {
  return db().command
}
