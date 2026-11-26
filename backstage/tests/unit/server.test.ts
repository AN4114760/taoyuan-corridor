// 地端伺服器 API：用暫存資料夾啟動，不動到真正的 data/
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// @ts-expect-error 純 JS 模組
import { createApp } from '../../server.mjs'

const REPO = resolve(__dirname, '../../..')
const PY = join(REPO, '.venv/bin/python')
let root: string, base: string, server: { close(): void; address(): AddressInfo | string | null }
const PIN = '246810'
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='

const call = (path: string, init: RequestInit & { pin?: string } = {}) => fetch(`${base}/api/${path}`, {
  ...init, headers: { 'content-type': 'application/json', ...(init.pin ? { 'x-admin-pin': init.pin } : {}) },
})
const good = {
  participantGroup: 'wheelchair', segId: 'taoyuan_hospital-sw009', lat: 24.977, lng: 121.269, safety: 2, comfort: 2,
  comment: '樹穴太大', anomalies: [{ category: 'tree-obstruction', note: '', photos: [JPEG] }],
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'corridor-'))
  for (const p of ['config.yaml', 'module4', 'data/outputs/taoyuan_hospital_severity.geojson', 'data/outputs/taoyuan_hospital_features.geojson']) {
    cpSync(join(REPO, p), join(root, p), { recursive: true })
  }
  server = createApp({ root, pin: PIN, python: existsSync(PY) ? PY : 'python3', dist: join(root, 'no-dist') })
  await new Promise<void>((ok) => (server as unknown as { listen(p: number, h: string, cb: () => void): void }).listen(0, '127.0.0.1', ok))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.close(); rmSync(root, { recursive: true, force: true }) })

describe('志工回饋', () => {
  let id = ''
  it('送出成功，狀態為待審核', async () => {
    const r = await call('feedback', { method: 'POST', body: JSON.stringify(good) })
    expect(r.status).toBe(201)
    id = (await r.json()).id
  })
  it('格式錯誤 → 400 並說明原因', async () => {
    const r = await call('feedback', { method: 'POST', body: JSON.stringify({ ...good, safety: 7, segId: 'nope', anomalies: [{ category: 'x', photos: ['data:text/html,hi'] }] }) })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/safety.*segId.*類別.*照片/)
  })
  it('沒有 PIN 不能看列表、不能審核', async () => {
    expect((await call('feedback')).status).toBe(401)
    expect((await call(`feedback/${id}`, { method: 'PATCH', body: '{"status":"confirmed"}', pin: 'wrong1' })).status).toBe(401)
  })
  it('後台列表不含照片本體，照片另外取得', async () => {
    const list = await (await call('feedback', { pin: PIN })).json()
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('new')
    expect(list[0].anomalies[0]).toEqual({ category: 'tree-obstruction', photoCount: 1 })
    const img = await fetch(`${base}/api/feedback/${id}/photo/0/0?pin=${PIN}`)
    expect(img.headers.get('content-type')).toBe('image/jpeg')
  })
  it('審核：確認＋備註；status 不合法 → 400', async () => {
    const r = await call(`feedback/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'confirmed', reviewNote: '現場確認' }), pin: PIN })
    expect((await r.json()).reviewNote).toBe('現場確認')
    expect((await call(`feedback/${id}`, { method: 'PATCH', body: '{"status":"resolved"}', pin: PIN })).status).toBe(400)
  })
  it('重新計算：已確認的異狀計入該路段', async () => {
    const r = await call('integrate', { method: 'POST', pin: PIN })
    expect(r.status).toBe(200)
    const fc = await (await call('integrated')).json()
    const p = fc.features.find((f: { properties: { seg_id: string } }) => f.properties.seg_id === good.segId).properties
    expect(p.counts.confirmed_anomalies).toBe(1)
    expect(p.grade).toBe('D')
    expect((await fetch(`${base}/api/priorities.csv?pin=${PIN}`)).status).toBe(200)
  })
})
