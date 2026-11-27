// 走路模式的畫面：Canvas 2D 透視投影，鏡頭在青蛙後方 1.9m、高 1.7m，往前看。
// 世界座標：s = 沿路段公尺、x = 距人行道中線公尺（右正）、y = 高度。插畫風格：粗深色描邊＋平塗。
import { HALF_WIDTH, type PinKind, type Scene, type SceneObj } from './config'

export interface FrogImages { back: HTMLImageElement; l: HTMLImageElement; r: HTMLImageElement }
/** SVG 素材：obstacle-*（場景裡的物件）、pin-*（團隊標注的紅色水滴） */
export interface SceneAssets {
  frog: FrogImages
  obstacle: Partial<Record<string, HTMLImageElement>>
  pin: Partial<Record<PinKind, HTMLImageElement>>
  /** 來車（vehicles.ts 換色後的汽車、機車） */
  traffic?: { car: HTMLImageElement[]; scooter: HTMLImageElement[] }
}

/** 素材寬度（240 單位）對應的實際公尺；坑洞是地面貼圖 */
const SPRITE_W: Record<string, number> = { scooter: 1.05, cone: 0.55, car: 2.2, pothole: 1.3, signboard: 0.85, trash: 1.25 }
export interface Pin { s: number; x: number; kind: 'anomaly' | 'feel' }
export interface FrameState {
  W: number
  H: number
  t: number            // 秒
  along: number        // 青蛙所在位置（公尺）
  frogX: number
  moving: boolean
  length: number
  pins: Pin[]
  near?: string        // 正在靠近的標注點（標記放大）
}
export interface Hit { id: string; x: number; y: number; r: number }

const FROG_BACK = 2.2
const CAM_H = 1.7
const INK = '#2b3a2e'

function hash(a: number, b: number) {
  let h = Math.imul(a * 73856093 ^ b * 19349663, 2654435761)
  h ^= h >>> 13
  return ((h >>> 0) % 1000) / 1000
}

