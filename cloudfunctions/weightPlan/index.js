const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const PLANS = 'plans'
const MEMBERS = 'plan_members'

/*
 * 以下常量是 miniprogram/config.ts 的手抄副本 —— 云函数跑在 Node 里，没法 import TS。
 * 改 config.ts 的 WEIGHT_RANGE / PLAN_POINT_LIMIT / PLAN_MAX_MEMBERS 时要同步改这里，
 * 否则会出现「客户端能存、上云被拒」的不一致（tests/plan.test.ts 有对应用例）。
 */
const MAX_MEMBERS = 10
const MAX_POINTS = 366
const NAME_MAX = 12
const NICKNAME_MAX = 8
const WEIGHT_MIN = 20
const WEIGHT_MAX = 300

/** 去掉 I / L / O / 0 / 1 —— 手抄邀请码时最容易认错的几个字符 */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LEN = 6
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CODE_RE = /^[A-Z0-9]{6}$/

/**
 * 好友减肥计划。
 *
 * 每个计划一条 plans doc（_id 就是 6 位邀请码），每个成员一条 plan_members doc
 * （_id = '<planId>_<openid>'）。一人一 doc 的好处：push 只写自己那条，
 * 天然没有并发覆盖问题，不需要乐观锁，也不受单 doc 16MB 上限约束。
 *
 * openid 只从 cloud.getWXContext() 取，不接受客户端传；
 * 返回成员列表时也会剥掉 openid，只给调用者自己那条打 isMe ——
 * 客户端拿不到自己的 openid，只能靠服务端标记。
 *
 * 集合权限设为「仅管理端可读写」，客户端不直连数据库。
 *
 * action:
 *   create  建计划（服务端生成邀请码），并把自己加进去
 *   join    用邀请码加入；已加入过则是改昵称 + 覆盖自己的点
 *   push    只更新自己的 points（打卡后自动调用）
 *   members 拉计划的成员曲线
 *   leave   退出计划（删掉自己那条成员数据）
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID
  if (!openid) return { ok: false, code: 'NO_AUTH' }

  const action = event && event.action
  const now = Date.now()

  try {
    if (action === 'create') return await createPlan(event, openid, now)
    if (action === 'join') return await joinPlan(event, openid, now)
    if (action === 'push') return await pushPoints(event, openid, now)
    if (action === 'members') return await listMembers(event, openid)
    if (action === 'leave') return await leavePlan(event, openid)
    return { ok: false, code: 'BAD_ACTION' }
  } catch (e) {
    const message = String((e && e.message) || e)
    // 集合没建（或名字不对）：这不是数据问题，提示得明确一点，否则只会看到「操作失败」
    if (/collection/i.test(message)) return { ok: false, code: 'NO_COLLECTION', message }
    return { ok: false, code: 'INTERNAL', message }
  }
}

function db() {
  return cloud.database()
}

function memberId(planId, openid) {
  return `${planId}_${openid}`
}

/** 读取单条 doc，不存在返回 null（集合不存在时向上抛，交给最外层统一报 NO_COLLECTION） */
async function getDoc(coll, id) {
  try {
    const res = await db().collection(coll).doc(id).get()
    return res && res.data ? res.data : null
  } catch (e) {
    const message = String((e && e.message) || e)
    if (/collection/i.test(message)) throw e
    return null
  }
}

function randomCode() {
  const buf = crypto.randomBytes(CODE_LEN)
  let s = ''
  for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[buf[i] % CODE_CHARS.length]
  return s
}

function sanitizeText(v, max) {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, max)
}

function round1(n) {
  return Math.round(n * 10) / 10
}

/**
 * 只留 date + weight：备注、身高、目标体重一律不上云。
 * 顺带做「每天一条」的去重（同日取最后一条）与区间校验 —— 客户端已经校验过，
 * 这里再校验一次是因为任何人都能直接调云函数。
 */
