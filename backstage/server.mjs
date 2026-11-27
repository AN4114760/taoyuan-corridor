// 地端後台伺服器：只用 Node 內建模組，資料存成 repo 內的 JSON／CSV 檔。
//   npm start          → 先 build，再在 http://<本機 IP>:8787 提供網頁與 API
//   npm run server     → 只開 API（開發時搭配 npm run dev，vite 會把 /api 轉過來）
// 資料：
//   data/outputs/<site>_severity.geojson、_features.geojson   模組一（唯讀）
//   data/module2/*.csv、data/module3/*.csv                      隊友交件（唯讀，前端依 data-contract 驗證）
//   backstage/data/feedback.json                                志工回饋（含 base64 照片，不進 git）
//   backstage/data/users.json                                   App 帳號（手機號碼＋密碼雜湊、身分 role）
//   backstage/data/videos.json                                  錄影上傳紀錄（影片檔本身在 Firebase Storage）
//   data/outputs/<site>_integrated.geojson、_priorities.csv     module4/integrate.py 輸出
import { execFile } from 'node:child_process'
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { networkInterfaces } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const CATEGORIES = ['tree-obstruction', 'parked-vehicle', 'broken-surface', 'no-ramp', 'tactile-broken',
  'too-narrow', 'no-sidewalk', 'pickup-problem', 'other']
export const GROUPS = ['wheelchair', 'elderly', 'visually-impaired', 'general']
const STATUSES = ['new', 'confirmed', 'rejected']
/** 帳號身分：0 待開通、1 志工回饋、2 錄影、3 志工＋錄影（只有後台能改） */
export const ROLES = [0, 1, 2, 3]
const canVolunteer = (role) => role === 1 || role === 3
const canRecord = (role) => role === 2 || role === 3
/** 開始走一段路時，與路段的距離上限（公尺） */
export const WALK_START_RADIUS_M = 50
const PROCESSING = ['pending', 'processing', 'processed', 'unusable']
const TOKEN_DAYS = 30
const BACKUPS_KEPT = 30
const scryptAsync = promisify(scrypt)
const MAX_BODY = 8 * 1024 * 1024
const MAX_PHOTO_CHARS = 900_000 // 約 650KB JPEG；前端壓縮後通常 150–250KB

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json' }

function readEnvFile(file) {
  if (!existsSync(file)) return {}
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n')
    .map((l) => l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]))
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

