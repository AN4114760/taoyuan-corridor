// 走路模式的場景：路段上有哪些樹、障礙物、團隊標注點。
// 座標：s = 距路段起點公尺（標準方向，見 path.ts）、x = 距人行道中線公尺（右正）。
// 目前是示意：樹與障礙物用路段 id 當種子隨機產生；團隊標注點寫在 TEAM_SCENES。之後改成實拍照片＋後台標注。
import type { Category } from '@/types'

export type ObjKind = 'tree' | 'lamp' | 'box' | 'scooter' | 'cone' | 'bollard' | 'barrier' | 'pole' | 'bench' | 'car' | 'pothole' | 'signboard' | 'trash'
/** 有 SVG 素材（public/icons/obstacle-*.svg、pin-*.svg）的障礙物 */
export const SPRITE_KINDS = ['scooter', 'cone', 'car', 'pothole', 'signboard', 'trash'] as const
export const PIN_KINDS = ['box', ...SPRITE_KINDS] as const
export type PinKind = (typeof PIN_KINDS)[number]

export interface SceneObj {
  kind: ObjKind
  s: number
  x: number
  h?: number          // 高度（公尺），樹用
  seed: number        // 外觀變化
  hotspot?: string
}

export interface Hotspot {
  id: string
  s: number
  title: string
  desc: string
  category: Category
  icon: PinKind         // 紅色水滴地標裡的圖
  /** 走到這裡時青蛙問的問題 */
  ask: string
}

export interface Scene {
  title?: string        // 畫面上顯示的路名（資料的 road_name 來自 OSM，可能與實際門牌不同）
  width: number         // 人行道寬（公尺）
  roadSide: 1 | -1      // 標準方向下車道在右（1）或左（-1）
  leftKind: 'lawn' | 'shops'
  objects: SceneObj[]
  hotspots: Hotspot[]
  demo: boolean         // 示意場景（隨機）
}

/** 障礙物的寬度一半（公尺），青蛙繞道與碰撞用 */
export const HALF_WIDTH: Partial<Record<ObjKind, number>> = {
  box: 0.6, scooter: 0.4, cone: 0.2, bollard: 0.12, barrier: 0.6, bench: 0.7, car: 1.0, pothole: 0.6, signboard: 0.35, trash: 0.55,
}