function sanitizePoints(input) {
  if (!Array.isArray(input)) return []
  const byDate = new Map()
  for (const p of input) {
    if (!p || typeof p !== 'object') continue
    if (typeof p.date !== 'string' || !DATE_RE.test(p.date)) continue
    if (typeof p.weight !== 'number' || !Number.isFinite(p.weight)) continue
    const w = round1(p.weight)
    if (w < WEIGHT_MIN || w > WEIGHT_MAX) continue
    byDate.set(p.date, w)
  }
  return Array.from(byDate, ([date, weight]) => ({ date, weight }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-MAX_POINTS)
}

async function countMembers(planId) {
  const res = await db().collection(MEMBERS).where({ planId }).limit(MAX_MEMBERS + 1).get()
  return res && Array.isArray(res.data) ? res.data.length : 0
}

async function createPlan(event, openid, now) {
  const name = sanitizeText(event.name, NAME_MAX) || '减肥计划'
  const nickname = sanitizeText(event.nickname, NICKNAME_MAX) || '我'
  const points = sanitizePoints(event.points)

  // 邀请码由服务端生成：客户端生成就得先查一次有没有撞，多一次往返还可能撞。
  // 这里用 add（不是 set）—— set 是 upsert，码撞车会静默覆盖掉别人的计划。
  let code = ''
  for (let i = 0; i < 5; i++) {
    const candidate = randomCode()
    try {
      await db()
        .collection(PLANS)
        .add({ data: { _id: candidate, code: candidate, name, createdAt: now, createdBy: openid } })
      code = candidate
      break
    } catch (e) {
      const message = String((e && e.message) || e)
      if (/collection/i.test(message)) throw e
      // 只有「这个 _id 已经存在」才换码重试，其它错误（权限等）重试也没用
      if (await getDoc(PLANS, candidate)) continue
      throw e
    }
  }
  if (!code) return { ok: false, code: 'CODE_CONFLICT' }

  await db()
    .collection(MEMBERS)
    .doc(memberId(code, openid))
    .set({
      data: { planId: code, openid, nickname, joinedAt: now, updatedAt: now, points },
    })

  return { ok: true, plan: { id: code, name, code } }
}

async function joinPlan(event, openid, now) {
  const code = sanitizeText(event.code, CODE_LEN).toUpperCase()
  if (!CODE_RE.test(code)) return { ok: false, code: 'BAD_CODE' }

  const plan = await getDoc(PLANS, code)
  if (!plan) return { ok: false, code: 'NO_PLAN' }

  const nickname = sanitizeText(event.nickname, NICKNAME_MAX) || '好友'
  const points = sanitizePoints(event.points)
  const id = memberId(code, openid)
  const mine = await getDoc(MEMBERS, id)

  // 已经在册（= 只是改昵称/覆盖点）就不占名额
  if (!mine && (await countMembers(code)) >= MAX_MEMBERS) return { ok: false, code: 'FULL' }

  await db()
    .collection(MEMBERS)
    .doc(id)
    .set({
      data: {
        planId: code,
        openid,
        nickname,
        joinedAt: mine && typeof mine.joinedAt === 'number' ? mine.joinedAt : now,
        updatedAt: now,
        points,
      },
    })

  return { ok: true, plan: { id: code, name: plan.name, code } }
}

async function pushPoints(event, openid, now) {
  const planId = sanitizeText(event.planId, 32)
  if (!planId) return { ok: false, code: 'BAD_PLAN' }

  const points = sanitizePoints(event.points)
  const id = memberId(planId, openid)

  // 只改 points/updatedAt：昵称不能被静默冲掉。
  // doc 还不存在时（首次打卡先于 join）update 返回 updated:0，退回 set 建一条。
  const res = await db().collection(MEMBERS).doc(id).update({ data: { points, updatedAt: now } })
  if (!res || !res.stats || res.stats.updated === 0) {
    await db()
      .collection(MEMBERS)
      .doc(id)
      .set({
        data: {
          planId,
          openid,
          nickname: '好友',
          joinedAt: now,
          updatedAt: now,
          points,
        },
      })
  }
  return { ok: true, updatedAt: now }
}

async function listMembers(event, openid) {
  const planId = sanitizeText(event.planId, 32)
  if (!planId) return { ok: false, code: 'BAD_PLAN' }

  const plan = await getDoc(PLANS, planId)
  if (!plan) return { ok: false, code: 'NO_PLAN' }

  const res = await db().collection(MEMBERS).where({ planId }).limit(MAX_MEMBERS).get()
  const rows = Array.isArray(res && res.data) ? res.data.slice() : []
  rows.sort((a, b) => {
    const d = (a.joinedAt || 0) - (b.joinedAt || 0)
    return d !== 0 ? d : String(a._id) < String(b._id) ? -1 : 1
  })

  // 剥掉 openid（_id 里也有 openid，所以列表 id 另起一个稳定编号）
  const members = rows.map((m, i) => ({
    id: `m${i}`,
    nickname: typeof m.nickname === 'string' && m.nickname ? m.nickname : '好友',
    points: Array.isArray(m.points) ? m.points : [],
    updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : 0,
    isMe: m.openid === openid,
  }))

  return { ok: true, plan: { id: planId, name: plan.name, code: planId }, members }
}

async function leavePlan(event, openid) {
  const planId = sanitizeText(event.planId, 32)
  if (!planId) return { ok: false, code: 'BAD_PLAN' }
  await db().collection(MEMBERS).where({ planId, openid }).remove()
  return { ok: true }
}
