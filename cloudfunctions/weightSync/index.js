const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const COLLECTION = 'user_data'
const MAX_RECORDS = 5000

/**
 * 体重记录 · 多设备同步。
 *
 * 每个用户一条 doc，_id 就是 openid。openid 只从 cloud.getWXContext() 取，
 * 不接受客户端传 —— 所以谁也读不到别人的数据。
 *
 * 数据库权限设为「仅管理端可读写」，客户端不直连。
 *
 * action:
 *   pull  返回该用户的快照 + doc 的 updatedAt（后者用作 push 的乐观锁版本号）
 *   push  带 baseUpdatedAt 做 CAS 写入；版本对不上就返回 CONFLICT，让客户端重跑
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID
  if (!openid) return { ok: false, code: 'NO_AUTH' }

  const action = event && event.action
  if (action !== 'pull' && action !== 'push') return { ok: false, code: 'BAD_ACTION' }

  // 用服务器时间，避免各设备时钟不一致影响 last-write-wins
  const serverTime = Date.now()

  try {
    if (action === 'pull') {
      let data = null
      try {
        const res = await cloud.database().collection(COLLECTION).doc(openid).get()
        data = res && res.data ? res.data : null
      } catch (e) {
        // 集合不存在 / 该用户还没有 doc —— 都当作「远端为空」
        data = null
      }
      return {
        ok: true,
        exists: !!data,
        snapshot: data ? data.snapshot : null,
        updatedAt: data && typeof data.updatedAt === 'number' ? data.updatedAt : 0,
        serverTime,
      }
    }

    const snapshot = event.snapshot
    if (!snapshot || !Array.isArray(snapshot.records)) return { ok: false, code: 'BAD_SNAPSHOT' }
    if (snapshot.records.length > MAX_RECORDS) return { ok: false, code: 'TOO_LARGE' }

    const baseUpdatedAt = event.baseUpdatedAt

    if (!baseUpdatedAt) {
      try {
        await cloud.database().collection(COLLECTION).add({
          data: { _id: openid, openid, snapshot, updatedAt: serverTime },
        })
      } catch (e) {
        // 集合没建（或名字不对）时 add 会直接失败 —— 这不是并发冲突，
        // 报 CONFLICT 会让客户端白白重跑一轮，还给用户一句误导性的「数据有冲突」。
        const msg = String((e && e.message) || e)
        if (/collection/i.test(msg)) return { ok: false, code: 'NO_COLLECTION', message: msg }
        // 多半是另一个设备抢先建了这个 doc —— 让客户端重新拉一次再合并
        return { ok: false, code: 'CONFLICT' }
      }
      return { ok: true, updatedAt: serverTime, serverTime }
    }

    const res = await cloud
      .database()
      .collection(COLLECTION)
      .where({ _id: openid, updatedAt: baseUpdatedAt })
      .update({ data: { snapshot, updatedAt: serverTime } })

    if (!res || !res.stats || res.stats.updated === 0) {
      // 版本对不上：pull 之后有别的设备写入过
      return { ok: false, code: 'CONFLICT' }
    }
    return { ok: true, updatedAt: serverTime, serverTime }
  } catch (e) {
    return { ok: false, code: 'INTERNAL', message: String((e && e.message) || e) }
  }
}