function rng(seedStr: string) {
  let h = 2166136261
  for (const c of seedStr) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

interface TeamScene { title?: string; width: number; roadSide: 1 | -1; leftKind: Scene['leftKind']; fixed: Omit<SceneObj, 'seed'>[]; hotspots: Hotspot[] }

/** 團隊實地標注的路段（示意）；地圖主畫面的青蛙按鈕會把這些路段當作任務 */
const TEAM_SCENES: Record<string, TeamScene> = {
  // 桃園醫院正門前（1496 巷口 → 龍壽街口），左側是醫院草坪、右側是中山路車道
  'taoyuan_hospital-sw009': {
    title: '中山路・桃園醫院前', width: 3.2, roadSide: 1, leftKind: 'lawn',
    fixed: [
      { kind: 'box', s: 38, x: 0.35, hotspot: 'sw009-box' },
      { kind: 'tree', s: 41.5, x: 1.25, h: 7.5 },
      { kind: 'barrier', s: 46, x: -1.3 },
      { kind: 'barrier', s: 48, x: -1.3 },
      { kind: 'cone', s: 30, x: -2.6 },
      { kind: 'cone', s: 32, x: -2.6 },
      { kind: 'scooter', s: 71, x: 0.7, hotspot: 'sw009-scooter' },
      { kind: 'scooter', s: 72.4, x: 0.9 },
      { kind: 'scooter', s: 73.8, x: 0.8 },
      { kind: 'trash', s: 22, x: -1.15 },
      { kind: 'signboard', s: 56, x: -1.0 },
      { kind: 'pothole', s: 88, x: 0.2, hotspot: 'sw009-pothole' },
    ],
    hotspots: [
      {
        id: 'sw009-box', s: 38, category: 'too-narrow', icon: 'box', title: '變電箱佔用人行道',
        desc: '變電箱與底座佔去人行道近一半寬度，旁邊還有行道樹，剩下的通行寬度約 1.2 m（模組一量測淨寬 1.2 m）。',
        ask: '經過變電箱旁邊時，你覺得安全嗎？',
      },
      {
        id: 'sw009-scooter', s: 71, category: 'parked-vehicle', icon: 'scooter', title: '機車停放佔用（示意）',
        desc: '人行道上常有機車停放，需要側身或走到車道邊才能通過。',
        ask: '這裡的機車讓你需要繞路嗎？感覺如何？',
      },
      {
        id: 'sw009-pothole', s: 88, category: 'broken-surface', icon: 'pothole', title: '鋪面坑洞（示意）',
        desc: '人行道中間有一處坑洞，輪椅、助行器或視障者容易卡住或絆倒。',
        ask: '走過坑洞時，你覺得安全嗎？',
      },
    ],
  },
}

export function buildScene(segId: string, length: number, opts: { width?: number | null; canopy?: number | null } = {}): Scene {
  const team = TEAM_SCENES[segId]
  const r = rng(segId)
  const width = team?.width ?? Math.max(2, Math.min(4, opts.width ?? 2.5))
  const objects: SceneObj[] = (team?.fixed ?? []).map((o, i) => ({ ...o, seed: i * 7 + 3 }))
  const busy = (s: number, pad: number) => objects.some((o) => o.kind !== 'tree' && Math.abs(o.s - s) < pad)
  // 行道樹：在車道側的樹穴，綠蔽率越高越密
  const gap = 14 - 6 * Math.min(1, Math.max(0, opts.canopy ?? 0.5))
  for (let s = -60 + r() * 4; s < length + 60; s += gap * (0.75 + r() * 0.5)) {
    if (!busy(s, 2)) objects.push({ kind: 'tree', s, x: width / 2 - 0.35, h: 5.5 + r() * 3, seed: Math.floor(r() * 1e6) })
  }
  // 路燈：草坪／店家側
  for (let s = -60 + r() * 6; s < length + 60; s += 22 + r() * 6) objects.push({ kind: 'lamp', s, x: -width / 2 - 0.5, seed: 0 })
  // 電線桿：車道側
  for (let s = -50 + r() * 10; s < length + 60; s += 40 + r() * 15) {
    if (!busy(s, 2)) objects.push({ kind: 'pole', s, x: width / 2 + 0.05, seed: 0 })
  }
  // 沒有團隊標注的路段：隨機放一兩個障礙物
  if (!team) {
    const kinds: ObjKind[] = ['scooter', 'cone', 'bollard', 'bench', 'signboard', 'trash', 'pothole']
    const n = 1 + Math.floor(r() * 2)
    for (let i = 0; i < n; i++) {
      const s = length * (0.25 + 0.5 * r())
      if (busy(s, 6)) continue
      const kind = kinds[Math.floor(r() * kinds.length)]
      objects.push({ kind, s, x: (r() < 0.5 ? -1 : 1) * width * 0.25, seed: Math.floor(r() * 1e6) })
    }
  }
  return { title: team?.title, width, roadSide: team?.roadSide ?? 1, leftKind: team?.leftKind ?? 'lawn', objects, hotspots: team?.hotspots ?? [], demo: !team }
}

/** 從另一端開始走：s、x 都鏡射 */
export function mirrorScene(sc: Scene, length: number): Scene {
  return {
    ...sc,
    roadSide: (-sc.roadSide) as 1 | -1,
    objects: sc.objects.map((o) => ({ ...o, s: length - o.s, x: -o.x })),
    hotspots: sc.hotspots.map((h) => ({ ...h, s: length - h.s })),
  }
}

/** 有團隊標注點的路段 id */
export const TEAM_SEGMENTS = Object.keys(TEAM_SCENES)