export function drawScene(ctx: CanvasRenderingContext2D, sc: Scene, F: FrameState, assets: SceneAssets | null): Hit[] {
  const frog = assets?.frog ?? null
  const { W, H, t } = F
  const R = sc.roadSide
  const w2 = sc.width / 2
  const camS = F.along - FROG_BACK
  const camX = F.frogX * 0.45
  const f = Math.min(W * 1.05, H * 0.62)
  const hor = Math.round(H * 0.4)
  const Z_NEAR = 0.25, Z_FAR = 160

  const P = (x: number, s: number, y = 0) => {
    const z = Math.max(s - camS, Z_NEAR)
    return { X: W / 2 + (f * (x - camX)) / z, Y: hor + (f * (CAM_H - y)) / z, p: f / z, z }
  }
  const quad = (x0: number, x1: number, s0: number, s1: number, fill: string) => {
    s0 = Math.max(s0, camS + Z_NEAR); s1 = Math.min(s1, camS + Z_FAR)
    if (s1 <= s0) return
    const a = P(x0, s0), b = P(x1, s0), c = P(x1, s1), d = P(x0, s1)
    ctx.fillStyle = fill
    ctx.beginPath(); ctx.moveTo(a.X, a.Y); ctx.lineTo(b.X, b.Y); ctx.lineTo(c.X, c.Y); ctx.lineTo(d.X, d.Y); ctx.closePath(); ctx.fill()
  }
  const sNear = camS + Z_NEAR, sFar = camS + Z_FAR

  // ---- 天空、雲、遠景 ----
  const sky = ctx.createLinearGradient(0, 0, 0, hor)
  sky.addColorStop(0, '#7cc3ec'); sky.addColorStop(1, '#d6eefa')
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, hor + 2)
  ctx.fillStyle = 'rgba(255,255,255,.9)'
  for (const [cx, cy, r] of [[0.18, 0.12, 0.07], [0.27, 0.1, 0.05], [0.72, 0.2, 0.06], [0.8, 0.18, 0.045], [0.55, 0.07, 0.035]]) {
    ctx.beginPath(); ctx.ellipse(cx * W, cy * H * 0.9, r * W * 1.6, r * W * 0.6, 0, 0, Math.PI * 2); ctx.fill()
  }
  // 車道側遠方大樓、另一側醫院建築
  const skyline = (side: number, blocks: [number, number, number, string][]) => {
    for (const [cx, w, h, col] of blocks) {
      const x = W / 2 + side * cx * W - (camX * 4)
      ctx.fillStyle = col; ctx.strokeStyle = 'rgba(43,58,46,.35)'; ctx.lineWidth = 1
      ctx.fillRect(x - w * W / 2, hor - h * H, w * W, h * H + 1); ctx.strokeRect(x - w * W / 2, hor - h * H, w * W, h * H + 1)
      ctx.fillStyle = 'rgba(255,255,255,.45)'
      for (let yy = hor - h * H + 5; yy < hor - 4; yy += 7) ctx.fillRect(x - w * W / 2 + 3, yy, w * W - 6, 2)
    }
  }
  skyline(R, [[0.18, 0.06, 0.1, '#c9d3de'], [0.27, 0.05, 0.14, '#b9c6d3'], [0.36, 0.07, 0.08, '#d5dce4']])
  if (sc.leftKind === 'lawn') skyline(-R, [[0.3, 0.34, 0.11, '#e4e1d8'], [0.12, 0.08, 0.16, '#dcd8cc']])

  // ---- 地面 ----
  const curb0 = R * w2, curb1 = R * (w2 + 0.22), road1 = R * (w2 + 0.22 + 11)
  const other0 = -R * w2, other1 = -R * (w2 + 0.6)
  quad(-60, 60, sNear, sFar, '#8cc56a')                     // 全部先鋪草地
  quad(road1, R * 60, sNear, sFar, '#7fb85f')              // 車道外側綠帶
  quad(curb1, road1, sNear, sFar, '#5d6168')               // 車道
  quad(curb0, curb1, sNear, sFar, '#d9d5cc')               // 路緣
  quad(other0, other1, sNear, sFar, '#cfc8ba')             // 草坪邊的碎石帶
  quad(-w2, w2, sNear, sFar, '#bdb6ab')                    // 人行道
  // 路段起點、終點的路口：柏油橫越＋斑馬線
  for (const [a, b] of [[-14, -1], [F.length + 1, F.length + 14]]) {
    quad(-60, 60, a, b, '#5d6168')
    for (let k = 0; k < 7; k++) {
      const x0 = -w2 + 0.1 + k * (sc.width / 7)
      quad(x0, x0 + sc.width / 14, a + 2, b - 2, 'rgba(255,255,255,.85)')
    }
  }
  // 人行道磚：近處逐塊上色
  const TILE = 0.5
  const cols = Math.round(sc.width / TILE)
  for (let i = Math.floor(sNear / TILE); i * TILE < camS + 28; i++) {
    const s = i * TILE
    if (s < 0 - 1 || s > F.length + 1) continue
    for (let j = 0; j < cols; j++) {
      const v = hash(i, j)
      if (v < 0.78) continue
      const x = -w2 + j * TILE
      quad(x, x + TILE, s, s + TILE, v > 0.93 ? '#d8c58f' : v > 0.86 ? '#d4a9a2' : '#a9a298')
    }
  }
  ctx.strokeStyle = 'rgba(70,60,50,.28)'; ctx.lineWidth = 1
  for (let i = Math.floor(sNear / TILE); i * TILE < camS + 40; i++) {
    const s = i * TILE
    if (s - camS < Z_NEAR || s < -1 || s > F.length + 1) continue
    const a = P(-w2, s), b = P(w2, s)
    ctx.globalAlpha = Math.max(0, 1 - (s - camS) / 40)
    ctx.beginPath(); ctx.moveTo(a.X, a.Y); ctx.lineTo(b.X, b.Y); ctx.stroke()
  }
  ctx.globalAlpha = 1
  for (let j = 0; j <= cols; j++) {
    const x = -w2 + j * TILE
    const a = P(x, Math.max(sNear, -1)), b = P(x, Math.min(camS + 40, F.length + 1))
    if (b.z <= Z_NEAR) continue
    ctx.beginPath(); ctx.moveTo(a.X, a.Y); ctx.lineTo(b.X, b.Y); ctx.stroke()
  }
  // 紅線、車道虛線（虛線隨走動移動）
  quad(R * (w2 + 0.55), R * (w2 + 0.67), sNear, sFar, '#d9473f')
  for (const lane of [3.6, 7.2]) {
    const x = R * (w2 + 0.22 + lane)
    for (let s = Math.floor(sNear / 9) * 9; s < camS + 90; s += 9) quad(x - 0.07, x + 0.07, s, s + 3, 'rgba(255,255,255,.9)')
  }
  // 地平線霧氣
  const haze = ctx.createLinearGradient(0, hor - 2, 0, hor + H * 0.06)
  haze.addColorStop(0, 'rgba(214,238,250,.95)'); haze.addColorStop(1, 'rgba(214,238,250,0)')
  ctx.fillStyle = haze; ctx.fillRect(0, hor - 2, W, H * 0.06 + 2)

  // ---- 物件、車流、青蛙：由遠到近 ----
  type D = { z: number; draw: () => void }
  const list: D[] = []
  const objTop: Record<string, { X: number; Y: number; p: number; z: number }> = {}
  for (const o of sc.objects) {
    const z = o.s - camS
    if (z < 0.4 || z > 95) continue
    list.push({ z, draw: () => drawObj(o) })
    if (o.hotspot) objTop[o.hotspot] = P(o.x, o.s, o.kind === 'box' ? 1.75 : o.kind === 'pothole' ? 0.3 : 1.45)
  }
  // 車道另一側的行道樹（遠景）
  for (let s = Math.floor(sNear / 7) * 7; s < camS + 95; s += 7) {
    const o: SceneObj = { kind: 'tree', s, x: R * (w2 + 12.5), h: 6 + hash(s, 3) * 2, seed: s }
    if (s - camS > 0.4) list.push({ z: s - camS, draw: () => drawObj(o) })
  }
  // 對向來車（往鏡頭方向）
  const traffic: { lane: number; speed: number; off: number; kind: 'car' | 'scooter'; v: number }[] = [
    { lane: 1.5, speed: 7, off: 0, kind: 'scooter', v: 0 },
    { lane: 2.0, speed: 6, off: 47, kind: 'scooter', v: 2 },
    { lane: 1.7, speed: 8, off: 82, kind: 'scooter', v: 1 },
    { lane: 5.3, speed: 11, off: 20, kind: 'car', v: 0 },
    { lane: 5.4, speed: 10, off: 76, kind: 'car', v: 3 },
    { lane: 8.9, speed: 13, off: 64, kind: 'car', v: 2 },
    { lane: 8.7, speed: 12, off: 5, kind: 'car', v: 1 },
  ]
  for (const v of traffic) {
    const s = camS + 4 + ((((v.off - t * v.speed) % 110) + 110) % 110)
    list.push({ z: s - camS, draw: () => drawVehicle(R * (w2 + 0.22 + v.lane), s, v.kind, v.v) })
  }
  for (const pin of F.pins) {
    const z = pin.s - camS
    if (z > 0.4 && z < 80) list.push({ z: z - 0.01, draw: () => drawPin(pin) })
  }
  list.push({ z: FROG_BACK, draw: drawFrog })
  list.sort((a, b) => b.z - a.z)
  for (const d of list) {
    ctx.globalAlpha = d.z > 55 ? Math.max(0.15, 1 - (d.z - 55) / 45) : 1
    d.draw()
  }
  ctx.globalAlpha = 1

  // ---- 團隊標注點：紅色水滴地標（內含障礙物圖，可點） ----
  const hits: Hit[] = []
  // 遠的先畫、近的蓋在上面；35m 以外先不顯示，避免水滴疊在一起
  const visible = sc.hotspots.map((h) => ({ h, a: objTop[h.id] })).filter(({ a }) => a && a.z > 0.6 && a.z < 35).sort((x, y) => y.a.z - x.a.z)
  for (const { h, a } of visible) {
    const near = F.near === h.id
    const ph = Math.max(48, Math.min(near ? 112 : 88, a.p * 1.6)) * (near ? 1 + 0.06 * Math.sin(t * 6) : 1)
    const pw = (ph * 280) / 340
    const bob = Math.sin(t * 3 + h.s) * ph * 0.04
    const top = a.Y - ph - 4 + bob
    const img = assets?.pin[h.icon]
    if (near) {
      ctx.fillStyle = 'rgba(220,38,38,.22)'
      ctx.beginPath(); ctx.arc(a.X, top + ph * 0.38, ph * (0.5 + 0.08 * Math.sin(t * 6)), 0, Math.PI * 2); ctx.fill()
    }
    if (img?.complete && img.naturalWidth) ctx.drawImage(img, a.X - pw / 2, top, pw, ph)
    else { ctx.fillStyle = '#DC2626'; ctx.beginPath(); ctx.arc(a.X, top + ph * 0.38, ph * 0.3, 0, Math.PI * 2); ctx.fill() }
    hits.push({ id: h.id, x: a.X, y: top + ph * 0.38, r: ph * 0.45 + 10 })
  }
  return hits

  // ======== 物件 ========
  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r)
  }
  function shadow(X: number, Y: number, p: number, w: number) {
    ctx.fillStyle = 'rgba(30,40,30,.18)'
    ctx.beginPath(); ctx.ellipse(X, Y, w * p, w * p * 0.22, 0, 0, Math.PI * 2); ctx.fill()
  }
  function line(p: number) { return Math.max(1, Math.min(3.2, p * 0.035)) }

  function drawObj(o: SceneObj) {
    const b = P(o.x, o.s)
    const { X, Y, p } = b
    ctx.lineJoin = 'round'
    ctx.strokeStyle = INK
    ctx.lineWidth = line(p)
    const sprite = assets?.obstacle[o.kind]
    if (sprite?.complete && sprite.naturalWidth && SPRITE_W[o.kind]) {
      const w = p * SPRITE_W[o.kind], h = (w * 280) / 240
      const flip = o.kind !== 'pothole' && hash(o.seed, 7) < 0.5
      if (o.kind === 'pothole') {
        // 地面貼圖：壓扁、以坑洞中心貼在地上
        const hh = h * 0.55
        ctx.drawImage(sprite, X - w / 2, Y - hh * (190 / 280), w, hh)
      } else if (flip) {
        ctx.save(); ctx.translate(X, 0); ctx.scale(-1, 1)
        ctx.drawImage(sprite, -w / 2, Y - (h * 262) / 280, w, h); ctx.restore()
      } else ctx.drawImage(sprite, X - w / 2, Y - (h * 262) / 280, w, h)
      return
    }
    switch (o.kind) {
      case 'tree': {
        const h = o.h ?? 6
        if (Math.abs(o.x) < w2 + 0.1) quad(o.x - 0.5, o.x + 0.5, o.s - 0.5, o.s + 0.5, '#7b6a55') // 樹穴
        shadow(X, Y, p, 1.4)
        const lean = (hash(o.seed, 1) - 0.5) * 0.6
        ctx.fillStyle = '#7a5a3c'
        ctx.beginPath()
        ctx.moveTo(X - p * 0.16, Y); ctx.lineTo(X + p * 0.16, Y)
        ctx.lineTo(X + p * (0.08 + lean), Y - p * h * 0.62); ctx.lineTo(X + p * (-0.08 + lean), Y - p * h * 0.62)
        ctx.closePath(); ctx.fill(); ctx.stroke()
        const cx = X + p * lean, cy = Y - p * h * 0.72, rr = p * h * 0.22
        const blobs: [number, number, number][] = []
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + hash(o.seed, k) * 0.6
          blobs.push([cx + Math.cos(a) * rr * 0.75, cy + Math.sin(a) * rr * 0.55, rr * (0.45 + hash(o.seed, k + 9) * 0.25)])
        }
        blobs.push([cx, cy, rr * 0.7])
        ctx.lineWidth = line(p) * 2
        for (const [bx, by, br] of blobs) { ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.stroke() }
        for (const [bx, by, br] of blobs) { ctx.fillStyle = '#4f9a3a'; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill() }
        ctx.fillStyle = '#6dbb4b'
        for (const [bx, by, br] of blobs.slice(0, 5)) { ctx.beginPath(); ctx.arc(bx - br * 0.2, by - br * 0.25, br * 0.55, 0, Math.PI * 2); ctx.fill() }
        break
      }
      case 'lamp': {
        ctx.fillStyle = '#3a3f44'
        ctx.fillRect(X - Math.max(1, p * 0.05), Y - p * 4.2, Math.max(2, p * 0.1), p * 4.2)
        ctx.fillStyle = '#fff7d1'
        roundRect(X - p * 0.2, Y - p * 4.55, p * 0.4, p * 0.4, p * 0.08); ctx.fill(); ctx.stroke()
        break
      }
      case 'pole': {
        ctx.fillStyle = '#9a9b95'
        ctx.beginPath(); ctx.moveTo(X - p * 0.15, Y); ctx.lineTo(X + p * 0.15, Y); ctx.lineTo(X + p * 0.1, Y - p * 9); ctx.lineTo(X - p * 0.1, Y - p * 9); ctx.closePath()
        ctx.fill(); ctx.stroke()
        ctx.fillRect(X - p * 0.7, Y - p * 8.3, p * 1.4, p * 0.12)
        ctx.strokeStyle = 'rgba(30,30,30,.55)'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(X - p * 0.6, Y - p * 8.25); ctx.quadraticCurveTo(X - W * 0.4, Y - p * 6, X - W, Y - p * 8); ctx.stroke()
        break
      }
      case 'box': {
        const hw = 0.55, d = 0.75, h = 1.35, base = 0.25
        const fl = P(o.x - hw, o.s - d / 2), fr = P(o.x + hw, o.s - d / 2)
        const ftl = P(o.x - hw, o.s - d / 2, h + base), ftr = P(o.x + hw, o.s - d / 2, h + base)
        const btl = P(o.x - hw, o.s + d / 2, h + base), btr = P(o.x + hw, o.s + d / 2, h + base)
        const bl = P(o.x - hw, o.s + d / 2), br = P(o.x + hw, o.s + d / 2)
        shadow(X, Y, p, 0.9)
        const poly = (pts: { X: number; Y: number }[], fill: string) => {
          ctx.fillStyle = fill; ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.X, q.Y) : ctx.moveTo(q.X, q.Y))); ctx.closePath(); ctx.fill(); ctx.stroke()
        }
        if (o.x - hw > camX) poly([fl, ftl, btl, bl], '#7f888f')
        else if (o.x + hw < camX) poly([fr, ftr, btr, br], '#7f888f')
        poly([ftl, ftr, btr, btl], '#c3cad0')
        poly([fl, fr, ftr, ftl], '#9aa3ab')
        // 底座黑黃斜紋
        const pl = P(o.x - hw, o.s - d / 2, base)
        ctx.save(); ctx.beginPath(); ctx.rect(fl.X, pl.Y, fr.X - fl.X, fl.Y - pl.Y); ctx.clip()
        ctx.fillStyle = '#f2c230'; ctx.fillRect(fl.X, pl.Y, fr.X - fl.X, fl.Y - pl.Y)
        ctx.fillStyle = '#222'
        const step = (fr.X - fl.X) / 7
        for (let k = -2; k < 9; k++) {
          ctx.beginPath(); ctx.moveTo(fl.X + k * step, fl.Y); ctx.lineTo(fl.X + k * step + step / 2, fl.Y)
          ctx.lineTo(fl.X + k * step + step / 2 + (fl.Y - pl.Y), pl.Y); ctx.lineTo(fl.X + k * step + (fl.Y - pl.Y), pl.Y); ctx.closePath(); ctx.fill()
        }
        ctx.restore()
        ctx.strokeRect(fl.X, pl.Y, fr.X - fl.X, fl.Y - pl.Y)
        // 門縫、通風口
        ctx.lineWidth = line(p) * 0.7
        const fw = fr.X - fl.X, top = ftl.Y, bot = pl.Y
        ctx.beginPath(); ctx.moveTo(fl.X + fw * 0.5, top + 4); ctx.lineTo(fl.X + fw * 0.5, bot - 3); ctx.stroke()
        for (let k = 0; k < 3; k++) {
          ctx.beginPath(); ctx.moveTo(fl.X + fw * 0.12, top + (bot - top) * (0.18 + k * 0.06)); ctx.lineTo(fl.X + fw * 0.3, top + (bot - top) * (0.18 + k * 0.06)); ctx.stroke()
        }
        break
      }
      case 'scooter': {
        const cols = ['#e5322d', '#f4f4f2', '#3b82f6', '#222', '#9ca3af', '#f5c400']
        const col = cols[Math.floor(hash(o.seed, 4) * cols.length)]
        shadow(X, Y, p, 0.5)
        ctx.fillStyle = '#222'; roundRect(X - p * 0.08, Y - p * 0.38, p * 0.16, p * 0.38, p * 0.05); ctx.fill()
        ctx.fillStyle = col; roundRect(X - p * 0.3, Y - p * 1.0, p * 0.6, p * 0.68, p * 0.16); ctx.fill(); ctx.stroke()
        ctx.fillStyle = '#2d2d2d'; roundRect(X - p * 0.24, Y - p * 1.1, p * 0.48, p * 0.16, p * 0.06); ctx.fill()
        ctx.fillStyle = '#e04040'; ctx.fillRect(X - p * 0.14, Y - p * 0.86, p * 0.28, p * 0.07)
        ctx.beginPath(); ctx.moveTo(X - p * 0.4, Y - p * 1.22); ctx.lineTo(X + p * 0.4, Y - p * 1.22); ctx.stroke()
        ctx.fillStyle = '#ccc'
        for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(X + sx * p * 0.42, Y - p * 1.38, p * 0.07, p * 0.09, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke() }
        break
      }
      case 'cone': {
        ctx.fillStyle = '#222'; ctx.fillRect(X - p * 0.22, Y - p * 0.05, p * 0.44, p * 0.05)
        ctx.fillStyle = '#f07a1a'
        ctx.beginPath(); ctx.moveTo(X - p * 0.17, Y - p * 0.05); ctx.lineTo(X + p * 0.17, Y - p * 0.05); ctx.lineTo(X + p * 0.03, Y - p * 0.7); ctx.lineTo(X - p * 0.03, Y - p * 0.7); ctx.closePath(); ctx.fill(); ctx.stroke()
        ctx.fillStyle = '#fff'; ctx.fillRect(X - p * 0.1, Y - p * 0.42, p * 0.2, p * 0.1)
        break
      }
      case 'bollard': {
        ctx.fillStyle = '#f2c230'; roundRect(X - p * 0.1, Y - p * 0.9, p * 0.2, p * 0.9, p * 0.06); ctx.fill(); ctx.stroke()
        ctx.fillStyle = '#222'; ctx.fillRect(X - p * 0.1, Y - p * 0.7, p * 0.2, p * 0.1); ctx.fillRect(X - p * 0.1, Y - p * 0.4, p * 0.2, p * 0.1)
        break
      }
      case 'barrier': {
        ctx.strokeStyle = INK; ctx.lineWidth = Math.max(3, p * 0.09); ctx.lineCap = 'round'
        const path = () => { ctx.beginPath(); ctx.moveTo(X - p * 0.5, Y); ctx.lineTo(X - p * 0.5, Y - p * 0.85); ctx.quadraticCurveTo(X - p * 0.5, Y - p, X - p * 0.35, Y - p); ctx.lineTo(X + p * 0.35, Y - p); ctx.quadraticCurveTo(X + p * 0.5, Y - p, X + p * 0.5, Y - p * 0.85); ctx.lineTo(X + p * 0.5, Y) }
        path(); ctx.stroke()
        ctx.strokeStyle = '#f2c230'; ctx.lineWidth = Math.max(1.5, p * 0.06); path(); ctx.stroke()
        ctx.lineCap = 'butt'
        break
      }
      case 'bench': {
        shadow(X, Y, p, 0.8)
        ctx.fillStyle = '#8a5a35'
        roundRect(X - p * 0.75, Y - p * 0.5, p * 1.5, p * 0.12, 2); ctx.fill(); ctx.stroke()
        roundRect(X - p * 0.75, Y - p * 0.85, p * 1.5, p * 0.12, 2); ctx.fill(); ctx.stroke()
        ctx.fillStyle = '#333'; ctx.fillRect(X - p * 0.65, Y - p * 0.5, p * 0.06, p * 0.5); ctx.fillRect(X + p * 0.59, Y - p * 0.5, p * 0.06, p * 0.5)
        break
      }
    }
  }

  function drawVehicle(x: number, s: number, kind: 'car' | 'scooter', variant: number) {
    const { X, Y, p, z } = P(x, s)
    if (z < 0.5) return
    const imgs = assets?.traffic?.[kind]
    const img = imgs?.[variant % imgs.length]
    if (img?.complete && img.naturalWidth) {
      const w = p * (kind === 'car' ? 2.3 : 1.05), h = (w * 280) / 240
      ctx.drawImage(img, X - w / 2, Y - (h * (kind === 'car' ? 256 : 262)) / 280, w, h)
      return
    }
    const col = kind === 'car' ? '#f4f4f2' : '#e9e4d8'
    ctx.strokeStyle = INK; ctx.lineWidth = line(p); ctx.lineJoin = 'round'
    if (kind === 'car') {
      shadow(X, Y, p, 1.1)
      ctx.fillStyle = '#222'; ctx.fillRect(X - p * 0.8, Y - p * 0.3, p * 0.25, p * 0.3); ctx.fillRect(X + p * 0.55, Y - p * 0.3, p * 0.25, p * 0.3)
      ctx.fillStyle = col; roundRect(X - p * 0.9, Y - p * 0.95, p * 1.8, p * 0.7, p * 0.15); ctx.fill(); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(X - p * 0.75, Y - p * 0.95); ctx.lineTo(X - p * 0.55, Y - p * 1.45); ctx.lineTo(X + p * 0.55, Y - p * 1.45); ctx.lineTo(X + p * 0.75, Y - p * 0.95); ctx.closePath(); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#3b4b5c'
      ctx.beginPath(); ctx.moveTo(X - p * 0.66, Y - p * 1.0); ctx.lineTo(X - p * 0.5, Y - p * 1.38); ctx.lineTo(X + p * 0.5, Y - p * 1.38); ctx.lineTo(X + p * 0.66, Y - p * 1.0); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#fff6c7'
      ctx.fillRect(X - p * 0.8, Y - p * 0.75, p * 0.28, p * 0.12); ctx.fillRect(X + p * 0.52, Y - p * 0.75, p * 0.28, p * 0.12)
    } else {
      shadow(X, Y, p, 0.4)
      ctx.fillStyle = '#222'; roundRect(X - p * 0.07, Y - p * 0.35, p * 0.14, p * 0.35, p * 0.05); ctx.fill()
      ctx.fillStyle = col; roundRect(X - p * 0.25, Y - p * 0.95, p * 0.5, p * 0.62, p * 0.14); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#fff6c7'; ctx.beginPath(); ctx.arc(X, Y - p * 0.8, p * 0.08, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#3b3f46'; roundRect(X - p * 0.22, Y - p * 1.45, p * 0.44, p * 0.55, p * 0.15); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#f4f4f2'; ctx.beginPath(); ctx.arc(X, Y - p * 1.62, p * 0.17, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    }
  }

  function drawPin(pin: Pin) {
    const { X, Y, p } = P(pin.x, pin.s)
    const col = pin.kind === 'anomaly' ? '#e5322d' : '#2563eb'
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1.5, p * 0.04)
    ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X, Y - p * 1.3); ctx.stroke()
    ctx.fillStyle = col
    ctx.beginPath(); ctx.moveTo(X, Y - p * 1.3); ctx.lineTo(X + p * 0.5, Y - p * 1.15); ctx.lineTo(X, Y - p * 1.0); ctx.closePath(); ctx.fill(); ctx.stroke()
  }

  function drawFrog() {
    if (!frog) return
    const { X, Y, p } = P(F.frogX, F.along)
    shadow(X, Y, p, 0.32)
    const seq = [frog.back, frog.l, frog.back, frog.r]
    const img = F.moving ? seq[Math.floor(t * 6) % 4] : frog.back
    const h = p * 0.95
    const bob = F.moving ? Math.abs(Math.sin(t * Math.PI * 3)) * p * 0.03 : 0
    ctx.drawImage(img, X - (h * 0.8) / 2, Y - h - bob + h * 0.02, h * 0.8, h)
  }
}

/** 青蛙前方是否有障礙物擋住中線：回傳建議的橫向位置（繞道） */
export function avoidX(sc: Scene, along: number): number {
  const lim = sc.width / 2 - 0.35
  for (const o of sc.objects) {
    const hw = HALF_WIDTH[o.kind]
    if (hw == null || Math.abs(o.x) > sc.width / 2) continue
    if (o.s - along > -1.2 && o.s - along < 3.5 && Math.abs(o.x) - hw < 0.35) {
      const left = o.x - hw - 0.4, right = o.x + hw + 0.4
      const target = Math.abs(left) < Math.abs(right) ? left : right
      return Math.max(-lim, Math.min(lim, target))
    }
  }
  return 0
}
