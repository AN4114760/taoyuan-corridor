<script setup lang="ts">
// 走路模式：青蛙隨使用者定位前進（GPS 投影到路段主軸）。不在現場的預覽：模擬定位以步行速度自動前進，走到標注點會停下等回答。
// 沿路可隨時留下「感受」（主觀安全感）、標注異常、拍照；走到團隊標注點時青蛙會問你的感受；走完填整段評分後送出。
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import SafetyFace from '@/components/SafetyFace.vue'
import UiIcon from '@/components/UiIcon.vue'
import { addBasemap } from '@/lib/basemap'
import { formatDistance, useGeo } from '@/lib/geolocation'
import { compressToDataUrl } from '@/lib/image'
import L from '@/lib/leaflet'
import { buildScene, type Hotspot, mirrorScene, PIN_KINDS, type Scene, SPRITE_KINDS } from '@/lib/scene/config'
import { segmentPath, type SegPath } from '@/lib/scene/path'
import { loadTraffic } from '@/lib/scene/vehicles'
import { avoidX, drawScene, type Hit, type Pin, type SceneAssets } from '@/lib/scene/render'
import { useAuth } from '@/stores/auth'
import { SITE_ID, useData } from '@/stores/data'
import { useWalk } from '@/stores/walk'
import { CATEGORIES, type Category, LEVEL_COLOR, type Moment } from '@/types'

const route = useRoute()
const router = useRouter()
const data = useData()
const auth = useAuth()
const walk = useWalk()
const { pos, status: geoStatus } = useGeo()

const segId = String(route.params.segId)
const seg = computed(() => data.segmentById.get(segId) ?? null)
const started = computed(() => (walk.current?.segId === segId ? walk.current : null))
/** 實地模式：已在地圖上通過 50m 定位檢查；否則為示範模式（不送出） */
const live = ref(false) // 進入頁面時決定，送出後（walk 清掉）不再改變

const path = shallowRef<SegPath | null>(null)
const scene = shallowRef<Scene | null>(null)
const along = ref(0)
const frogX = ref(0)
const moving = ref(false)
const length = computed(() => path.value?.length ?? 0)
const progress = computed(() => (length.value ? Math.min(1, along.value / length.value) : 0))

function setup() {
  const s = seg.value
  if (!s || path.value) return
  live.value = !!started.value && route.query.demo == null
  const fwd = segmentPath(s)
  // 從靠近哪一端開始走：實地用開始走訪的位置，示範固定從標準起點
  const reverse = live.value && started.value ? fwd.project({ lat: started.value.startLat, lng: started.value.startLng }).s > fwd.length / 2 : false
  const p = reverse ? segmentPath(s, true) : fwd
  const base = buildScene(s.id, fwd.length, { width: s.width_m, canopy: s.canopy_overlap_ratio })
  path.value = p
  scene.value = reverse ? mirrorScene(base, fwd.length) : base
  along.value = 0
}
watch(seg, setup)

// ---- 沿路紀錄 ----
const moments = reactive<Moment[]>([])
interface AnomalyDraft { category: Category; note: string; files: File[]; previews: string[]; lat: number; lng: number; along: number; hotspotId?: string }
const anomalies = reactive<AnomalyDraft[]>([])
const pins = computed<Pin[]>(() => {
  const w = (scene.value?.width ?? 3) / 2
  return [
    ...anomalies.filter((a) => !a.hotspotId).map((a, i) => ({ s: a.along + 1.2, x: (i % 2 ? -1 : 1) * (w - 0.3), kind: 'anomaly' as const })),
    ...moments.filter((m) => !m.hotspotId).map((m) => ({ s: m.along + 1.2, x: -(w - 0.3), kind: 'feel' as const })),
  ]
})
const here = () => {
  const ll = path.value!.at(along.value)
  return live.value && pos.value ? { lat: pos.value.lat, lng: pos.value.lng } : ll
}

