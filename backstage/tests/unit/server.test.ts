// 地端伺服器 API：用暫存資料夾啟動，不動到真正的 data/
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// @ts-expect-error 純 JS 模組
import { createApp } from '../../server.mjs'

const REPO = resolve(__dirname, '../../..')
const PY = process.env.CORRIDOR_PYTHON
  ?? [join(REPO, '.venv/bin/python'), join(REPO, '.venv/Scripts/python.exe')].find(existsSync)
  ?? (process.platform === 'win32' ? 'python' : 'python3')
let root: string, base: string, server: { close(): void; address(): AddressInfo | string | null }
const PIN = '246810'
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='

const call = (path: string, init: RequestInit & { pin?: string; token?: string } = {}) => fetch(`${base}/api/${path}`, {
  ...init,
  headers: {
    'content-type': 'application/json',
    ...(init.pin ? { 'x-admin-pin': init.pin } : {}),
    ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
  },
})
const json = (b: unknown) => JSON.stringify(b)
const walk = { startedAt: '2026-11-27T10:00:00+08:00', startLat: 24.977, startLng: 121.269, startDistanceM: 12, startAccuracyM: 8 }
const good = {
  participantGroup: 'wheelchair', segId: 'taoyuan_hospital-sw009', lat: 24.977, lng: 121.269, safety: 2, comfort: 2,
  comment: '樹穴太大', anomalies: [{ category: 'tree-obstruction', note: '', photos: [JPEG] }], walk,
}
const video = {
  fileName: 'drive-01.mp4', sizeBytes: 1234, contentType: 'video/mp4', recordedAt: '2026-11-27T09:00:00+08:00',
  storagePath: 'videos/anon/abc/drive-01.mp4', downloadUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/y?token=z', note: '中山路',
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'corridor-'))
  for (const p of ['config.yaml', 'module4', 'data/outputs/taoyuan_hospital_severity.geojson', 'data/outputs/taoyuan_hospital_features.geojson']) {
    cpSync(join(REPO, p), join(root, p), { recursive: true })
  }
  server = createApp({ root, pin: PIN, python: PY, dist: join(root, 'no-dist'), secret: 'test-secret' })
  await new Promise<void>((ok) => (server as unknown as { listen(p: number, h: string, cb: () => void): void }).listen(0, '127.0.0.1', ok))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.close(); rmSync(root, { recursive: true, force: true }) })

let token = '', userId = ''

describe('帳號', () => {
  const reg = { phone: '0912-345-678', password: 'secret1', name: '小林', participantGroup: 'wheelchair' }
  it('註冊：新帳號為待開通（role 0），回應不含密碼', async () => {
    const r = await call('auth/register', { method: 'POST', body: json(reg) })
    expect(r.status).toBe(201)
    const { token: t, user } = await r.json()
    expect(user).toMatchObject({ phone: '0912345678', name: '小林', role: 0 })
    expect(user.passwordHash).toBeUndefined()
    token = t
    userId = user.id
  })
  it('同一個手機號碼不能重複註冊；格式錯誤 → 400', async () => {
    expect((await call('auth/register', { method: 'POST', body: json(reg) })).status).toBe(409)
    expect((await call('auth/register', { method: 'POST', body: json({ ...reg, phone: '12345' }) })).status).toBe(400)
  })
  it('登入：密碼錯 → 401；正確 → token 可取得自己的資料', async () => {
    expect((await call('auth/login', { method: 'POST', body: json({ phone: reg.phone, password: 'wrong12' }) })).status).toBe(401)
    const r = await call('auth/login', { method: 'POST', body: json({ phone: '0912345678', password: 'secret1' }) })
    const me = await (await call('me', { token: (await r.json()).token })).json()
    expect(me.id).toBe(userId)
    expect((await call('me', { token: 'forged.token' })).status).toBe(401)
  })
  it('待開通帳號不能送回饋、不能登記影片', async () => {
    expect((await call('feedback', { method: 'POST', body: json(good), token })).status).toBe(403)
    expect((await call('me/videos', { method: 'POST', body: json(video), token })).status).toBe(403)
    expect((await call('feedback', { method: 'POST', body: json(good) })).status).toBe(401)
  })
  it('只有後台（PIN）能改身分', async () => {
    expect((await call(`users/${userId}`, { method: 'PATCH', body: json({ role: 3 }) })).status).toBe(401)
    expect((await call(`users/${userId}`, { method: 'PATCH', body: json({ role: 9 }), pin: PIN })).status).toBe(400)
    const r = await call(`users/${userId}`, { method: 'PATCH', body: json({ role: 1 }), pin: PIN })
    expect((await r.json()).role).toBe(1)
  })
})

