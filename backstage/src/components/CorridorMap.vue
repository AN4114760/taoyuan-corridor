<script setup lang="ts">
// 共用地圖：民眾端與後台都用。
// - 路段：依模組一嚴重程度（level）或模組四綜合評級（grade）上色，深色外框＋彩色線（導航風格）
// - 設施圖標：icons/ 規格（機構 48px、設施 38px，顏色只代表類別），設施點位聚合
// - overlays：後台的回報／模組二／模組三點位圖層
// - pickMode：點地圖選位置（回報時 GPS 不準可手動指定）
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { addBasemap } from '@/lib/basemap'
import L from '@/lib/leaflet'
import type { FeatureType, MapFeature, Segment } from '@/types'
import { GRADE_COLOR, LEVEL_COLOR, LEVEL_LABEL } from '@/types'

export interface OverlayPoint { id: string; lat: number; lng: number; color: string; popup?: string }
export interface Overlay { key: string; name: string; color: string; points: OverlayPoint[]; visible?: boolean }

const props = withDefaults(defineProps<{
  segments: Segment[]
  features?: MapFeature[]
  colorBy?: 'level' | 'grade'
  overlays?: Overlay[]
  pickMode?: boolean
  picked?: { lat: number; lng: number } | null
  selectedId?: string | null
  siteId: string
}>(), { features: () => [], colorBy: 'level', overlays: () => [], pickMode: false, picked: null, selectedId: null })

const emit = defineEmits<{
  (e: 'select-segment', id: string | null): void
  (e: 'pick', pos: { lat: number; lng: number }): void
  (e: 'select-point', key: string, id: string): void
}>()

const el = ref<HTMLDivElement>()
let map: L.Map
let segLayer: L.LayerGroup | null = null
let control: L.Control.Layers | null = null
const featureLayers: L.Layer[] = []
const overlayLayers = new Map<string, L.LayerGroup>()
let pickMarker: L.Marker | null = null
let fitted = false

const ICONS = import.meta.glob('../../../icons/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const iconUrl = (type: string) => Object.entries(ICONS).find(([k]) => k.endsWith(`/${type}.svg`))?.[1] ?? ''

const TYPES: Record<FeatureType, { name: string; group: 'facility' | 'transit' | 'access'; show: boolean }> = {
  hospital: { name: '醫院', group: 'facility', show: true },
  'care-home': { name: '安養機構', group: 'facility', show: true },
  clinic: { name: '診所', group: 'facility', show: false },
  'bus-stop': { name: '公車站', group: 'transit', show: true },
  'accessible-pickup': { name: '無障礙上下車點', group: 'transit', show: true },
  'accessible-parking': { name: '身障優先車格', group: 'transit', show: true },
  'access-ramp': { name: '無障礙坡道', group: 'access', show: true },
  'tactile-paving': { name: '導盲磚', group: 'access', show: true },
  'audible-signal': { name: '有聲號誌', group: 'access', show: true },
  crosswalk: { name: '行人穿越道', group: 'access', show: true },
}
const ORDER: Record<string, number> = { missing: 0, good: 1, caution: 2, severe: 3, A: 1, B: 2, C: 3, D: 4, none: 0 }
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function segColor(s: Segment) {
  if (props.colorBy === 'grade') return s.stats?.grade ? GRADE_COLOR[s.stats.grade] : '#9ca3af'
  return LEVEL_COLOR[s.level]
}

function drawSegments() {
  segLayer?.remove()
  segLayer = L.layerGroup().addTo(map)
  const key = (s: Segment) => (props.colorBy === 'grade' ? s.stats?.grade ?? 'none' : s.level)
  const sorted = [...props.segments].sort((a, b) => ORDER[key(a)] - ORDER[key(b)])
  const all: L.GeoJSON[] = []
  for (const s of sorted) {
    const geom = JSON.parse(s.geometry)
    const sel = s.id === props.selectedId
    L.geoJSON(geom, { interactive: false, style: { color: sel ? '#1e3a8a' : '#2b2b2b', weight: sel ? 15 : 11, opacity: 0.9, fill: false, lineJoin: 'round', lineCap: 'round' } }).addTo(segLayer)
    const g = L.geoJSON(geom, {
      style: { color: segColor(s), weight: 7, opacity: 1, fill: false, lineJoin: 'round', lineCap: 'round',
        dashArray: props.colorBy === 'grade' && !s.stats?.grade ? '6 8' : undefined },
    })
    g.on('click', (ev) => {
      L.DomEvent.stopPropagation(ev)
      if (props.pickMode) emit('pick', { lat: ev.latlng.lat, lng: ev.latlng.lng })
      else emit('select-segment', s.id)
    })
    g.bindTooltip(`${esc(s.road_name || '未命名道路')}・${LEVEL_LABEL[s.level]}`, { sticky: true })
    g.addTo(segLayer)
    all.push(g)
  }
  if (!fitted && all.length) {
    map.fitBounds(L.featureGroup(all).getBounds(), { padding: [20, 20] })
    fitted = true
  }
}

function featureCard(f: MapFeature) {
  const t = TYPES[f.type]
  const badge = f.verified ? '<span class="badge ok">已現勘</span>' : '<span class="badge todo">待現勘</span>'
  return `<div class="card"><h4>${esc(f.name || t.name)}${badge}</h4><div class="muted">${t.name}</div>
    ${f.address ? `<div>地址：${esc(f.address)}</div>` : ''}
    <div class="muted">來源：${esc(f.source ?? '–')}${f.verified ? '' : '｜資料未經本研究現地確認'}</div></div>`
}

function drawFeatures() {
  featureLayers.forEach((l) => { l.remove(); control?.removeLayer(l) })
  featureLayers.length = 0
  for (const [type, t] of Object.entries(TYPES) as [FeatureType, (typeof TYPES)[FeatureType]][]) {
    const feats = props.features.filter((f) => f.type === type)
    if (!feats.length) continue
    const layer = t.group === 'facility' ? L.layerGroup()
      : L.markerClusterGroup({ showCoverageOnHover: false, disableClusteringAtZoom: 18, maxClusterRadius: 40 })
    const size = t.group === 'facility' ? 48 : 38
    for (const f of feats) {
      const m = L.marker([f.lat, f.lng], {
        icon: L.icon({ iconUrl: iconUrl(type), iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2 + 2], className: 'feat-icon' }),
        zIndexOffset: size === 48 ? 1000 : 0,
      })
      m.bindTooltip(esc(f.name || t.name), { direction: 'top', offset: [0, -size / 2] })
      m.bindPopup(featureCard(f))
      layer.addLayer(m)
    }
    if (t.show) layer.addTo(map)
    control!.addOverlay(layer, `<img src="${iconUrl(type)}" class="ctl-icon">${t.name}（${feats.length}）`)
    featureLayers.push(layer)
  }
}