// ---- 青蛙對話：標注點、沿路詢問 ----
const answered = reactive(new Set<string>())
const asked = reactive(new Set<string>())
const nearHotspot = computed<Hotspot | null>(() => {
  const sc = scene.value
  if (!sc) return null
  return sc.hotspots.find((h) => !answered.has(h.id) && h.s - along.value < 7 && h.s - along.value > -3) ?? null
})
const checkIn = ref<string | null>(null)
let checkInTimer = 0
watch(along, (a) => {
  if (!length.value || sheet.value || nearHotspot.value) return
  for (const frac of [0.3, 0.65]) {
    const key = `check-${frac}`
    if (asked.has(key) || a <= length.value * frac) continue
    // 已經走過詢問點 15m 以上（例如剛好在回答標注點）就略過，不要晚很多才問
    if (a > length.value * frac + 15 || moments.some((m) => Math.abs(m.along - a) < 15)) { asked.add(key); continue }
    {
      asked.add(key)
      checkIn.value = key
      clearTimeout(checkInTimer)
      checkInTimer = window.setTimeout(() => { checkIn.value = null }, 15000)
    }
  }
  if (a >= length.value - 1.5 && !asked.has('finish')) { asked.add('finish'); openSheet('finish') }
})

// ---- 底部面板 ----
type SheetKind = 'feel' | 'anomaly' | 'hotspot' | 'finish'
const sheet = ref<SheetKind | null>(null)
const activeHotspot = ref<Hotspot | null>(null)
const FACES = [
  { n: 1, t: '很不安全' }, { n: 2, t: '不安全' }, { n: 3, t: '普通' }, { n: 4, t: '安全' }, { n: 5, t: '很安全' },
]
const TAGS = ['車太近／車速快', '路太窄', '要繞過障礙', '要走到車道上', '地面不平', '機車擋路', '視線被擋', '很好走', '樹蔭很舒服']
const draft = reactive({ safety: 0, tags: [] as string[], note: '', category: '' as Category | '', files: [] as File[], previews: [] as string[], alsoAnomaly: false })
function resetDraft() {
  draft.previews.forEach(URL.revokeObjectURL)
  Object.assign(draft, { safety: 0, tags: [], note: '', category: '', files: [], previews: [], alsoAnomaly: false })
}
function openSheet(k: SheetKind, h?: Hotspot) {
  if (k !== 'finish') resetDraft()
  activeHotspot.value = h ?? null
  if (h) draft.category = h.category
  sheet.value = k
  checkIn.value = null
}
const toggleTag = (t: string) => { draft.tags = draft.tags.includes(t) ? draft.tags.filter((x) => x !== t) : [...draft.tags, t] }

function addPhotos(files: FileList | null) {
  for (const f of [...(files ?? [])].filter((x) => x.type.startsWith('image/'))) {
    if (draft.files.length >= 3) break
    draft.files.push(f)
    draft.previews.push(URL.createObjectURL(f))
  }
}
const photoInput = ref<HTMLInputElement>()
function onCamera(ev: Event) {
  const input = ev.target as HTMLInputElement
  if (sheet.value !== 'anomaly' && sheet.value !== 'hotspot') openSheet('anomaly')
  addPhotos(input.files)
  input.value = ''
}

function saveFeel(safety = draft.safety, hotspotId?: string) {
  if (!safety || !path.value) return
  const p = here()
  moments.push({ at: new Date().toISOString(), lat: p.lat, lng: p.lng, along: Math.round(along.value * 10) / 10, safety,
    tags: draft.tags.length ? [...draft.tags] : undefined, note: draft.note.trim() || undefined, hotspotId })
}
function pushAnomaly(category: Category, hotspotId?: string) {
  const p = here()
  anomalies.push({ category, note: draft.note.trim(), files: [...draft.files], previews: [...draft.previews], lat: p.lat, lng: p.lng, along: along.value, hotspotId })
  draft.files = []; draft.previews = []
}
function submitSheet() {
  if (sheet.value === 'feel') { saveFeel(); toast('已記下這裡的感受') }
  if (sheet.value === 'anomaly' && draft.category) { pushAnomaly(draft.category); toast('已標注異常') }
  if (sheet.value === 'hotspot' && activeHotspot.value) {
    const h = activeHotspot.value
    saveFeel(draft.safety, h.id)
    if (draft.alsoAnomaly || draft.files.length) pushAnomaly(h.category, h.id)
    answered.add(h.id)
    toast('謝謝！繼續往前走')
  }
  sheet.value = null
}
const sheetReady = computed(() => (sheet.value === 'feel' || sheet.value === 'hotspot' ? !!draft.safety : sheet.value === 'anomaly' ? !!draft.category : true))
function quickFeel(n: number) {
  resetDraft()
  saveFeel(n)
  checkIn.value = null
  toast(`已記下：${FACES[n - 1].t}`)
}

