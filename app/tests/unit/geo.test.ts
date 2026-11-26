import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { nearestSegment } from '@/lib/geo'

const fc = JSON.parse(readFileSync(new URL('../../../data/outputs/taoyuan_hospital_severity.geojson', import.meta.url), 'utf8'))
const segs = fc.features.map((f: { geometry: unknown; properties: { seg_id: string; kind: string } }) => ({
  id: f.properties.seg_id, kind: f.properties.kind, geometry: f.geometry,
}))

describe('nearestSegment', () => {
  it('點在人行道多邊形內 → 該路段、距離 0', () => {
    const sw = fc.features.find((f: { properties: { seg_id: string } }) => f.properties.seg_id === 'taoyuan_hospital-sw009')
    const [lng, lat] = sw.geometry.coordinates[0][0]
    const r = nearestSegment(lat, lng, segs)
    expect(r?.id).toBe('taoyuan_hospital-sw009')
    expect(r?.dist).toBe(0)
  })
  it('離所有路段超過 25m → null', () => {
    expect(nearestSegment(25.1, 121.5, segs)).toBeNull()
  })
})
