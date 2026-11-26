// 向量底圖：OpenFreeMap（OSM 資料、Positron 淡灰樣式），經 MapLibre 接入 Leaflet。
// 規則同 module1/map.html：
//   保留：醫療院所（永遠最先出現、最上層，z12 起）、地標（學校、大學、車站、公園、郵局、派出所、消防局、圖書館、體育場、博物館）、
//         路名、地名、醫療院所內大樓名稱（z16 起）
//   不顯示：門牌號、商店餐廳等一般 POI、宗教場所；名稱只顯示中文
import '@maplibre/maplibre-gl-leaflet'
import 'maplibre-gl/dist/maplibre-gl.css'

import L from './leaflet'

const BUILDINGS = import.meta.glob('../../../data/outputs/*_facility_buildings.geojson', {
  eager: true, query: '?raw', import: 'default',
}) as Record<string, string>

const ZH = ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name']]
const HALO = { 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 }
const FONT = ['Noto Sans Regular']
const MEDICAL = ['match', ['get', 'class'], ['hospital', 'doctors', 'dentist'], true, false]
const LANDMARK = ['any',
  ['match', ['get', 'class'], ['college', 'railway', 'police', 'fire_station', 'library', 'stadium', 'museum'], true, false],
  ['==', ['get', 'subclass'], 'post_office'],
  ['all', ['==', ['get', 'class'], 'school'], ['==', ['get', 'subclass'], 'school']],
  ['all', ['==', ['get', 'class'], 'park'], ['has', 'name']]]
const isHospital = ['==', ['get', 'subclass'], 'hospital']

type StyleLayer = { id: string; type: string; layout?: Record<string, unknown>; [k: string]: unknown }

export async function addBasemap(map: L.Map, siteId: string) {
  // 沒有 WebGL（舊裝置、部分無頭瀏覽器）時直接丟錯，讓呼叫端改用點陣底圖，避免半初始化的圖層一直報錯
  const c = document.createElement('canvas')
  if (!(c.getContext('webgl2') || c.getContext('webgl'))) throw new Error('此瀏覽器不支援 WebGL')
  const style = await fetch('https://tiles.openfreemap.org/styles/positron').then((r) => r.json())
  style.layers = (style.layers as StyleLayer[]).filter((l) => !['airport', 'highway-shield-us-interstate', 'road_shield_us'].includes(l.id))
  for (const l of style.layers as StyleLayer[]) {
    if (l.type === 'symbol' && l.layout?.['text-field'] && !l.id.includes('shield')) l.layout['text-field'] = ZH
  }
  const raw = Object.entries(BUILDINGS).find(([k]) => k.includes(`/${siteId}_facility_buildings`))?.[1]
  style.sources.facility_buildings = { type: 'geojson', data: raw ? JSON.parse(raw) : { type: 'FeatureCollection', features: [] } }
  style.layers.push(
    { id: 'poi-landmark', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 15, filter: LANDMARK,
      layout: { 'text-field': ZH, 'text-font': FONT, 'text-size': 11, 'text-max-width': 8 },
      paint: { 'text-color': '#6b7280', ...HALO } },
    { id: 'facility-building-label', type: 'symbol', source: 'facility_buildings', minzoom: 16,
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11.5, 'text-max-width': 6 },
      paint: { 'text-color': '#1e3a8a', ...HALO } },
    ...([['clinic', ['all', MEDICAL, ['!', isHospital]], 3, 11], ['hospital', ['all', MEDICAL, isHospital], 4.5, 13]] as const)
      .flatMap(([k, filter, r, size]) => [
        { id: `poi-medical-${k}-dot`, type: 'circle', source: 'openmaptiles', 'source-layer': 'poi', filter, minzoom: 12,
          paint: { 'circle-radius': r, 'circle-color': '#c0262d', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } },
        { id: `poi-medical-${k}`, type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', filter, minzoom: 12,
          layout: { 'text-field': ZH, 'text-font': FONT, 'text-size': size, 'text-offset': [0, 0.9], 'text-anchor': 'top',
            'text-max-width': 8, 'symbol-sort-key': ['case', isHospital, 0, 1] },
          paint: { 'text-color': '#9f1d24', ...HALO } }]),
  )
  const layer = (L as unknown as { maplibreGL(o: object): L.Layer }).maplibreGL({
    style,
    attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  })
  try {
    layer.addTo(map)
  } catch (e) {
    layer.remove()
    throw e
  }
  return layer
}
