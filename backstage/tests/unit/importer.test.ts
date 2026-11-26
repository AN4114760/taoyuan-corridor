import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { parseText, validateDrive, validateWalk } from '@/lib/importer'

const fc = JSON.parse(readFileSync(new URL('../../../data/outputs/taoyuan_hospital_severity.geojson', import.meta.url), 'utf8'))
const segs = fc.features.map((f: { geometry: unknown; properties: { seg_id: string; kind: string } }) => ({
  id: f.properties.seg_id, kind: f.properties.kind, geometry: f.geometry,
}))
const tpl = (name: string) => readFileSync(new URL(`../../../docs/templates/${name}`, import.meta.url), 'utf8')

describe('docs/templates 範本 CSV 可以直接通過驗證', () => {
  it('模組二', () => {
    const r = validateDrive(parseText(tpl('module2_drive_detections.csv'), 'a.csv'), segs)
    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0].segId).toBe('taoyuan_hospital-sw009')
  })
  it('模組三（沒有 seg_id 的列依座標配對）', () => {
    const r = validateWalk(parseText(tpl('module3_walk_ratings.csv'), 'b.csv'), segs)
    expect(r.errors).toEqual([])
    expect(r.rows[0].issues).toEqual(['tree-obstruction', 'too-narrow'])
  })
})

it('錯誤的列會列出原因、不計入', () => {
  const csv = 'sessionId,ts,lat,lng,seg_id,label,confidence,model\nx,not-a-date,24.977,121.269,,flying-car,1.5,m'
  const r = validateDrive(parseText(csv, 'c.csv'), segs)
  expect(r.rows).toHaveLength(0)
  expect(r.errors[0].message).toMatch(/ts.*label.*confidence/)
})