const toastMsg = ref('')
let toastTimer = 0
function toast(m: string) {
  toastMsg.value = m
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toastMsg.value = '' }, 1800)
}

// ---- 走完：整段評分＋送出 ----
const fin = reactive({ safety: 0, comfort: 0, comment: '' })
const SCALE = ['很差', '差', '普通', '好', '很好']
const submitting = ref(false)
const submitError = ref<string | null>(null)
const done = ref(false)
async function submit() {
  const w = started.value
  if (!live.value || !w || !fin.safety || !fin.comfort) return
  submitting.value = true
  submitError.value = null
  try {
    const payload = await Promise.all(anomalies.map(async (a) => ({
      category: a.category, note: a.note, photos: await Promise.all(a.files.map(compressToDataUrl)),
      lat: a.lat, lng: a.lng, along: a.along, hotspotId: a.hotspotId,
    })))
    const p = here()
    await data.submitFeedback({
      participantGroup: auth.user?.participantGroup ?? 'general', segId, lat: p.lat, lng: p.lng,
      safety: fin.safety, comfort: fin.comfort, comment: fin.comment.trim(), anomalies: payload, moments: [...moments],
      walk: { startedAt: w.startedAt, startLat: w.startLat, startLng: w.startLng, startDistanceM: w.startDistanceM, startAccuracyM: w.startAccuracyM },
    })
    walk.finish()
    done.value = true
  } catch (e) {
    submitError.value = (e as Error).message
  } finally {
    submitting.value = false
  }
}
function restartDemo() {
  moments.splice(0); anomalies.splice(0); answered.clear(); asked.clear()
  along.value = 0; sheet.value = null; done.value = false
}
function leave() {
  if ((moments.length || anomalies.length) && !done.value && !confirm('離開走路畫面？還沒送出的紀錄不會保存。')) return
  router.replace('/app/map')
}

// ---- 畫面迴圈 ----
const canvas = ref<HTMLCanvasElement>()
const stage = ref<HTMLDivElement>()
let assets: SceneAssets | null = null
const SIM_SPEED = 1.6 // m/s；預覽的模擬步行速度（比一般步行稍快）
let hits: Hit[] = []
let raf = 0
let last = 0
let W = 0, H = 0
function loadImg(src: string) { const i = new Image(); i.src = src; return i }
function resize() {
  const el = stage.value, c = canvas.value
  if (!el || !c) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  W = el.clientWidth; H = el.clientHeight
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr)
  c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0)
}
function tick(now: number) {
  raf = requestAnimationFrame(tick)
  const dt = Math.min(0.1, (now - (last || now)) / 1000)
  last = now
  const sc = scene.value, p = path.value, c = canvas.value
  if (!sc || !p || !c || !W) return
  // 前進：實地追 GPS（限速、平滑）；預覽用模擬定位（步行速度自動前進），走到未回答的標注點前會停下來等
  let target = along.value
  if (live.value && pos.value) target = Math.max(0, Math.min(length.value, p.project(pos.value).s))
  else if (!live.value && !sheet.value && !mapFull.value) target = along.value + SIM_SPEED * dt
  if (!live.value && nearHotspot.value) target = Math.min(target, nearHotspot.value.s - 1.8)
  target = Math.min(target, length.value)
  const vmax = live.value ? 1.6 : SIM_SPEED
  const step = Math.max(-vmax * dt, Math.min(vmax * dt, target - along.value))
  along.value = Math.max(0, along.value + step)
  moving.value = Math.abs(step) > 0.02 * dt * 10
  frogX.value += (avoidX(sc, along.value) - frogX.value) * Math.min(1, dt * 2.5)
  const ctx = c.getContext('2d')!
  hits = drawScene(ctx, sc, { W, H, t: now / 1000, along: along.value, frogX: frogX.value, moving: moving.value, length: length.value, pins: pins.value, near: nearHotspot.value?.id }, assets)
  updateMini()
}
function onTap(e: PointerEvent) {
  const r = canvas.value!.getBoundingClientRect()
  const x = e.clientX - r.left, y = e.clientY - r.top
  const h = hits.find((q) => Math.hypot(q.x - x, q.y - y) < q.r)
  const hs = h && scene.value?.hotspots.find((q) => q.id === h.id)
  if (hs) openSheet('hotspot', hs)
}

