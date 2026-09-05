#!/usr/bin/env node
/**
 * WeightRecord 本地数据服务（零依赖，只用 Node 内置模块）。
 *
 * 用途：小程序（微信开发者工具模拟器 / 真机预览）把体重记录、个人档案
 *       通过 HTTP 直传到你自己的电脑，数据落盘在 ./data 下，
 *       方便直接用 Excel / 文本编辑器查看。
 *
 * 启动：node server.js
 *       默认端口 8765，可用环境变量 PORT 覆盖。
 *
 * API 一览：
 *   GET    /api/health          健康检查，返回记录条数
 *   GET    /api/records         全部记录（按 date 升序）
 *   POST   /api/records         新增/覆盖一条（body: {date, weight, note?}），按 date 唯一
 *   DELETE /api/records/:id     按 _id 删除
 *   GET    /api/profile         读取档案（不存在则自动建默认档案）
 *   POST   /api/profile         合并更新档案（body 为要更新的字段）
 *   GET    /api/export.csv      导出全部记录为 CSV（带 BOM，Excel 直接打开不乱码）
 *
 * 数据文件：
 *   ./data/records.json    体重记录
 *   ./data/profile.json    个人档案
 */

'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PORT = Number(process.env.PORT || 8765)
const DATA_DIR = path.join(__dirname, 'data')
const RECORDS_FILE = path.join(DATA_DIR, 'records.json')
const PROFILE_FILE = path.join(DATA_DIR, 'profile.json')

/** 与服务端模型一致的默认档案（见 miniprogram/models/profile.ts DEFAULTS） */
const PROFILE_DEFAULTS = {
  heightCm: 0,
  targetWeight: 0,
  reminderEnabled: false,
  reminderHour: 20,
  updatedAt: 0,
}

// ---------- 存储 ----------

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readJson(file, fallback) {
  ensureDataDir()
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** 原子写：先写临时文件再 rename，避免写一半崩溃弄坏数据 */
function writeJson(file, data) {
  ensureDataDir()
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

let records = readJson(RECORDS_FILE, []) // WeightRecord[]
let profile = readJson(PROFILE_FILE, null) // UserProfile | null

if (!Array.isArray(records)) records = []

function persist() {
  writeJson(RECORDS_FILE, records)
  writeJson(PROFILE_FILE, profile)
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
}

// ---------- 业务逻辑 ----------

function upsertRecord(body) {
  const date = String(body.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'date 必须形如 YYYY-MM-DD', status: 400 }
  }
  const weight = Number(body.weight)
  if (!Number.isFinite(weight) || weight <= 0 || weight > 500) {
    return { error: 'weight 必须是大于 0 的数字（kg）', status: 400 }
  }
  const now = Date.now()
  const note = body.note === undefined ? '' : String(body.note)

  const existing = records.find((r) => r.date === date)
  if (existing) {
    existing.weight = Math.round(weight * 10) / 10
    existing.note = note
    existing.updatedAt = now
    return { record: existing, created: false }
  }

  const record = {
    _id: genId('r'),
    date,
    weight: Math.round(weight * 10) / 10,
    note,
    createdAt: now,
    updatedAt: now,
  }
  records.push(record)
  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { record, created: true }
}

function getProfile() {
  if (!profile) {
    profile = { _id: 'profile_local', ...PROFILE_DEFAULTS }
    persist()
  }
  return profile
}

function updateProfile(patch) {
  const base = getProfile()
  // 只允许更新已知字段，防止注入无关键
  for (const key of Object.keys(PROFILE_DEFAULTS)) {
    if (patch[key] !== undefined) base[key] = patch[key]
  }
  base.updatedAt = Date.now()
  return base
}

function toCsv() {
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const head = 'date,weight,note,createdAt,updatedAt'
  const rows = records
    .map((r) => [r.date, r.weight, esc(r.note ?? ''), r.createdAt, r.updatedAt].join(','))
    .join('\n')
  return '\uFEFF' + head + (rows ? '\n' + rows : '') // BOM 让 Excel 正确识别 UTF-8
}

// ---------- HTTP 层 ----------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(body)
}

function sendText(res, status, text, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(text)
}

function readBody(req, cb) {
  const chunks = []
  let size = 0
  req.on('data', (c) => {
    size += c.length
    if (size > 1_000_000) {
      cb(new Error('body too large'))
      req.destroy()
      return
    }
    chunks.push(c)
  })
  req.on('end', () => {
    try {
      const text = Buffer.concat(chunks).toString('utf8')
      cb(null, text ? JSON.parse(text) : {})
    } catch (e) {
      cb(e)
    }
  })
  req.on('error', cb)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const parts = url.pathname.split('/').filter(Boolean) // ['api', 'records', ...]

  // 跨域预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  try {
    if (parts[0] !== 'api') {
      sendJson(res, 404, { error: 'not found' })
      return
    }

    // GET /api/health
    if (parts[1] === 'health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, records: records.length, port: PORT })
      return
    }

    // GET /api/records  /api/export.csv
    if (parts[1] === 'records' && parts.length === 2) {
      if (req.method === 'GET') {
        // 查询参数可选：?csv=1 直接导出 CSV
        if (url.searchParams.get('csv') === '1') {
          sendText(res, 200, toCsv(), 'text/csv; charset=utf-8')
        } else {
          sendJson(res, 200, records)
        }
        return
      }
      if (req.method === 'POST') {
        readBody(req, (err, body) => {
          if (err) {
            sendJson(res, 400, { error: '请求体不是合法 JSON' })
            return
          }
          const r = upsertRecord(body || {})
          if (r.error) {
            sendJson(res, r.status || 400, { error: r.error })
            return
          }
          persist()
          sendJson(res, r.created ? 201 : 200, { ok: true, record: r.record, created: r.created })
        })
        return
      }
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }

    // GET /api/export.csv
    if (parts[1] === 'export.csv' && req.method === 'GET') {
      sendText(res, 200, toCsv(), 'text/csv; charset=utf-8')
      return
    }

    // DELETE /api/records/:id
    if (parts[1] === 'records' && parts.length === 3 && req.method === 'DELETE') {
      const id = decodeURIComponent(parts[2])
      const before = records.length
      records = records.filter((r) => r._id !== id)
      if (records.length === before) {
        sendJson(res, 404, { error: '记录不存在' })
        return
      }
      persist()
      sendJson(res, 200, { ok: true })
      return
    }

    // GET/POST /api/profile
    if (parts[1] === 'profile' && parts.length === 2) {
      if (req.method === 'GET') {
        sendJson(res, 200, getProfile())
        return
      }
      if (req.method === 'POST') {
        readBody(req, (err, body) => {
          if (err) {
            sendJson(res, 400, { error: '请求体不是合法 JSON' })
            return
          }
          const updated = updateProfile(body || {})
          persist()
          sendJson(res, 200, { ok: true, profile: updated })
        })
        return
      }
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }

    sendJson(res, 404, { error: 'not found' })
  } catch (e) {
    sendJson(res, 500, { error: 'server error: ' + e.message })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[WeightRecord] 本地数据服务已启动`)
  console.log(`  本机访问:   http://127.0.0.1:${PORT}`)
  console.log(`  局域网访问: http://<本机IP>:${PORT}  （真机预览时用这个，需与本机同一 Wi-Fi）`)
  console.log(`  数据目录:   ${DATA_DIR}`)
  console.log(`  导出 CSV:   http://127.0.0.1:${PORT}/api/export.csv`)
})