/** 建立伺服器（測試時可指定 root、pin、secret） */
//   dataDir：可寫入的資料夾（雲端部署時指到掛載的 Cloud Storage），outDir：模組四輸出
export function createApp({ root = resolve(HERE, '..'), site = 'taoyuan_hospital', pin, python, dist = join(HERE, 'dist'), tls, secret,
  dataDir = join(root, 'backstage/data'), outDir = join(root, 'data/outputs') } = {}) {
  const P = {
    severity: join(root, 'data/outputs', `${site}_severity.geojson`),
    features: join(root, 'data/outputs', `${site}_features.geojson`),
    integrated: join(outDir, `${site}_integrated.geojson`),
    priorities: join(outDir, `${site}_priorities.csv`),
    outDir,
    backend: dataDir,
    feedback: join(dataDir, 'feedback.json'),
    users: join(dataDir, 'users.json'),
    videos: join(dataDir, 'videos.json'),
    secret: join(dataDir, '.session-secret'),
    photos: join(dataDir, 'photos'),
    module: (n) => join(root, `data/module${n}`),
  }
  // Windows 的 venv 在 Scripts/python.exe，且通常沒有 python3 指令
  python ??= [join(root, '.venv/bin/python'), join(root, '.venv/Scripts/python.exe')].find(existsSync)
    ?? (process.platform === 'win32' ? 'python' : 'python3')

  let segIds = null
  async function segmentIds() {
    if (!segIds) {
      const fc = JSON.parse(await readFile(P.severity, 'utf8'))
      segIds = new Set(fc.features.map((f) => f.properties.seg_id))
    }
    return segIds
  }

  // ---- JSON 資料檔（回饋、帳號、影片）：讀寫序列化，寫入前備份，先寫暫存檔再 rename ----
  let queue = Promise.resolve()
  const serial = (fn) => (queue = queue.then(fn, fn))
  // 只有這個程式會寫入資料檔，所以讀過一次就留在記憶體（雲端掛載的資料夾每次讀檔都很慢）。
  // 回傳複本，呼叫端改到一半失敗時不會弄髒快取
  const cache = new Map()
  async function loadList(file) {
    if (!cache.has(file)) {
      try { cache.set(file, JSON.parse(await readFile(file, 'utf8'))) } catch (e) { if (e.code === 'ENOENT') cache.set(file, []); else throw e }
    }
    return structuredClone(cache.get(file))
  }
  async function saveList(file, list) {
    const bak = join(P.backend, '.bak')
    await mkdir(bak, { recursive: true })
    const name = file.split(/[/\\]/).pop().replace(/\.json$/, '')
    if (existsSync(file)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
      await copyFile(file, join(bak, `${name}-${stamp}.json`))
      // 每個檔案只留最近 BACKUPS_KEPT 份備份
      const old = (await readdir(bak)).filter((f) => f.startsWith(`${name}-`)).sort().slice(0, -BACKUPS_KEPT)
      await Promise.all(old.map((f) => unlink(join(bak, f)).catch(() => {})))
    }
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(list, null, 1))
    await rename(tmp, file)
    cache.set(file, structuredClone(list))
  }
  /** 照片另存成檔案，回饋裡只記相對路徑（舊資料的 data URL 照樣能讀） */
  async function savePhotos(rec) {
    for (const [i, a] of rec.anomalies.entries()) {
      for (const [k, uri] of a.photos.entries()) {
        const rel = `photos/${rec.id}/${i}-${k}.jpg`
        await mkdir(join(P.photos, rec.id), { recursive: true })
        await writeFile(join(P.backend, rel), Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'))
        a.photos[k] = rel
      }
    }
  }
  const loadFeedback = () => loadList(P.feedback)
  const saveFeedback = (list) => saveList(P.feedback, list)
  const publicView = (f) => ({
    ...f, anomalies: f.anomalies.map(({ photos, ...a }) => ({ ...a, photoCount: photos?.length ?? 0 })),
  })

  // ---- 帳號：手機號碼＋密碼（scrypt 雜湊），登入後發 HMAC 簽章 token（30 天） ----
  if (!secret) {
    if (existsSync(P.secret)) secret = readFileSync(P.secret, 'utf8').trim()
    else {
      secret = randomBytes(32).toString('hex')
      mkdir(P.backend, { recursive: true }).then(() => writeFile(P.secret, secret))
    }
  }
  const publicUser = ({ passwordHash, ...u }) => u
  async function hashPassword(pw) {
    const salt = randomBytes(16)
    return `scrypt:${salt.toString('hex')}:${(await scryptAsync(pw, salt, 64)).toString('hex')}`
  }
  async function checkPassword(pw, stored) {
    const [, salt, hash] = String(stored).split(':')
    if (!salt || !hash) return false
    const a = await scryptAsync(pw, Buffer.from(salt, 'hex'), 64), b = Buffer.from(hash, 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  }
  const mac = (s) => createHmac('sha256', secret).update(s).digest('base64url')
  function signToken(userId) {
    const body = Buffer.from(`${userId}.${Date.now() + TOKEN_DAYS * 864e5}`).toString('base64url')
    return `${body}.${mac(body)}`
  }
  function verifyToken(token) {
    const [body, sig] = String(token).split('.')
    if (!body || !sig) return null
    const want = mac(body)
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null
    const [id, exp] = Buffer.from(body, 'base64url').toString().split('.')
    return Number(exp) > Date.now() ? id : null
  }
  /** 目前登入的使用者；照片等瀏覽器直接載入的連結用 ?token= */
  async function currentUser(req, url) {
    const auth = String(req.headers.authorization ?? '')
    const id = verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token') ?? '')
    return id ? (await loadList(P.users)).find((u) => u.id === id) ?? null : null
  }
  async function requireUser(req, url) {
    const u = await currentUser(req, url)
    if (!u) throw new HttpError(401, '請先登入')
    return u
  }
  const normPhone = (p) => String(p ?? '').replace(/[\s-]/g, '')
  function validateAccount(b, { partial = false } = {}) {
    const errs = []
    if (!partial || b.name !== undefined) {
      if (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 40) errs.push('稱呼需為 1–40 字')
    }
    if (!partial || b.participantGroup !== undefined) {
      if (!GROUPS.includes(b.participantGroup)) errs.push('身分類別不在允許清單')
    }
    if (errs.length) throw new HttpError(400, errs.join('；'))
  }
  const validPassword = (pw) => typeof pw === 'string' && pw.length >= 6 && pw.length <= 64

  async function validateFeedback(b, user) {
    const errs = []
    const int15 = (v) => Number.isInteger(v) && v >= 1 && v <= 5
    if (!GROUPS.includes(b.participantGroup)) errs.push('participantGroup 不在允許清單')
    // 開始走之前的定位檢查（App 端檢查後送來，伺服器再確認一次）
    const w = b.walk
    if (!w || typeof w.startedAt !== 'string' || !Number.isFinite(w.startLat) || !Number.isFinite(w.startLng) || !Number.isFinite(w.startDistanceM)) {
      errs.push('缺少開始走訪的定位紀錄')
    } else if (w.startDistanceM > WALK_START_RADIUS_M) {
      errs.push(`開始位置距離路段 ${Math.round(w.startDistanceM)}m，需在 ${WALK_START_RADIUS_M}m 內`)
    }
    if (!int15(b.safety)) errs.push('safety 需為 1–5 整數')
    if (!int15(b.comfort)) errs.push('comfort 需為 1–5 整數')
    if (!(await segmentIds()).has(b.segId)) errs.push('segId 不存在')
    if (!(Number.isFinite(b.lat) && Number.isFinite(b.lng))) errs.push('缺 lat/lng')
    if (b.comment != null && (typeof b.comment !== 'string' || b.comment.length > 1000)) errs.push('comment 最多 1000 字')
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
      id: randomUUID(), createdAt: new Date().toISOString(), userId: user.id, volunteerName: user.name,
      participantGroup: b.participantGroup, segId: b.segId, lat: b.lat, lng: b.lng, safety: b.safety, comfort: b.comfort,
      comment: b.comment?.trim() || undefined,
      anomalies: anomalies.map((a) => ({ category: a.category, note: a.note?.trim() || undefined, photos: a.photos ?? [] })),
      walk: {
        startedAt: w.startedAt, startLat: w.startLat, startLng: w.startLng,
        startDistanceM: Math.round(w.startDistanceM * 10) / 10,
        startAccuracyM: Number.isFinite(w.startAccuracyM) ? Math.round(w.startAccuracyM) : undefined,
      },
      status: 'new',
    }
  }

  function validateVideo(b, user) {
    const errs = []
    const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max
    if (!str(b.fileName, 200)) errs.push('fileName 需為 1–200 字')
    if (!Number.isInteger(b.sizeBytes) || b.sizeBytes <= 0) errs.push('sizeBytes 需為正整數')
    if (!str(b.contentType, 100) || !b.contentType.startsWith('video/')) errs.push('contentType 需為 video/*')
    if (!str(b.recordedAt, 40)) errs.push('缺 recordedAt')
    if (!str(b.storagePath, 500) || !b.storagePath.startsWith('videos/')) errs.push('storagePath 需在 videos/ 底下')
    if (!str(b.downloadUrl, 2000) || !b.downloadUrl.startsWith('https://')) errs.push('downloadUrl 需為 https 網址')
    if (b.note != null && (typeof b.note !== 'string' || b.note.length > 500)) errs.push('備註最多 500 字')
    if (errs.length) throw new HttpError(400, errs.join('；'))
    return {
      id: randomUUID(), userId: user.id, recorderName: user.name, fileName: b.fileName, sizeBytes: b.sizeBytes,
      contentType: b.contentType, note: b.note?.trim() || undefined, recordedAt: b.recordedAt,
      uploadedAt: new Date().toISOString(), storagePath: b.storagePath, downloadUrl: b.downloadUrl, processing: 'pending',
    }
  }

  /** 照片轉 JPEG 回應：新資料是 photos/ 底下的檔案，舊資料（含 seed_demo）是 data URL */
  async function sendPhoto(res, f, a, p) {
    const ref = f?.anomalies[Number(a)]?.photos?.[Number(p)]
    if (!ref) throw new HttpError(404, '找不到照片')
    const jpeg = ref.startsWith('data:') ? Buffer.from(ref.slice(ref.indexOf(',') + 1), 'base64')
      : await readFile(join(P.backend, ref)).catch(() => { throw new HttpError(404, '找不到照片') })
    res.setHeader('cache-control', 'private, max-age=86400')
    res.writeHead(200, { 'content-type': 'image/jpeg' })
    return res.end(jpeg)
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
      const args = [join(root, 'module4/integrate.py'), '--id', site, '--feedback', P.feedback, '--out-dir', P.outDir]
      execFile(python, args, { cwd: root, timeout: 120_000 }, (err, stdout, stderr) => {
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
    const [a, b, c, d, e, f6] = parts
    const m = req.method

    if (m === 'GET' && a === 'segments') return sendFile(res, P.severity, 'application/geo+json')
    if (m === 'GET' && a === 'features') return sendFile(res, P.features, 'application/geo+json')
    if (m === 'GET' && a === 'module' && (b === '2' || b === '3')) return send(res, 200, await moduleFiles(b))
    if (m === 'GET' && a === 'integrated') {
      if (!existsSync(P.integrated)) return send(res, 200, null)
      return sendFile(res, P.integrated, 'application/geo+json')
    }
    if (m === 'POST' && a === 'admin' && b === 'check') { requireAdmin(req, url); return send(res, 200, { ok: true }) }

    // ---- 帳號 ----
    if (a === 'auth' && m === 'POST' && (b === 'register' || b === 'login')) {
      const input = await body(req)
      const phone = normPhone(input.phone)
      if (!/^09\d{8}$/.test(phone)) throw new HttpError(400, '手機號碼格式為 09 開頭共 10 碼')
      if (!validPassword(input.password)) throw new HttpError(400, '密碼需為 6–64 字')
      if (b === 'login') {
        const u = (await loadList(P.users)).find((x) => x.phone === phone)
        if (!u || !(await checkPassword(input.password, u.passwordHash))) throw new HttpError(401, '手機號碼或密碼錯誤')
        return send(res, 200, { token: signToken(u.id), user: publicUser(u) })
      }
      validateAccount(input)
      const passwordHash = await hashPassword(input.password)
      const user = await serial(async () => {
        const list = await loadList(P.users)
        if (list.some((x) => x.phone === phone)) throw new HttpError(409, '這個手機號碼已經註冊過，請直接登入')
        const now = new Date().toISOString()
        const u = { id: randomUUID(), phone, name: input.name.trim(), participantGroup: input.participantGroup, role: 0, passwordHash, createdAt: now, updatedAt: now }
        list.push(u)
        await saveList(P.users, list)
        return u
      })
      return send(res, 201, { token: signToken(user.id), user: publicUser(user) })
    }

    // ---- 登入者自己的資料：/api/me、/api/me/feedback、/api/me/videos ----
    if (a === 'me') {
      const user = await requireUser(req, url)
      if (!b && m === 'GET') return send(res, 200, publicUser(user))
      if (!b && m === 'PATCH') {
        const patch = await body(req)
        validateAccount(patch, { partial: true })
        const updated = await serial(async () => {
          const list = await loadList(P.users)
          const u = list.find((x) => x.id === user.id)
          if (patch.name !== undefined) u.name = patch.name.trim()
          if (patch.participantGroup !== undefined) u.participantGroup = patch.participantGroup
          u.updatedAt = new Date().toISOString()
          await saveList(P.users, list)
          return u
        })
        return send(res, 200, publicUser(updated))
      }
      if (b === 'feedback' && m === 'GET') {
        const mine = (await loadFeedback()).filter((x) => x.userId === user.id)
        if (!c) return send(res, 200, mine.map(publicView).reverse())
        if (d === 'photo') return sendPhoto(res, mine.find((x) => x.id === c), e, f6)
      }
      if (b === 'videos' && !c) {
        if (m === 'GET') return send(res, 200, (await loadList(P.videos)).filter((x) => x.userId === user.id).reverse())
        if (m === 'POST') {
          if (!canRecord(user.role)) throw new HttpError(403, '這個帳號沒有錄影上傳的權限')
          const rec = validateVideo(await body(req), user)
          await serial(async () => { const list = await loadList(P.videos); list.push(rec); await saveList(P.videos, list) })
          return send(res, 201, rec)
        }
      }
    }

    // ---- 後台：帳號管理、影片 ----
    if (a === 'users') {
      requireAdmin(req, url)
      if (m === 'GET' && !b) {
        const [users, fb, vids] = await Promise.all([loadList(P.users), loadFeedback(), loadList(P.videos)])
        return send(res, 200, users.map((u) => ({
          ...publicUser(u),
          feedbackCount: fb.filter((x) => x.userId === u.id).length,
          videoCount: vids.filter((x) => x.userId === u.id).length,
        })))
      }
      if (m === 'PATCH' && b && !c) {
        const patch = await body(req)
        if (patch.role !== undefined && !ROLES.includes(patch.role)) throw new HttpError(400, 'role 需為 0、1、2、3')
        if (patch.password !== undefined && !validPassword(patch.password)) throw new HttpError(400, '密碼需為 6–64 字')
        const passwordHash = patch.password !== undefined ? await hashPassword(patch.password) : undefined
        const updated = await serial(async () => {
          const list = await loadList(P.users)
          const u = list.find((x) => x.id === b)
          if (!u) throw new HttpError(404, '找不到這個帳號')
          if (patch.role !== undefined) u.role = patch.role
          if (passwordHash) u.passwordHash = passwordHash
          u.updatedAt = new Date().toISOString()
          await saveList(P.users, list)
          return u
        })
        return send(res, 200, publicUser(updated))
      }
    }
    if (a === 'videos') {
      requireAdmin(req, url)
      if (m === 'GET' && !b) return send(res, 200, (await loadList(P.videos)).reverse())
      if (m === 'PATCH' && b && !c) {
        const patch = await body(req)
        if (!PROCESSING.includes(patch.processing)) throw new HttpError(400, 'processing 不在允許清單')
        if (patch.adminNote != null && (typeof patch.adminNote !== 'string' || patch.adminNote.length > 500)) throw new HttpError(400, '備註最多 500 字')
        const updated = await serial(async () => {
          const list = await loadList(P.videos)
          const v = list.find((x) => x.id === b)
          if (!v) throw new HttpError(404, '找不到這支影片')
          v.processing = patch.processing
          v.adminNote = patch.adminNote?.trim() || undefined
          await saveList(P.videos, list)
          return v
        })
        return send(res, 200, updated)
      }
    }

    if (a === 'feedback') {
      if (m === 'POST' && !b) {
        const user = await requireUser(req, url)
        if (!canVolunteer(user.role)) throw new HttpError(403, '這個帳號沒有志工回饋的權限')
        const rec = await validateFeedback(await body(req), user)
        await savePhotos(rec)
        await serial(async () => { const list = await loadFeedback(); list.push(rec); await saveFeedback(list) })
        return send(res, 201, { id: rec.id })
      }
      requireAdmin(req, url)
      if (m === 'GET' && !b) return send(res, 200, (await loadFeedback()).map(publicView))
      if (m === 'GET' && c === 'photo') return sendPhoto(res, (await loadFeedback()).find((x) => x.id === b), d, e)
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

  const handler = async (req, res) => {
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
  }
  // 有憑證就用 https（手機瀏覽器只在 https 下允許定位）
  return tls ? createHttpsServer(tls, handler) : createServer(handler)
}

// ---- 直接執行：node server.mjs ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = { ...readEnvFile(join(HERE, '.env.local')), ...process.env }
  let pin = env.ADMIN_PIN
  if (!pin) {
    pin = String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, '0')
    console.warn(`⚠ backstage/.env.local 沒有設定 ADMIN_PIN（格式：ADMIN_PIN=數字），本次後台 PIN：${pin}`)
  }
  const port = Number(env.PORT ?? 8787)
  const httpsPort = Number(env.HTTPS_PORT ?? 8443)
  const site = env.VITE_SITE_ID ?? 'taoyuan_hospital'
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal).map((i) => i.address)

  // 自簽憑證（npm run cert 產生）：有的話另外開 https，手機才能定位
  const certDir = join(HERE, '.cert')
  const tls = existsSync(join(certDir, 'key.pem')) && existsSync(join(certDir, 'cert.pem'))
    ? { key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) }
    : null

  // 雲端部署：DATA_DIR 指到掛載的 Cloud Storage，帳號、回饋、照片與計算結果都放這裡才不會在重新啟動時消失
  const dirs = env.DATA_DIR ? { dataDir: env.DATA_DIR, outDir: join(env.DATA_DIR, 'outputs') } : {}
  const app = createApp({ pin, site, ...dirs })
  app.listen(port, '0.0.0.0', () => {
    console.log(`後台伺服器已啟動（Ctrl+C 停止）\n  本機：http://localhost:${port}/admin`)
    if (!tls) {
      for (const ip of ips) console.log(`  手機（同一個 Wi-Fi）：http://${ip}:${port}/`)
      console.log('  ⚠ 目前沒有 https，手機無法定位。執行 npm run cert 產生憑證後重新啟動')
    }
  })
  if (tls) {
    // 與 http 共用同一個 handler（同一份快取與寫入佇列）
    createHttpsServer(tls, app.listeners('request')[0]).listen(httpsPort, '0.0.0.0', () => {
      for (const ip of ips) console.log(`  手機（同一個 Wi-Fi，可定位）：https://${ip}:${httpsPort}/`)
      console.log('  第一次開啟手機會警告「連線不安全」（自簽憑證），按「進階 → 繼續前往」即可')
    })
  }
}