// ---- 小地圖：簡易版，只畫這次任務的區間（走路方向朝上）；點一下切換全螢幕地圖 ----
const MINI = { top: 16, bottom: 92 }
const miniY = (sAlong: number) => MINI.bottom - (MINI.bottom - MINI.top) * Math.max(0, Math.min(1, length.value ? sAlong / length.value : 0))
const segColor = computed(() => (seg.value ? LEVEL_COLOR[seg.value.level] : '#999'))

const mapEl = ref<HTMLDivElement>()
const mapFull = ref(false)
let map: L.Map | null = null
let me: L.Marker | null = null
function initMap() {
  if (!mapEl.value || !seg.value || !path.value || map) return
  map = L.map(mapEl.value, { zoomControl: false, attributionControl: false })
  addBasemap(map, SITE_ID).catch(() => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map!))
  // 只畫這次任務的路段
  const layer = L.geoJSON(JSON.parse(seg.value.geometry), { style: { color: segColor.value, weight: 7, opacity: 1, fillOpacity: 0.6 } }).addTo(map)
  const a = path.value.at(0), b = path.value.at(length.value)
  L.marker([a.lat, a.lng], { icon: L.divIcon({ className: 'end-tag', html: '起點', iconSize: [40, 22] }) }).addTo(map)
  L.marker([b.lat, b.lng], { icon: L.divIcon({ className: 'end-tag', html: '終點', iconSize: [40, 22] }) }).addTo(map)
  for (const h of scene.value?.hotspots ?? []) {
    const ll = path.value.at(h.s)
    L.marker([ll.lat, ll.lng], { icon: L.icon({ iconUrl: `/icons/pin-${h.icon}.svg`, iconSize: [40, 49], iconAnchor: [20, 46] }) })
      .bindTooltip(h.title).addTo(map)
  }
  me = L.marker([a.lat, a.lng], {
    icon: L.divIcon({ className: 'frog-pin', html: '<img src="/frog/talk.png" alt="">', iconSize: [40, 40], iconAnchor: [20, 20] }),
    zIndexOffset: 1000,
  }).addTo(map)
  map.fitBounds(layer.getBounds(), { padding: [70, 70], maxZoom: 19 })
}
function updateMini() {
  if (!me || !path.value || !mapFull.value) return
  const ll = path.value.at(along.value)
  me.setLatLng([ll.lat, ll.lng])
}
function toggleMap() {
  mapFull.value = !mapFull.value
  if (mapFull.value) setTimeout(() => { initMap(); map?.invalidateSize(); updateMini() }, 0)
}

let ro: ResizeObserver | null = null
onMounted(async () => {
  assets = {
    frog: { back: loadImg('/frog/back.png'), l: loadImg('/frog/walk-l.png'), r: loadImg('/frog/walk-r.png') },
    obstacle: Object.fromEntries(SPRITE_KINDS.map((k) => [k, loadImg(`/icons/obstacle-${k}.svg`)])),
    pin: Object.fromEntries(PIN_KINDS.map((k) => [k, loadImg(`/icons/pin-${k}.svg`)])),
  }
  loadTraffic().then((t) => { if (assets) assets.traffic = t }).catch(() => { /* 沒載到就用內建畫法 */ })
  await data.loadPublic()
  setup()
  resize()
  ro = new ResizeObserver(resize)
  if (stage.value) ro.observe(stage.value)
  raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
  map?.remove()
  clearTimeout(toastTimer); clearTimeout(checkInTimer)
})
</script>

