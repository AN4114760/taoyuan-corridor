import { describe, expect, it } from 'vitest'

import { segmentPath } from '@/lib/scene/path'

// 往東北 45° 的 100m × 3m 人行道
const lat0 = 24.977, lng0 = 121.269, k = Math.cos((lat0 * Math.PI) / 180), M = 111_320
const ll = (x: number, y: number) => [lng0 + x / (M * k), lat0 + y / M]
const d = Math.SQRT1_2
const ring = [[-50, -1.5], [50, -1.5], [50, 1.5], [-50, 1.5], [-50, -1.5]].map(([a, b]) => ll(a * d - b * d, a * d + b * d))
const seg = { geometry: JSON.stringify({ type: 'Polygon', coordinates: [ring] }), centroid: { lat: lat0, lng: lng0 } }

describe('segmentPath', () => {
  it('主軸長度與往東方向', () => {
    const p = segmentPath(seg)
    expect(p.length).toBeCloseTo(100, 0)
    const a = p.at(0), b = p.at(100)
    expect(b.lng).toBeGreaterThan(a.lng)
    expect(b.lat).toBeGreaterThan(a.lat)
  })
  it('投影：中心點在 50m；at 與 project 互逆', () => {
    const p = segmentPath(seg)
    expect(p.project({ lat: lat0, lng: lng0 }).s).toBeCloseTo(50, 1)
    expect(p.project(p.at(23)).s).toBeCloseTo(23, 3)
  })
  it('反方向：起點對調、左右對調', () => {
    const f = segmentPath(seg), r = segmentPath(seg, true)
    const q = { lat: lat0 + 2 / M, lng: lng0 - 2 / (M * k) } // 西北側
    expect(r.project(q).s).toBeCloseTo(f.length - f.project(q).s, 3)
    expect(Math.sign(r.project(q).off)).toBe(-Math.sign(f.project(q).off))
  })
})
