// 資料層：全部經由地端伺服器 /api 讀寫（之後改接 Firebase 時只需換掉這個檔案）。
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { api } from '@/lib/api'
import { nearestSegment } from '@/lib/geo'
import { parseText, type RowError, validateDrive, validateWalk } from '@/lib/importer'
import type { DriveDetection, Feedback, FeedbackStatus, Integrated, MapFeature, ParticipantGroup, Segment, WalkRating } from '@/types'

type Geo = { type: string; coordinates: unknown }
interface FC<P> { type: 'FeatureCollection'; metadata?: Record<string, unknown>; features: { geometry: Geo; properties: P }[] }
export interface ModuleFile { name: string; mtime: string; rows: number; errors: RowError[] }

export const SITE_ID = import.meta.env.VITE_SITE_ID ?? 'taoyuan_hospital'

function centroid(g: Geo): { lat: number; lng: number } {
  const pts: number[][] = []
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === 'number') pts.push(c as number[])
    else if (Array.isArray(c)) c.forEach(walk)
  }
  walk(g.coordinates)
  const n = pts.length || 1
  return { lng: pts.reduce((s, p) => s + p[0], 0) / n, lat: pts.reduce((s, p) => s + p[1], 0) / n }
}

export const useData = defineStore('data', () => {
  const segments = ref<Segment[]>([])
  const features = ref<MapFeature[]>([])
  const drive = ref<DriveDetection[]>([])
  const walks = ref<WalkRating[]>([])
  const moduleFiles = ref<{ m2: ModuleFile[]; m3: ModuleFile[] }>({ m2: [], m3: [] })
  const feedback = ref<Feedback[]>([])
  const integrated = ref<Map<string, Integrated> | null>(null)
  const integratedMeta = ref<Record<string, unknown> | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const segmentById = computed(() => new Map(segments.value.map((s) => [s.id, s])))
  /** 路段＋模組四評級（地圖 colorBy=grade 用） */
  const gradedSegments = computed<Segment[]>(() => segments.value.map((s) => {
    const it = integrated.value?.get(s.id)
    return it ? { ...s, stats: { grade: it.grade, integrated: it } } : s
  }))

  async function loadPublic() {
    if (segments.value.length) return
    const [sev, fea] = await Promise.all([
      api<FC<Record<string, unknown>>>('segments'),
      api<FC<Record<string, unknown>>>('features'),
    ])
    segments.value = sev.features.map(({ geometry, properties: p }) => ({
      ...(p as unknown as Segment), id: p.seg_id as string, facility_id: SITE_ID,
      photo_year: (sev.metadata?.photo_year as number) ?? null,
      geometry: JSON.stringify(geometry), centroid: centroid(geometry),
    }))
    features.value = fea.features.map(({ geometry, properties: p }) => {
      const [lng, lat] = geometry.coordinates as number[]
      return { ...(p as unknown as MapFeature), lat, lng }
    })
  }

  async function loadModules() {
    const segs = segments.value
    async function load<T>(n: 2 | 3, validate: (raw: Record<string, unknown>[], s: Segment[]) => { rows: unknown[]; errors: RowError[] }) {
      const files = await api<{ name: string; mtime: string; text: string }[]>(`module/${n}`)
      const rows: T[] = [], meta: ModuleFile[] = []
      for (const f of files) {
        let raw: Record<string, unknown>[]
        try { raw = parseText(f.text, f.name) } catch (e) {
          meta.push({ name: f.name, mtime: f.mtime, rows: 0, errors: [{ row: 0, message: String(e) }] })
          continue
        }
        const r = validate(raw, segs)
        const demo = f.name.startsWith('demo-')
        rows.push(...r.rows.map((x) => ({ ...(x as object), demo }) as T))
        meta.push({ name: f.name, mtime: f.mtime, rows: r.rows.length, errors: r.errors })
      }
      return { rows, meta }
    }
    const [m2, m3] = await Promise.all([load<DriveDetection>(2, validateDrive), load<WalkRating>(3, validateWalk)])
    drive.value = m2.rows
    walks.value = m3.rows
    moduleFiles.value = { m2: m2.meta, m3: m3.meta }
  }

  async function loadFeedback() {
    feedback.value = await api<Feedback[]>('feedback', { admin: true })
  }

  async function loadIntegrated() {
    const fc = await api<FC<Integrated & { seg_id: string }> | null>('integrated')
    integratedMeta.value = fc?.metadata ?? null
    integrated.value = fc ? new Map(fc.features.map((f) => [f.properties.seg_id, f.properties])) : null
  }

  /** 後台：一次載入全部 */
  async function loadAdmin() {
    loading.value = true
    error.value = null
    try {
      await loadPublic()
      await Promise.all([loadModules(), loadFeedback(), loadIntegrated()])
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  function matchSegment(lat: number, lng: number) {
    return nearestSegment(lat, lng, segments.value)
  }

  async function submitFeedback(input: {
    volunteerName: string; participantGroup: ParticipantGroup; segId: string; lat: number; lng: number
    safety: number; comfort: number; comment: string; anomalies: { category: string; note: string; photos: string[] }[]
  }) {
    return api<{ id: string }>('feedback', { method: 'POST', body: input })
  }

  async function review(id: string, status: FeedbackStatus, reviewNote: string) {
    const updated = await api<Feedback>(`feedback/${encodeURIComponent(id)}`, { method: 'PATCH', admin: true, body: { status, reviewNote } })
    feedback.value = feedback.value.map((f) => (f.id === id ? updated : f))
  }

  async function recompute() {
    const r = await api<{ log: string }>('integrate', { method: 'POST', admin: true })
    await loadIntegrated()
    return r.log
  }

  return {
    segments, features, drive, walks, moduleFiles, feedback, integrated, integratedMeta, loading, error,
    segmentById, gradedSegments,
    loadPublic, loadAdmin, loadFeedback, matchSegment, submitFeedback, review, recompute,
  }
})