<template>
  <main ref="stage" class="scene">
    <canvas ref="canvas" @pointerup="onTap"></canvas>

    <div v-if="!seg && data.segments.length" class="center-card">
      <p>找不到這個路段</p>
      <button class="primary" @click="router.replace('/app/map')">回地圖</button>
    </div>

    <!-- 上方：小地圖、路名與進度、離開 -->
    <button v-show="!mapFull" class="minimap" aria-label="開啟地圖" @click="toggleMap">
      <svg viewBox="0 0 108 108">
        <circle cx="54" cy="54" r="54" fill="#eef4e6" />
        <rect :x="scene?.roadSide === -1 ? 24 : 66" y="0" width="18" height="108" fill="#c9ccd1" />
        <line :x1="scene?.roadSide === -1 ? 33 : 75" :x2="scene?.roadSide === -1 ? 33 : 75" y1="0" y2="108" stroke="#fff" stroke-width="1.5" stroke-dasharray="5 5" />
        <line x1="54" :y1="MINI.top" x2="54" :y2="MINI.bottom" :stroke="segColor" stroke-width="9" stroke-linecap="round" />
        <line x1="54" :y1="miniY(along)" x2="54" :y2="MINI.bottom" stroke="#2bb24c" stroke-width="9" stroke-linecap="round" />
        <text x="54" :y="MINI.bottom + 12" text-anchor="middle" font-size="9" font-weight="700" fill="#555">起</text>
        <text x="54" :y="MINI.top - 6" text-anchor="middle" font-size="9" font-weight="700" fill="#555">終</text>
        <g v-for="h in scene?.hotspots ?? []" :key="h.id">
          <circle :cx="scene?.roadSide === -1 ? 64 : 44" :cy="miniY(h.s)" r="5.5" :fill="answered.has(h.id) ? '#9CA3AF' : '#DC2626'" stroke="#fff" stroke-width="1.5" />
        </g>
      </svg>
      <img class="mini-frog" src="/frog/talk.png" alt="" :style="{ top: `${(miniY(along) / 108) * 100}%` }" />
    </button>
    <div v-show="mapFull" ref="mapEl" class="fullmap"></div>
    <button v-if="mapFull" class="map-back" @click="toggleMap"><img src="/frog/talk.png" alt="" />回到走路畫面</button>

    <header v-show="!mapFull" class="hud">
      <div class="title">
        <b>{{ scene?.title || seg?.road_name || '未命名道路' }}</b>
        <span>{{ Math.round(along) }} / {{ Math.round(length) }} m</span>
        <div class="bar"><i :style="{ width: `${progress * 100}%` }"></i></div>
      </div>
      <button class="x" aria-label="離開" @click="leave">×</button>
    </header>
    <div v-show="!mapFull" class="mode" :class="{ live }">
      <template v-if="live"><UiIcon name="pin" :size="13" /> 實地走訪・{{ geoStatus === 'tracking' && pos ? `定位精度 ${Math.round(pos.accuracy)} m` : '定位中…' }}</template>
      <template v-else>預覽：模擬定位自動前進・不會送出</template>
    </div>

    <!-- 青蛙說話：標注點、沿路詢問 -->
    <div v-if="!mapFull && !sheet && nearHotspot" class="bubble hot" @click="openSheet('hotspot', nearHotspot)">
      <img src="/frog/alert.png" alt="" />
      <div>
        <small>前方 {{ formatDistance(Math.max(0, nearHotspot.s - along)) }}</small>
        <b>{{ nearHotspot.title }}</b>
        <span>{{ nearHotspot.ask }}</span>
        <em>點這裡回答 ›</em>
      </div>
    </div>
    <div v-else-if="!mapFull && !sheet && checkIn" class="bubble">
      <img src="/frog/alert.png" alt="" />
      <div>
        <b>走到這裡，感覺安全嗎？</b>
        <div class="faces mini">
          <button v-for="f in FACES" :key="f.n" @click="quickFeel(f.n)"><SafetyFace :level="f.n" :size="28" /><small>{{ f.t }}</small></button>
        </div>
      </div>
      <button class="bx" aria-label="略過" @click.stop="checkIn = null">×</button>
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>


    <!-- 工具列 -->
    <nav v-show="!mapFull" class="tools">
      <button @click="openSheet('anomaly')"><UiIcon name="pin" :size="24" />標注異常</button>
      <button @click="photoInput?.click()"><UiIcon name="camera" :size="24" />拍照</button>
      <button class="main" @click="openSheet('feel')"><UiIcon name="chat" :size="24" />這裡的感受</button>
      <button @click="openSheet('finish')"><UiIcon name="flag" :size="24" />結束</button>
      <input ref="photoInput" type="file" accept="image/*" capture="environment" hidden @change="onCamera" />
    </nav>

    <!-- 面板 -->
    <div v-if="sheet" class="dim" @click="sheet = null"></div>
    <section v-if="sheet === 'feel' || sheet === 'hotspot'" class="sheet">
      <button class="close" aria-label="關閉" @click="sheet = null">×</button>
      <div v-if="activeHotspot" class="hs-head">
        <img src="/frog/alert.png" alt="" />
        <div>
          <h2>{{ activeHotspot.title }}</h2>
          <p class="muted">{{ activeHotspot.desc }}</p>
        </div>
      </div>
      <h3>{{ activeHotspot ? activeHotspot.ask : `走到 ${Math.round(along)} m 這裡，你覺得安全嗎？` }}</h3>
      <div class="faces">
        <button v-for="f in FACES" :key="f.n" :class="{ on: draft.safety === f.n }" @click="draft.safety = f.n"><SafetyFace :level="f.n" /><small>{{ f.t }}</small></button>
      </div>
      <div class="chips">
        <button v-for="t in TAGS" :key="t" :class="{ on: draft.tags.includes(t) }" @click="toggleTag(t)">{{ t }}</button>
      </div>
      <textarea v-model="draft.note" rows="2" maxlength="300" placeholder="想多說一點？（選填）"></textarea>
      <template v-if="activeHotspot">
        <label class="check"><input v-model="draft.alsoAnomaly" type="checkbox" /> 這裡確實有問題（列入異常回報）</label>
        <div class="photos">
          <img v-for="(p, i) in draft.previews" :key="i" :src="p" alt="" />
          <label v-if="draft.files.length < 3" class="add"><UiIcon name="camera" :size="26" /><input type="file" accept="image/*" capture="environment" hidden @change="addPhotos(($event.target as HTMLInputElement).files)" /></label>
        </div>
      </template>
      <button class="primary big" :disabled="!sheetReady" @click="submitSheet">記下來</button>
    </section>

    <section v-if="sheet === 'anomaly'" class="sheet">
      <button class="close" aria-label="關閉" @click="sheet = null">×</button>
      <h2>標注異常（{{ Math.round(along) }} m）</h2>
      <div class="chips">
        <button v-for="(label, k) in CATEGORIES" :key="k" :class="{ on: draft.category === k }" @click="draft.category = k">{{ label }}</button>
      </div>
      <div class="photos">
        <img v-for="(p, i) in draft.previews" :key="i" :src="p" alt="" />
        <label v-if="draft.files.length < 3" class="add"><UiIcon name="camera" :size="26" /><small>拍照</small><input type="file" accept="image/*" capture="environment" hidden @change="addPhotos(($event.target as HTMLInputElement).files)" /></label>
      </div>
      <textarea v-model="draft.note" rows="2" maxlength="500" placeholder="說明（選填）"></textarea>
      <button class="primary big" :disabled="!sheetReady" @click="submitSheet">標注</button>
    </section>

    <section v-if="sheet === 'finish'" class="sheet">
      <button v-if="!done" class="close" aria-label="關閉" @click="sheet = null">×</button>
      <template v-if="done">
        <div class="done"><img src="/frog/happy.png" alt="" /><h2>已送出，謝謝你！</h2><p class="muted">研究團隊複查後，結果會顯示在「紀錄」。</p></div>
        <button class="primary big" @click="router.replace('/app/map')">回地圖找下一段</button>
      </template>
      <template v-else>
        <h2>{{ along >= length - 1.5 ? '這段走完了！' : '結束這段' }}</h2>
        <p class="muted">沿路記下 {{ moments.length }} 個感受、{{ anomalies.length }} 個異常</p>
        <div class="scale">
          <b>整段走起來的安全感</b>
          <div class="opts"><button v-for="n in 5" :key="n" :class="{ on: fin.safety === n }" @click="fin.safety = n">{{ n }}<small>{{ SCALE[n - 1] }}</small></button></div>
        </div>
        <div class="scale">
          <b>舒適度</b>
          <div class="opts"><button v-for="n in 5" :key="n" :class="{ on: fin.comfort === n }" @click="fin.comfort = n">{{ n }}<small>{{ SCALE[n - 1] }}</small></button></div>
        </div>
        <textarea v-model="fin.comment" rows="3" maxlength="1000" placeholder="整段路的感受（選填）"></textarea>
        <p v-if="submitError" class="err">{{ submitError }}</p>
        <template v-if="live">
          <button class="primary big" :disabled="!fin.safety || !fin.comfort || submitting" @click="submit">{{ submitting ? '送出中…' : '送出' }}</button>
        </template>
        <template v-else>
          <p class="note">示範模式不會送出。到現場在地圖上按「開始走這段」，就會用定位實地走訪。</p>
          <button class="big" @click="restartDemo">重新走一次</button>
        </template>
      </template>
    </section>
  </main>
