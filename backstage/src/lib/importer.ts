// 後台匯入：模組二（drive_detections）、模組三（walk_ratings）的 JSON/CSV 驗證與路段配對。
// 格式說明見 docs/data-contract.md。
import Papa from 'papaparse'

import type { DriveDetection, WalkRating } from '@/types'
import { CATEGORIES, PARTICIPANT_GROUPS } from '@/types'

import { type Matchable, nearestSegment } from './geo'

export type ImportKind = 'drive_detections' | 'walk_ratings'

export interface RowError { row: number; message: string }
export interface ImportResult<T> { rows: T[]; errors: RowError[] }

const FEATURE_LABELS = ['access-ramp', 'tactile-paving', 'audible-signal', 'crosswalk', 'bus-stop',
  'accessible-pickup', 'accessible-parking', 'hospital', 'care-home']
const LABELS = new Set([...Object.keys(CATEGORIES), ...FEATURE_LABELS])

/** 解析檔案文字：.json（陣列或 {rows:[...]} 或 GeoJSON FeatureCollection）或 .csv */
export function parseText(text: string, filename: string): Record<string, unknown>[] {
  const t = text.trim()
  if (filename.toLowerCase().endsWith('.csv') || !/^[[{]/.test(t)) {
    const r = Papa.parse<Record<string, string>>(t, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() })
    return r.data
  }
  const j = JSON.parse(t)
  if (Array.isArray(j)) return j
  if (j.type === 'FeatureCollection') {
    return j.features.map((f: { geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }) => ({
      ...f.properties, lng: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1],
    }))
  }
  if (Array.isArray(j.rows)) return j.rows
  throw new Error('JSON 必須是陣列、{ rows: [...] } 或 GeoJSON FeatureCollection')
}

const num = (v: unknown) => (v === '' || v === null || v === undefined ? NaN : Number(v))
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
const inTaoyuan = (lat: number, lng: number) => lat > 24.5 && lat < 25.2 && lng > 120.9 && lng < 121.6
function isoOrNull(v: unknown) {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const list = (v: unknown): string[] => Array.isArray(v) ? v.map(str).filter(Boolean)
  : str(v).split(/[;|,、]/).map((x) => x.trim()).filter(Boolean)

function withSeg(lat: number, lng: number, given: string, segments: Matchable[], ids: Set<string>) {
  if (given) return ids.has(given) ? { segId: given, err: null } : { segId: null, err: `segId「${given}」不存在` }
  if (Number.isNaN(lat) || Number.isNaN(lng)) return { segId: null, err: null }
  return { segId: nearestSegment(lat, lng, segments)?.id ?? null, err: null }
}

export function validateDrive(raw: Record<string, unknown>[], segments: Matchable[]): ImportResult<DriveDetection> {
  const ids = new Set(segments.map((s) => s.id))
  const rows: DriveDetection[] = [], errors: RowError[] = []
  raw.forEach((r, i) => {
    const row = i + 1, errs: string[] = []
    const lat = num(r.lat), lng = num(r.lng ?? r.lon), conf = num(r.confidence)
    const ts = isoOrNull(r.ts), label = str(r.label), sessionId = str(r.sessionId ?? r.session_id)
    if (!sessionId) errs.push('缺 sessionId')
    if (!ts) errs.push('ts 不是有效時間（ISO 8601）')
    if (!inTaoyuan(lat, lng)) errs.push('lat/lng 缺少或不在桃園範圍')
    if (!LABELS.has(label)) errs.push(`label「${label}」不在允許清單`)
    if (!(conf >= 0 && conf <= 1)) errs.push('confidence 需介於 0–1')
    if (!str(r.model)) errs.push('缺 model')
    const seg = withSeg(lat, lng, str(r.segId ?? r.seg_id), segments, ids)
    if (seg.err) errs.push(seg.err)
    if (errs.length) { errors.push({ row, message: errs.join('；') }); return }
    const heading = num(r.heading)
    rows.push({
      sessionId, ts: ts!, lat, lng, heading: Number.isNaN(heading) ? null : heading, segId: seg.segId,
      label, confidence: conf, model: str(r.model), framePath: str(r.framePath ?? r.frame_path) || null, verified: false,
    })
  })
  return { rows, errors }
}

export function validateWalk(raw: Record<string, unknown>[], segments: Matchable[]): ImportResult<WalkRating> {
  const ids = new Set(segments.map((s) => s.id))
  const rows: WalkRating[] = [], errors: RowError[] = []
  raw.forEach((r, i) => {
    const row = i + 1, errs: string[] = []
    const lat = num(r.lat), lng = num(r.lng ?? r.lon)
    const safety = num(r.safety), comfort = num(r.comfort)
    const ts = isoOrNull(r.ts), sessionId = str(r.sessionId ?? r.session_id)
    const source = str(r.source), group = str(r.participantGroup ?? r.participant_group)
    const issues = list(r.issues)
    const segGiven = str(r.segId ?? r.seg_id)
    if (!sessionId) errs.push('缺 sessionId')
    if (!ts) errs.push('ts 不是有效時間（ISO 8601）')
    if (source !== 'game' && source !== 'field') errs.push('source 需為 game 或 field')
    if (!(group in PARTICIPANT_GROUPS)) errs.push(`participantGroup「${group}」不在允許清單`)
    for (const [k, v] of [['safety', safety], ['comfort', comfort]] as const) {
      if (!(Number.isInteger(v) && v >= 1 && v <= 5)) errs.push(`${k} 需為 1–5 整數`)
    }
    const bad = issues.filter((x) => !(x in CATEGORIES))
    if (bad.length) errs.push(`issues 有未知類別：${bad.join('、')}`)
    const hasPos = !Number.isNaN(lat) && !Number.isNaN(lng)
    if (hasPos && !inTaoyuan(lat, lng)) errs.push('lat/lng 不在桃園範圍')
    if (!hasPos && !segGiven) errs.push('需提供 segId 或 lat/lng')
    const seg = withSeg(lat, lng, segGiven, segments, ids)
    if (seg.err) errs.push(seg.err)
    if (errs.length) { errors.push({ row, message: errs.join('；') }); return }
    rows.push({
      sessionId, source: source as WalkRating['source'], participantGroup: group as WalkRating['participantGroup'],
      segId: seg.segId, lat: hasPos ? lat : null, lng: hasPos ? lng : null, safety, comfort, issues, ts: ts!,
    })
  })
  return { rows, errors }
}
