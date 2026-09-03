const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 每日打卡提醒。由 config.json 里的定时触发器每小时整点唤起。
 *
 * 逻辑：算出当前北京时间的小时 → 找出 reminderHour 等于该小时且开了提醒的用户
 * → 跳过今天已经打过卡的 → 发订阅消息。
 *
 * 必须和小程序端保持一致的两处：
 *   - TMPL_ID 要等于 miniprogram/config.ts 的 REMINDER_TMPL_ID
 *   - MSG_DATA 的字段名（thing1 / time2 之类）取决于你在后台申请到的模板，
 *     字段对不上微信会直接报 47003，改模板后务必同步这里。
 */

const TMPL_ID = ''

/** 云函数端单次 get() 上限 100 条 */
const PAGE = 100

/** 云函数运行在 UTC，转成北京时间的小时 */
function beijingHour() {
  return (new Date().getUTCHours() + 8) % 24
}

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function beijingDateStr() {
  const t = new Date(Date.now() + 8 * 3600 * 1000)
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

/** 分页取出本小时该提醒的全部用户 */
async function targetsForHour(hour) {
  const out = []
  for (let page = 0; ; page++) {
    const res = await db
      .collection('user_profile')
      .where({ reminderEnabled: true, reminderHour: hour })
      .skip(page * PAGE)
      .limit(PAGE)
      .get()
    out.push(...res.data)
    if (res.data.length < PAGE) break
  }
  return out
}

/** 该用户今天是否已打卡 */
async function alreadyLogged(openid, date) {
  const res = await db
    .collection('weight_records')
    .where({ _openid: openid, date })
    .count()
  return res.total > 0
}

exports.main = async () => {
  if (!TMPL_ID) {
    console.error('remindDaily: TMPL_ID 未配置，跳过本次执行')
    return { skipped: 'no-template' }
  }

  const hour = beijingHour()
  const today = beijingDateStr()
  const users = await targetsForHour(hour)

  let sent = 0
  let skipped = 0
  const failures = []

  for (const u of users) {
    if (!u._openid) continue

    if (await alreadyLogged(u._openid, today)) {
      skipped++
      continue
    }

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: u._openid,
        templateId: TMPL_ID,
        page: 'pages/index/index',
        // 字段名必须与后台模板一致，见文件头注释
        data: {
          thing1: { value: '今天还没记录体重' },
          // 小时必须补零：time 类型字段要 24 小时制 HH:MM，'8:00' 会被判非法
          // 而报 47003 —— 那样「提醒设在 0-9 点的用户永远收不到」，很难查
          time2: { value: `${today} ${pad2(hour)}:00` },
        },
      })
      sent++
    } catch (err) {
      // 单个用户失败（多半是订阅额度用尽，errCode 43101）不该中断其他人
      failures.push({ openid: u._openid, errCode: err.errCode, msg: err.errMsg })
    }
  }

  console.log(`remindDaily hour=${hour} sent=${sent} skipped=${skipped} failed=${failures.length}`)
  return { hour, sent, skipped, failures }
}