</template>

<style scoped>
.scene { position: fixed; inset: 0; overflow: hidden; background: #d6eefa; touch-action: none; user-select: none; -webkit-user-select: none; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.center-card { position: absolute; inset: 40% 24px auto; background: #fff; border-radius: 14px; padding: 16px; text-align: center; z-index: 30; }

.minimap { position: absolute; z-index: 20; top: calc(12px + env(safe-area-inset-top)); left: 12px; width: 108px; height: 108px; border-radius: 50%; padding: 0;
  border: 4px solid #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, .3); overflow: hidden; cursor: pointer; background: #eef4e6; box-sizing: content-box; }
.minimap svg { display: block; width: 100%; height: 100%; }
.mini-frog { position: absolute; left: 50%; width: 30px; height: 30px; object-fit: contain; transform: translate(-50%, -50%); filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .4)); pointer-events: none; }
.fullmap { position: absolute; inset: 0; z-index: 20; background: #e8eef2; }
.fullmap :deep(.frog-pin img) { width: 40px; height: 40px; object-fit: contain; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .5)); }
.fullmap :deep(.end-tag) { background: #1e3a8a; color: #fff; font-size: 12px; font-weight: 700; border-radius: 11px; text-align: center; line-height: 22px; box-shadow: 0 1px 4px rgba(0, 0, 0, .3); }
.map-back img { width: 26px; height: 26px; object-fit: contain; vertical-align: middle; margin-right: 6px; }
.map-back { position: absolute; z-index: 25; left: 50%; transform: translateX(-50%); bottom: calc(24px + env(safe-area-inset-bottom)); padding: 12px 20px; border-radius: 24px;
  border: 0; background: var(--primary, #1e3a8a); color: #fff; font-size: 16px; font-weight: 700; box-shadow: 0 2px 10px rgba(0, 0, 0, .3); }

.hud { position: absolute; z-index: 15; top: calc(12px + env(safe-area-inset-top)); left: 132px; right: 12px; display: flex; gap: 8px; align-items: flex-start; }
.title b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.title { flex: 1; min-width: 0; background: rgba(255, 255, 255, .92); border-radius: 12px; padding: 8px 10px; box-shadow: 0 1px 6px rgba(0, 0, 0, .15); display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; font-size: 14px; }
.title span { color: #555; font-variant-numeric: tabular-nums; }
.bar { grid-column: 1 / -1; height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; }
.bar i { display: block; height: 100%; background: #2bb24c; }
.x { width: 38px; height: 38px; border-radius: 50%; border: 0; background: rgba(255, 255, 255, .92); font-size: 22px; line-height: 1; padding: 0; box-shadow: 0 1px 6px rgba(0, 0, 0, .15); }
.mode { position: absolute; z-index: 15; top: calc(78px + env(safe-area-inset-top)); left: 132px; font-size: 12px; background: rgba(30, 58, 138, .85); color: #fff; padding: 3px 9px; border-radius: 10px; }
.mode.live { background: rgba(23, 105, 47, .88); }

.bubble { position: absolute; z-index: 18; left: 12px; right: 12px; top: calc(136px + env(safe-area-inset-top)); display: flex; gap: 10px; align-items: center; background: #fff;
  border-radius: 16px; padding: 10px 12px; box-shadow: 0 3px 14px rgba(0, 0, 0, .25); animation: pop .25s ease; }
.bubble.hot { border: 3px solid #e5322d; cursor: pointer; }
.bubble img { width: 48px; height: 72px; object-fit: contain; flex: none; }
.bubble > div { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
.bubble small { color: #e5322d; font-weight: 700; }
.bubble em { color: #e5322d; font-style: normal; font-weight: 700; }
.bx { position: absolute; top: 4px; right: 6px; border: 0; background: none; font-size: 20px; color: #888; padding: 2px 6px; }
@keyframes pop { from { transform: scale(.9); opacity: 0; } }

.toast { position: absolute; z-index: 40; left: 50%; top: 46%; transform: translateX(-50%); background: rgba(20, 20, 20, .82); color: #fff; padding: 10px 16px; border-radius: 20px; font-size: 15px; white-space: nowrap; }


.tools { position: absolute; z-index: 17; left: 10px; right: 10px; bottom: calc(10px + env(safe-area-inset-bottom)); display: grid; grid-template-columns: 1fr 1fr 1.35fr 1fr; gap: 6px;
  background: rgba(255, 255, 255, .95); border-radius: 18px; padding: 6px; box-shadow: 0 3px 14px rgba(0, 0, 0, .25); }
.tools button { border: 0; background: none; border-radius: 12px; padding: 6px 2px; font-size: 12px; font-weight: 600; color: #333; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.tools button svg { margin-bottom: 1px; }
.tools button.main { background: #1e3a8a; color: #fff; }

.dim { position: absolute; inset: 0; z-index: 50; background: rgba(0, 0, 0, .25); }
.sheet { position: absolute; z-index: 60; left: 0; right: 0; bottom: 0; max-height: 82%; overflow-y: auto; background: #fff; border-radius: 20px 20px 0 0; padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
  display: flex; flex-direction: column; gap: 10px; box-shadow: 0 -3px 16px rgba(0, 0, 0, .25); animation: up .22s ease; }
@keyframes up { from { transform: translateY(40px); opacity: 0; } }
@media (min-width: 720px) { .sheet { left: auto; right: 16px; bottom: 16px; width: 400px; border-radius: 20px; } }
.sheet h2 { font-size: 19px; margin: 0; padding-right: 36px; }
.sheet h3 { font-size: 16px; margin: 0; }
.sheet p { margin: 0; }
.close { position: absolute; top: 12px; right: 12px; width: 32px; height: 32px; border-radius: 50%; border: 0; background: #f1f1f1; font-size: 20px; line-height: 1; padding: 0; }
.hs-head { display: flex; gap: 10px; align-items: flex-start; }
.hs-head img { width: 56px; height: 84px; object-fit: contain; flex: none; }
.hs-head h2 { padding-right: 30px; }
.faces { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.faces button { border: 2px solid #e5e7eb; background: #fff; border-radius: 12px; padding: 6px 0; display: flex; flex-direction: column; align-items: center; }
.faces button svg { margin-bottom: 2px; }
.faces button small { font-size: 11px; color: #555; }
.faces button.on { border-color: #1e3a8a; background: #eef2ff; }
.faces.mini { gap: 4px; margin-top: 4px; }
.faces.mini button { padding: 3px 0; border-width: 1px; }
.faces.mini button small { font-size: 10px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips button { border: 1px solid #d1d5db; background: #fff; border-radius: 16px; padding: 6px 11px; font-size: 13px; }
.chips button.on { background: #1e3a8a; color: #fff; border-color: #1e3a8a; }
textarea { width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 15px; }
.check { display: flex; gap: 8px; align-items: center; font-size: 14px; }
.photos { display: flex; gap: 8px; flex-wrap: wrap; }
.photos img, .photos .add { width: 68px; height: 68px; border-radius: 10px; object-fit: cover; }
.photos .add { gap: 2px; border: 2px dashed #c7cdd6; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 22px; color: #666; cursor: pointer; }
.photos .add small { font-size: 11px; }
.big { padding: 14px; font-size: 17px; font-weight: 700; border-radius: 12px; }
.scale { display: flex; flex-direction: column; gap: 6px; }
.opts { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.opts button { border: 2px solid #e5e7eb; background: #fff; border-radius: 10px; padding: 6px 0; font-size: 17px; font-weight: 700; display: flex; flex-direction: column; align-items: center; }
.opts button small { font-size: 11px; font-weight: 400; color: #555; }
.opts button.on { border-color: #1e3a8a; background: #eef2ff; }
.note { background: #fff4d6; color: #8a5a00; border-radius: 10px; padding: 10px 12px; font-size: 14px; }
.err { color: #c0262d; }
.done { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.done img { width: 120px; }
</style>
