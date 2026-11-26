// 地端後台伺服器：只用 Node 內建模組，資料存成 repo 內的 JSON／CSV 檔。
//   npm start          → 先 build，再在 http://<本機 IP>:8787 提供網頁與 API
//   npm run server     → 只開 API（開發時搭配 npm run dev，vite 會把 /api 轉過來）
// 資料：
//   data/outputs/<site>_severity.geojson、_features.geojson   模組一（唯讀）
//   data/module2/*.csv、data/module3/*.csv                      隊友交件（唯讀，前端依 data-contract 驗證）
//   data/backend/feedback.json                                  志工回饋（含 base64 照片）
//   data/outputs/<site>_integrated.geojson、_priorities.csv     module4/integrate.py 輸出
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const CATEGORIES = ['tree-obstruction', 'parked-vehicle', 'broken-surface', 'no-ramp', 'tactile-broken',
  'too-narrow', 'no-sidewalk', 'pickup-problem', 'other']
export const GROUPS = ['wheelchair', 'elderly', 'visually-impaired', 'general']
const STATUSES = ['new', 'confirmed', 'rejected']
const MAX_BODY = 8 * 1024 * 1024
const MAX_PHOTO_CHARS = 900_000 // 約 650KB JPEG；前端壓縮後通常 150–250KB

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }

function readEnvFile(file) {
  if (!existsSync(file)) return {}
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n')
    .map((l) => l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]))
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