describe('志工回饋', () => {
  let id = ''
  it('送出成功，狀態為待審核，記錄帳號與開始走訪的定位', async () => {
    const moments = [{ at: '2026-11-28T08:00:00Z', lat: 24.977, lng: 121.269, along: 42.04, safety: 2, tags: ['要繞過障礙'], hotspotId: 'box-1' }]
    const r = await call('feedback', { method: 'POST', body: json({ ...good, moments }), token })
    expect(r.status).toBe(201)
    id = (await r.json()).id
    const [mine] = await (await call('me/feedback', { token })).json()
    expect(mine).toMatchObject({ id, userId, volunteerName: '小林', status: 'new', walk: { startDistanceM: 12 } })
    expect(mine.moments).toEqual([{ ...moments[0], along: 42 }])
  })
  it('沿路感受格式錯誤 → 400', async () => {
    const r = await call('feedback', { method: 'POST', body: json({ ...good, moments: [{ lat: 24.9, lng: 121.2, along: 3, safety: 0, tags: 'x' }] }), token })
    expect((await r.json()).error).toMatch(/感受 1：safety.*標籤/)
  })
  it('開始位置超過 50m 或沒有定位紀錄 → 400', async () => {
    const far = await call('feedback', { method: 'POST', body: json({ ...good, walk: { ...walk, startDistanceM: 80 } }), token })
    expect((await far.json()).error).toMatch(/50m/)
    expect((await call('feedback', { method: 'POST', body: json({ ...good, walk: undefined }), token })).status).toBe(400)
  })
  it('格式錯誤 → 400 並說明原因', async () => {
    const r = await call('feedback', { method: 'POST', body: json({ ...good, safety: 7, segId: 'nope', anomalies: [{ category: 'x', photos: ['data:text/html,hi'] }] }), token })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/safety.*segId.*類別.*照片/)
  })
  it('自己看得到自己的照片，別人看不到', async () => {
    expect((await fetch(`${base}/api/me/feedback/${id}/photo/0/0?token=${token}`)).headers.get('content-type')).toBe('image/jpeg')
    const other = await (await call('auth/register', { method: 'POST', body: json({ phone: '0987654321', password: 'other12', name: '小王', participantGroup: 'general' }) })).json()
    expect((await fetch(`${base}/api/me/feedback/${id}/photo/0/0?token=${other.token}`)).status).toBe(404)
    expect(await (await call('me/feedback', { token: other.token })).json()).toEqual([])
  })
  it('沒有 PIN 不能看列表、不能審核', async () => {
    expect((await call('feedback')).status).toBe(401)
    expect((await call(`feedback/${id}`, { method: 'PATCH', body: '{"status":"confirmed"}', pin: 'wrong1' })).status).toBe(401)
  })
  it('後台列表不含照片本體，照片另外取得', async () => {
    const list = await (await call('feedback', { pin: PIN })).json()
    expect(list).toHaveLength(1)
    expect(list[0].anomalies[0]).toEqual({ category: 'tree-obstruction', photoCount: 1 })
    const img = await fetch(`${base}/api/feedback/${id}/photo/0/0?pin=${PIN}`)
    expect(img.headers.get('content-type')).toBe('image/jpeg')
    expect(Buffer.from(await img.arrayBuffer())).toEqual(Buffer.from(JPEG.split(',')[1], 'base64'))
  })
  it('照片另存成檔案，feedback.json 只記路徑', () => {
    const [f] = JSON.parse(readFileSync(join(root, 'backstage/data/feedback.json'), 'utf8'))
    expect(f.anomalies[0].photos).toEqual([`photos/${id}/0-0.jpg`])
    expect(existsSync(join(root, 'backstage/data', f.anomalies[0].photos[0]))).toBe(true)
  })
  it('審核：確認＋備註，志工看得到結果；status 不合法 → 400', async () => {
    const r = await call(`feedback/${id}`, { method: 'PATCH', body: json({ status: 'confirmed', reviewNote: '現場確認' }), pin: PIN })
    expect((await r.json()).reviewNote).toBe('現場確認')
    const [mine] = await (await call('me/feedback', { token })).json()
    expect(mine).toMatchObject({ status: 'confirmed', reviewNote: '現場確認' })
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

describe('錄影上傳紀錄', () => {
  it('志工身分（role 1）不能登記影片；改成 3 之後可以', async () => {
    expect((await call('me/videos', { method: 'POST', body: json(video), token })).status).toBe(403)
    await call(`users/${userId}`, { method: 'PATCH', body: json({ role: 3 }), pin: PIN })
    const r = await call('me/videos', { method: 'POST', body: json(video), token })
    expect(r.status).toBe(201)
    expect(await r.json()).toMatchObject({ recorderName: '小林', processing: 'pending' })
  })
  it('格式錯誤 → 400', async () => {
    const r = await call('me/videos', { method: 'POST', body: json({ ...video, contentType: 'image/png', storagePath: '../x' }), token })
    expect((await r.json()).error).toMatch(/contentType.*storagePath/)
  })
  it('後台更新處理狀態，錄影人員看得到', async () => {
    expect((await call('videos')).status).toBe(401)
    const [v] = await (await call('videos', { pin: PIN })).json()
    await call(`videos/${v.id}`, { method: 'PATCH', body: json({ processing: 'processed', adminNote: '已辨識' }), pin: PIN })
    const [mine] = await (await call('me/videos', { token })).json()
    expect(mine).toMatchObject({ processing: 'processed', adminNote: '已辨識' })
  })
  it('後台帳號列表含回饋數、影片數，不含密碼', async () => {
    const users = await (await call('users', { pin: PIN })).json()
    const me = users.find((u: { id: string }) => u.id === userId)
    expect(me).toMatchObject({ role: 3, feedbackCount: 1, videoCount: 1 })
    expect(me.passwordHash).toBeUndefined()
  })
})
