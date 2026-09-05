import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * local-server 的端到端测试：起一个真实 HTTP 服务，用真实请求走「打卡 → 落盘」全程，
 * 并直接读 records.json 确认数据真的进了本地文件。
 *
 * 数据目录用临时目录（WR_DATA_DIR），不会碰到 local-server/data 里的真实体重数据。
 * 环境变量必须在 import server.js 之前设好 —— 它在模块加载时就解析 DATA_DIR。
 */

let base = ''
let dataDir = ''
let srv: any

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: any = text
  try {
    data = JSON.parse(text)
  } catch {
    // CSV 等非 JSON 响应，保留原文
  }
  return { status: res.status, data, text }
}

function recordsOnDisk(): any[] {
  return JSON.parse(readFileSync(join(dataDir, 'records.json'), 'utf8'))
}

function profileOnDisk(): any {
  return JSON.parse(readFileSync(join(dataDir, 'profile.json'), 'utf8'))
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'weightrecord-test-'))
  process.env.WR_DATA_DIR = dataDir

  const mod: any = await import('../local-server/server.js')
  srv = mod.server ?? mod.default?.server
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()))
  base = `http://127.0.0.1:${srv.address().port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => srv.close(() => resolve()))
})

describe('打卡写入', () => {
  it('新增一条：201、体重保留 1 位小数、真的落到 records.json', async () => {
    const res = await api('POST', '/api/records', { date: '2026-09-01', weight: 70.26 })

    expect(res.status).toBe(201)
    expect(res.data.created).toBe(true)
    expect(res.data.record.weight).toBe(70.3)

    const disk = recordsOnDisk()
    expect(disk).toHaveLength(1)
    expect(disk[0]).toMatchObject({ date: '2026-09-01', weight: 70.3, note: '' })
    expect(typeof disk[0]._id).toBe('string')
    expect(disk[0].createdAt).toBeGreaterThan(0)
  })

  it('同一天再写是覆盖而非新增（「每天一条」不变量）', async () => {
    const res = await api('POST', '/api/records', { date: '2026-09-01', weight: 71 })

    expect(res.status).toBe(200)
    expect(res.data.created).toBe(false)

    const disk = recordsOnDisk()
    expect(disk).toHaveLength(1)
    expect(disk[0].weight).toBe(71)
  })

  it('只改体重、不带 note 时保留已有备注', async () => {
    await api('POST', '/api/records', { date: '2026-09-02', weight: 68, note: '跑步后' })
    const res = await api('POST', '/api/records', { date: '2026-09-02', weight: 68.5 })

    expect(res.status).toBe(200)
    expect(res.data.record.note).toBe('跑步后')
    expect(res.data.record.weight).toBe(68.5)
  })

  it('显式传空 note 才清空备注', async () => {
    const res = await api('POST', '/api/records', { date: '2026-09-02', weight: 68.5, note: '' })
    expect(res.data.record.note).toBe('')
  })
})

describe('入参校验', () => {
  it.each(['2026-9-3', '20260903', '', 'today'])('非法日期 %j → 400', async (date) => {
    const res = await api('POST', '/api/records', { date, weight: 70 })
    expect(res.status).toBe(400)
    expect(res.data.error).toContain('YYYY-MM-DD')
  })

  it.each([10, 0, 301, 500, -70, 'abc'])('越界体重 %j → 400', async (weight) => {
    const res = await api('POST', '/api/records', { date: '2026-09-03', weight })
    expect(res.status).toBe(400)
    expect(res.data.error).toContain('20-300')
  })

  it('校验失败不会写进文件', async () => {
    expect(recordsOnDisk().some((r) => r.date === '2026-09-03')).toBe(false)
  })
})

describe('读取', () => {
  it('GET /api/records 按日期升序', async () => {
    await api('POST', '/api/records', { date: '2026-08-20', weight: 72 })
    const res = await api('GET', '/api/records')

    expect(res.status).toBe(200)
    expect(res.data.map((r: any) => r.date)).toEqual(['2026-08-20', '2026-09-01', '2026-09-02'])
  })

  it('GET /api/health 报出当前条数', async () => {
    const res = await api('GET', '/api/health')
    expect(res.data).toMatchObject({ ok: true, records: 3 })
  })
})

describe('删除', () => {
  it('删除存在的记录 → 200 且从文件里消失', async () => {
    const id = recordsOnDisk().find((r) => r.date === '2026-08-20')._id
    const res = await api('DELETE', `/api/records/${id}`)

    expect(res.status).toBe(200)
    expect(recordsOnDisk().some((r) => r.date === '2026-08-20')).toBe(false)
  })

  it('删除不存在的记录 → 404', async () => {
    const res = await api('DELETE', '/api/records/r_not_exist')
    expect(res.status).toBe(404)
  })
})

describe('档案', () => {
  it('首次 GET 自动建默认档案，且不含已删除的提醒字段', async () => {
    const res = await api('GET', '/api/profile')

    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({ _id: 'profile_local', heightCm: 0, targetWeight: 0 })
    expect(res.data).not.toHaveProperty('reminderEnabled')
    expect(res.data).not.toHaveProperty('reminderHour')
    expect(profileOnDisk()._id).toBe('profile_local')
  })

  it('POST 合并已知字段、忽略未知字段、刷新 updatedAt', async () => {
    const res = await api('POST', '/api/profile', { heightCm: 175, nickname: '注入的字段' })

    expect(res.data.profile.heightCm).toBe(175)
    expect(res.data.profile).not.toHaveProperty('nickname')
    expect(res.data.profile.updatedAt).toBeGreaterThan(0)

    // 再次局部更新不该丢掉上一次的字段
    const res2 = await api('POST', '/api/profile', { targetWeight: 65 })
    expect(res2.data.profile).toMatchObject({ heightCm: 175, targetWeight: 65 })
    expect(profileOnDisk()).toMatchObject({ heightCm: 175, targetWeight: 65 })
  })
})

describe('导出', () => {
  it('CSV 带 BOM 和表头，一行一条记录', async () => {
    // 必须看原始字节：fetch 的 res.text() 按规范会吃掉开头的 BOM，
    // 用它断言会误判成「服务端没发 BOM」。
    const res = await fetch(base + '/api/export.csv')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')

    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]) // Excel 靠 BOM 认出 UTF-8

    const lines = new TextDecoder().decode(bytes.slice(3)).split('\n')
    expect(lines[0]).toBe('date,weight,note,createdAt,updatedAt')
    expect(lines).toHaveLength(1 + recordsOnDisk().length)
  })
})
