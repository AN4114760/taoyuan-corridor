// 最近路段比對：把點（回報、模組二偵測、模組三評分）配對到模組一的路段。
// 路段只有百筆左右，直接在用戶端全部比對；距離用以點為中心的等距圓柱投影（< 1km 範圍誤差可忽略）。

type Pos = [number, number] // [lng, lat]
type Geometry =
  | { type: 'Point'; coordinates: Pos }
  | { type: 'LineString'; coordinates: Pos[] }
  | { type: 'MultiLineString'; coordinates: Pos[][] }
  | { type: 'Polygon'; coordinates: Pos[][] }
  | { type: 'MultiPolygon'; coordinates: Pos[][][] }

const M_PER_DEG = 111_320

function project(lat0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180)
  return ([lng, lat]: Pos, o: Pos): [number, number] => [(lng - o[0]) * M_PER_DEG * k, (lat - o[1]) * M_PER_DEG]
}

function distToSegment(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function pointInRing(p: [number, number], ring: [number, number][]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 點到幾何的距離（公尺）；點在多邊形內為 0 */
export function distanceToGeometry(lat: number, lng: number, g: Geometry): number {
  const origin: Pos = [lng, lat]
  const P = project(lat)
  const p: [number, number] = [0, 0]
  const lineDist = (coords: Pos[]) => {
    const xy = coords.map((c) => P(c, origin))
    if (xy.length === 1) return Math.hypot(xy[0][0], xy[0][1])
    let d = Infinity
    for (let i = 1; i < xy.length; i++) d = Math.min(d, distToSegment(p, xy[i - 1], xy[i]))
    return d
  }
  const polyDist = (rings: Pos[][]) => {
    const outer = rings[0].map((c) => P(c, origin))
    const holes = rings.slice(1).map((r) => r.map((c) => P(c, origin)))
    if (pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h))) return 0
    return Math.min(...rings.map(lineDist))
  }
  switch (g.type) {
    case 'Point': return lineDist([g.coordinates])
    case 'LineString': return lineDist(g.coordinates)
    case 'MultiLineString': return Math.min(...g.coordinates.map(lineDist))
    case 'Polygon': return polyDist(g.coordinates)
    case 'MultiPolygon': return Math.min(...g.coordinates.map(polyDist))
  }
}

export interface Matchable { id: string; geometry: string | Geometry; kind?: string }

const parsed = new WeakMap<object, Geometry>()
function geomOf(s: Matchable): Geometry {
  if (typeof s.geometry !== 'string') return s.geometry
  let g = parsed.get(s)
  if (!g) { g = JSON.parse(s.geometry) as Geometry; parsed.set(s, g) }
  return g
}

/** 點到某個路段的距離（公尺）：開始走訪前的定位檢查用 */
export function distanceToSegment(lat: number, lng: number, s: Matchable): number {
  return distanceToGeometry(lat, lng, geomOf(s))
}

/**
 * 回傳 maxDist 公尺內最近的路段 id；找不到回傳 null。
 * 實測人行道（sidewalk）優先：兩者距離相差不到 3m 時選人行道，避免點到「無人行道」的偏移線。
 */
export function nearestSegment(lat: number, lng: number, segments: Matchable[], maxDist = 25): { id: string; dist: number } | null {
  let best: { id: string; dist: number; kind?: string } | null = null
  for (const s of segments) {
    const d = distanceToGeometry(lat, lng, geomOf(s))
    if (d > maxDist) continue
    if (!best) { best = { id: s.id, dist: d, kind: s.kind }; continue }
    const preferThis = s.kind === 'sidewalk' && best.kind !== 'sidewalk' ? d < best.dist + 3
      : s.kind !== 'sidewalk' && best.kind === 'sidewalk' ? d < best.dist - 3
      : d < best.dist
    if (preferThis) best = { id: s.id, dist: d, kind: s.kind }
  }
  return best && { id: best.id, dist: Math.round(best.dist * 10) / 10 }
}
