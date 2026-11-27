// 路段的走路方向：人行道多邊形 → 主軸（PCA），GPS 位置投影到主軸上就是「走到第幾公尺」。
// 標準方向：主軸往東（x 分量為正）；從另一端開始走時用 reversed()。
import type { Segment } from '@/types'

const M = 111_320

export interface LatLng { lat: number; lng: number }
export interface SegPath {
  length: number
  /** 投影：s = 距起點公尺（未截斷），off = 往左偏移公尺 */
  project(p: LatLng): { s: number; off: number }
  at(s: number): LatLng
  reversed: boolean
}

type Pos = [number, number]
function coordsOf(g: { type: string; coordinates: unknown }): Pos[] {
  const flat = (v: unknown): Pos[] => (typeof (v as unknown[])[0] === 'number' ? [v as Pos] : (v as unknown[]).flatMap(flat))
  return flat(g.coordinates)
}

export function segmentPath(seg: Pick<Segment, 'geometry' | 'centroid'>, reverse = false): SegPath {
  const g = typeof seg.geometry === 'string' ? JSON.parse(seg.geometry) : seg.geometry
  const { lat: lat0, lng: lng0 } = seg.centroid
  const k = Math.cos((lat0 * Math.PI) / 180)
  const xy = coordsOf(g).map(([lng, lat]) => [(lng - lng0) * M * k, (lat - lat0) * M] as Pos)
  const mx = xy.reduce((a, p) => a + p[0], 0) / xy.length, my = xy.reduce((a, p) => a + p[1], 0) / xy.length
  let sxx = 0, syy = 0, sxy = 0
  for (const [x, y] of xy) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my) }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  let ux = Math.cos(th), uy = Math.sin(th)
  if (ux < 0 || (ux === 0 && uy < 0)) { ux = -ux; uy = -uy }
  if (reverse) { ux = -ux; uy = -uy }
  const ts = xy.map(([x, y]) => (x - mx) * ux + (y - my) * uy)
  const t0 = Math.min(...ts), t1 = Math.max(...ts)
  const toLL = (x: number, y: number): LatLng => ({ lat: lat0 + y / M, lng: lng0 + x / (M * k) })
  return {
    length: t1 - t0,
    reversed: reverse,
    project({ lat, lng }) {
      const x = (lng - lng0) * M * k - mx, y = (lat - lat0) * M - my
      return { s: x * ux + y * uy - t0, off: -x * uy + y * ux }
    },
    at(s) {
      const t = t0 + s
      return toLL(mx + ux * t, my + uy * t)
    },
  }
}