/** 建立伺服器（測試時可指定 root、pin） */
export function createApp({ root = resolve(HERE, '..'), site = 'taoyuan_hospital', pin, python, dist = join(HERE, 'dist') } = {}) {
  const P = {
    severity: join(root, 'data/outputs', `${site}_severity.geojson`),
    features: join(root, 'data/outputs', `${site}_features.geojson`),
    integrated: join(root, 'data/outputs', `${site}_integrated.geojson`),
    priorities: join(root, 'data/outputs', `${site}_priorities.csv`),
    backend: join(root, 'data/backend'),
    feedback: join(root, 'data/backend/feedback.json'),
    module: (n) => join(root, `data/module${n}`),
  }
  python ??= [join(root, '.venv/bin/python'), 'python3'].find((p) => p === 'python3' || existsSync(p))

  let segIds = null
  async function segmentIds() {
    if (!segIds) {
      const fc = JSON.parse(await readFile(P.severity, 'utf8'))
      segIds = new Set(fc.features.map((f) => f.properties.seg_id))
    }
    return segIds
  }

  // ---- 志工回饋檔：讀寫序列化，寫入前備份，先寫暫存檔再 rename ----
  let queue = Promise.resolve()
  const serial = (fn) => (queue = queue.then(fn, fn))
  async function loadFeedback() {
    try { return JSON.parse(await readFile(P.feedback, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
  }
  async function saveFeedback(list) {
    await mkdir(join(P.backend, '.bak'), { recursive: true })
    if (existsSync(P.feedback)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      await copyFile(P.feedback, join(P.backend, '.bak', `feedback-${stamp}.json`))
    }
    const tmp = `${P.feedback}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(list, null, 1))
    await rename(tmp, P.feedback)
  }
  const publicView = (f) => ({
    ...f, anomalies: f.anomalies.map(({ photos, ...a }) => ({ ...a, photoCount: photos?.length ?? 0 })),
  })

  async function validateFeedback(b) {
    const errs = []
    const int15 = (v) => Number.isInteger(v) && v >= 1 && v <= 5
    if (!GROUPS.includes(b.participantGroup)) errs.push('participantGroup 不在允許清單')
    if (!int15(b.safety)) errs.push('safety 需為 1–5 整數')
    if (!int15(b.comfort)) errs.push('comfort 需為 1–5 整數')
    if (!(await segmentIds()).has(b.segId)) errs.push('segId 不存在')
    if (!(Number.isFinite(b.lat) && Number.isFinite(b.lng))) errs.push('缺 lat/lng')
    if (b.comment != null && (typeof b.comment !== 'string' || b.comment.length > 1000)) errs.push('comment 最多 1000 字')
    if (b.volunteerName != null && (typeof b.volunteerName !== 'string' || b.volunteerName.length > 40)) errs.push('volunteerName 最多 40 字')
    const anomalies = Array.isArray(b.anomalies) ? b.anomalies : []
    if (anomalies.length > 10) errs.push('異狀最多 10 筆')
    anomalies.forEach((a, i) => {
      if (!CATEGORIES.includes(a?.category)) errs.push(`異狀 ${i + 1}：類別不在允許清單`)
      const photos = Array.isArray(a?.photos) ? a.photos : []
      if (photos.length > 3) errs.push(`異狀 ${i + 1}：照片最多 3 張`)
      if (photos.some((p) => typeof p !== 'string' || !p.startsWith('data:image/jpeg;base64,') || p.length > MAX_PHOTO_CHARS)) {
        errs.push(`異狀 ${i + 1}：照片需為壓縮後的 JPEG`)
      }
      if (a?.note != null && (typeof a.note !== 'string' || a.note.length > 500)) errs.push(`異狀 ${i + 1}：說明最多 500 字`)
    })
    if (errs.length) throw new HttpError(400, errs.join('；'))
    return {
      id: randomUUID(), createdAt: new Date().toISOString(), volunteerName: b.volunteerName?.trim() || undefined,
      participantGroup: b.participantGroup, segId: b.segId, lat: b.lat, lng: b.lng, safety: b.safety, comfort: b.comfort,
      comment: b.comment?.trim() || undefined,
      anomalies: anomalies.map((a) => ({ category: a.category, note: a.note?.trim() || undefined, photos: a.photos ?? [] })),
      status: 'new',
    }
  }

  function isAdmin(req, url) {
    const given = String(req.headers['x-admin-pin'] ?? url.searchParams.get('pin') ?? '')
    const a = Buffer.from(given), b = Buffer.from(String(pin))
    return a.length === b.length && timingSafeEqual(a, b)
  }
  function requireAdmin(req, url) { if (!isAdmin(req, url)) throw new HttpError(401, 'PIN 錯誤') }

  async function body(req) {
    const chunks = []; let size = 0
    for await (const c of req) {
      size += c.length
      if (size > MAX_BODY) throw new HttpError(413, '資料太大（照片請壓縮）')
      chunks.push(c)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HttpError(400, 'JSON 格式錯誤') }
  }

  async function moduleFiles(n) {
    const dir = P.module(n)
    const names = existsSync(dir) ? (await readdir(dir)).filter((f) => /\.(csv|json)$/i.test(f)).sort() : []
    return Promise.all(names.map(async (name) => {
      const s = await stat(join(dir, name))
      return { name, mtime: s.mtime.toISOString(), text: await readFile(join(dir, name), 'utf8') }
    }))
  }

  function runIntegrate() {
    return new Promise((ok, fail) => {
      execFile(python, [join(root, 'module4/integrate.py'), '--id', site], { cwd: root, timeout: 120_000 }, (err, stdout, stderr) => {
        if (err) fail(new HttpError(500, `integrate.py 失敗：${(stderr || err.message).trim().split('\n').slice(-3).join(' ')}`))
        else ok(stdout.trim())
      })
    })
  }

  const send = (res, status, data, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data))
  }
  const sendFile = async (res, file, type) => send(res, 200, await readFile(file), type)

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1) // 去掉 'api'
    const [a, b, c, d, e] = parts
    const m = req.method

    if (m === 'GET' && a === 'segments') return sendFile(res, P.severity, 'application/geo+json')
    if (m === 'GET' && a === 'features') return sendFile(res, P.features, 'application/geo+json')
    if (m === 'GET' && a === 'module' && (b === '2' || b === '3')) return send(res, 200, await moduleFiles(b))
    if (m === 'GET' && a === 'integrated') {
      if (!existsSync(P.integrated)) return send(res, 200, null)
      return sendFile(res, P.integrated, 'application/geo+json')
    }
    if (m === 'POST' && a === 'admin' && b === 'check') { requireAdmin(req, url); return send(res, 200, { ok: true }) }

    if (a === 'feedback') {
      if (m === 'POST' && !b) {
        const rec = await validateFeedback(await body(req))
        await serial(async () => { const list = await loadFeedback(); list.push(rec); await saveFeedback(list) })
        return send(res, 201, { id: rec.id })
      }
      requireAdmin(req, url)
      if (m === 'GET' && !b) return send(res, 200, (await loadFeedback()).map(publicView))
      if (m === 'GET' && c === 'photo') {
        const f = (await loadFeedback()).find((x) => x.id === b)
        const uri = f?.anomalies[Number(d)]?.photos?.[Number(e)]
        if (!uri) throw new HttpError(404, '找不到照片')
        res.setHeader('cache-control', 'private, max-age=86400')
        res.writeHead(200, { 'content-type': 'image/jpeg' })
        return res.end(Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'))
      }
      if (m === 'PATCH' && b && !c) {
        const patch = await body(req)
        if (!STATUSES.includes(patch.status)) throw new HttpError(400, 'status 需為 new、confirmed 或 rejected')
        if (patch.reviewNote != null && (typeof patch.reviewNote !== 'string' || patch.reviewNote.length > 500)) {
          throw new HttpError(400, '審核備註最多 500 字')
        }
        const updated = await serial(async () => {
          const list = await loadFeedback()
          const f = list.find((x) => x.id === b)
          if (!f) throw new HttpError(404, '找不到這筆回饋')
          f.status = patch.status
          f.reviewNote = patch.reviewNote?.trim() || undefined
          f.reviewedAt = new Date().toISOString()
          await saveFeedback(list)
          return f
        })
        return send(res, 200, publicView(updated))
      }
    }
    if (a === 'integrate' && m === 'POST') {
      requireAdmin(req, url)
      return send(res, 200, { log: await serial(runIntegrate) })
    }
    if (a === 'priorities.csv' && m === 'GET') {
      requireAdmin(req, url)
      if (!existsSync(P.priorities)) throw new HttpError(404, '尚未計算，請先按「重新計算」')
      res.setHeader('content-disposition', `attachment; filename="${site}_priorities.csv"`)
      return sendFile(res, P.priorities, 'text/csv; charset=utf-8')
    }
    throw new HttpError(404, '找不到這個 API')
  }

  async function staticFile(res, url) {
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    let file = join(dist, rel)
    if (!file.startsWith(dist) || !existsSync(file) || (await stat(file)).isDirectory()) file = join(dist, 'index.html')
    if (!existsSync(file)) return send(res, 404, '尚未 build：請執行 npm start（或開發時用 npm run dev）', 'text/plain; charset=utf-8')
    return sendFile(res, file, MIME[extname(file)] ?? 'application/octet-stream')
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local')
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url)
      else await staticFile(res, url)
    } catch (err) {
      const status = err.status ?? 500
      if (status === 500) console.error(err)
      if (!res.headersSent) send(res, status, { error: err.message })
      else res.end()
    }
  })
}

// ---- 直接執行：node server.mjs ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = { ...readEnvFile(join(HERE, '.env.local')), ...process.env }
  let pin = env.ADMIN_PIN
  if (!pin) {
    pin = String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, '0')
    console.warn(`⚠ app/.env.local 沒有設定 ADMIN_PIN，本次後台 PIN：${pin}`)
  }
  const port = Number(env.PORT ?? 8787)
  createApp({ pin, site: env.VITE_SITE_ID ?? 'taoyuan_hospital' }).listen(port, '0.0.0.0', () => {
    const ips = Object.values(networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal).map((i) => i.address)
    console.log(`後台伺服器已啟動（Ctrl+C 停止）\n  本機：http://localhost:${port}/admin`)
    for (const ip of ips) console.log(`  手機（同一個 Wi-Fi）：http://${ip}:${port}/feedback`)
  })
}