function drawOverlays() {
  const keep = new Set(props.overlays.map((o) => o.key))
  for (const [k, l] of overlayLayers) if (!keep.has(k)) { l.remove(); control?.removeLayer(l); overlayLayers.delete(k) }
  for (const o of props.overlays) {
    let layer = overlayLayers.get(o.key)
    const wasOn = layer ? map.hasLayer(layer) : o.visible !== false
    if (layer) { layer.remove(); control?.removeLayer(layer) }
    layer = L.layerGroup()
    for (const p of o.points) {
      const m = L.circleMarker([p.lat, p.lng], { radius: 6, color: '#fff', weight: 1.5, fillColor: p.color, fillOpacity: 0.95 })
      if (p.popup) m.bindPopup(p.popup, { maxWidth: 280 })
      m.on('click', () => emit('select-point', o.key, p.id))
      layer.addLayer(m)
    }
    if (wasOn) layer.addTo(map)
    control!.addOverlay(layer, `<span class="ctl-dot" style="background:${o.color}"></span>${esc(o.name)}（${o.points.length}）`)
    overlayLayers.set(o.key, layer)
  }
}

function drawPicked() {
  pickMarker?.remove()
  pickMarker = null
  if (props.picked) {
    pickMarker = L.marker([props.picked.lat, props.picked.lng], {
      icon: L.divIcon({ className: 'pick-pin', html: '<div></div>', iconSize: [22, 22], iconAnchor: [11, 22] }),
    }).addTo(map)
  }
}

onMounted(() => {
  map = L.map(el.value!, { zoomControl: false, maxZoom: 20 }).setView([24.9772, 121.2692], 16)
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  control = L.control.layers(undefined, undefined, { collapsed: true, position: 'topright' }).addTo(map)
  addBasemap(map, props.siteId).catch(() => {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'osm-muted', attribution: '© OpenStreetMap contributors' }).addTo(map)
  })
  map.on('click', (e) => {
    if (props.pickMode) emit('pick', { lat: e.latlng.lat, lng: e.latlng.lng })
    else emit('select-segment', null)
  })
  drawSegments(); drawFeatures(); drawOverlays(); drawPicked()
})
onBeforeUnmount(() => map?.remove())

watch(() => [props.segments, props.colorBy, props.selectedId], drawSegments)
watch(() => props.features, drawFeatures)
watch(() => props.overlays, drawOverlays, { deep: true })
watch(() => props.picked, drawPicked)

defineExpose({ flyTo: (lat: number, lng: number, z = 18) => map.flyTo([lat, lng], z) })
</script>

<template>
  <div ref="el" class="corridor-map" :class="{ picking: pickMode }"></div>
</template>

<style>
.corridor-map { width: 100%; height: 100%; background: #f2f2ef; }
.corridor-map.picking { cursor: crosshair; }
.corridor-map .feat-icon { filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .28)); }
.corridor-map .osm-muted { filter: grayscale(1) brightness(1.08) contrast(.85); }
.corridor-map .leaflet-control-layers { border-radius: 12px !important; font-size: 13px; }
.corridor-map .ctl-icon { width: 20px; height: 20px; vertical-align: -5px; margin-right: 4px; }
.corridor-map .ctl-dot { display: inline-block; width: 12px; height: 12px; border-radius: 6px; margin: 0 6px 0 4px; vertical-align: -1px; border: 1.5px solid #fff; box-shadow: 0 0 0 1px #94a3b8; }
.corridor-map .marker-cluster-small, .corridor-map .marker-cluster-medium, .corridor-map .marker-cluster-large { background: rgba(51, 65, 85, .18); }
.corridor-map .marker-cluster div { background: #fff; border: 1.65px solid #334155; color: #334155; font-weight: 600; }
.corridor-map .card h4 { margin: 0 0 4px; font-size: 14px; }
.corridor-map .muted { color: #888; font-size: 12px; }
.badge { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 9px; margin-left: 4px; vertical-align: 1px; }
.badge.todo { background: #fff4d6; color: #8a5a00; border: 1px solid #f3cf6b; }
.badge.ok { background: #e3f6e8; color: #17692f; border: 1px solid #9fd8ae; }
.pick-pin div { width: 22px; height: 22px; border-radius: 50% 50% 50% 0; background: #1e3a8a; transform: rotate(-45deg); border: 2px solid #fff; box-shadow: 0 2px 4px rgba(0, 0, 0, .35); }
</style>
