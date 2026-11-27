<script setup lang="ts">
// 志工：全螢幕地圖 → 點路段看資訊 → 在路段 50m 內才能「開始走這段」→ 走訪頁填回饋
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import CorridorMap from '@/components/CorridorMap.vue'
import UiIcon from '@/components/UiIcon.vue'
import { distanceToSegment } from '@/lib/geo'
import { formatDistance, GEO_MESSAGE, useGeo, walkingUrl } from '@/lib/geolocation'
import { SITE_ID, useData } from '@/stores/data'
import { TEAM_SEGMENTS } from '@/lib/scene/config'
import { useWalk, WALK_START_RADIUS_M } from '@/stores/walk'
import { LEVEL_COLOR, LEVEL_LABEL, type Segment } from '@/types'

const data = useData()
const walk = useWalk()
const router = useRouter()
const { status, pos, retry } = useGeo()
const map = ref<InstanceType<typeof CorridorMap>>()
const loadError = ref<string | null>(null)
onMounted(() => data.loadPublic().catch((e) => { loadError.value = e.message }))

const selectedId = ref<string | null>(null)
const showList = ref(false)
const seg = computed(() => (selectedId.value ? data.segmentById.get(selectedId.value) ?? null : null))
const distTo = (s: Segment) => (pos.value ? distanceToSegment(pos.value.lat, pos.value.lng, s) : null)
const dist = computed(() => (seg.value ? distTo(seg.value) : null))
const canStart = computed(() => dist.value != null && dist.value <= WALK_START_RADIUS_M)
const walking = computed(() => (walk.current ? data.segmentById.get(walk.current.segId) ?? null : null))

// 建議優先走訪：模組一判為嚴重／需注意，有定位時由近到遠
const priority = computed(() => data.segments
  .filter((s) => s.level === 'severe' || s.level === 'caution')
  .map((s) => ({ s, d: distTo(s) }))
  .sort((a, b) => (a.d != null && b.d != null ? a.d - b.d : Number(b.s.level === 'severe') - Number(a.s.level === 'severe'))))

// ---- 青蛙任務按鈕：走到一半 → 繼續；在任務路段 50m 內 → 直接開始；否則帶你看最近的任務 ----
// 任務 = 有團隊標注點的路段＋模組一判為嚴重／需注意的人行道
const tasks = computed(() => data.segments.filter((s) => TEAM_SEGMENTS.includes(s.id) || (s.kind === 'sidewalk' && (s.level === 'severe' || s.level === 'caution'))))
const taskMsg = ref('')
let taskTimer = 0
function say(m: string) {
  taskMsg.value = m
  clearTimeout(taskTimer)
  taskTimer = window.setTimeout(() => { taskMsg.value = '' }, 4000)
}
function goTask() {
  if (walk.current) return router.push(`/app/scene/${encodeURIComponent(walk.current.segId)}`)
  if (!pos.value) { retry(); return say('正在取得你的位置，請稍候再按一次') }
  const ranked = tasks.value.map((s) => ({ s, d: distTo(s)! })).sort((a, b) => a.d - b.d
    || Number(TEAM_SEGMENTS.includes(b.s.id)) - Number(TEAM_SEGMENTS.includes(a.s.id)))
  const near = ranked[0]
  if (!near) return say('目前沒有任務')
  select(near.s.id)
  if (near.d <= WALK_START_RADIUS_M) return start()
  map.value?.flyTo(near.s.centroid.lat, near.s.centroid.lng)
  say(`最近的任務：${near.s.road_name || '未命名道路'}，距離 ${formatDistance(near.d)}`)
}

function select(id: string | null) {
  selectedId.value = id
  if (id) showList.value = false
}
function pick(s: Segment) {
  select(s.id)
  map.value?.flyTo(s.centroid.lat, s.centroid.lng)
}
function centerOnMe() {
  if (pos.value) map.value?.flyTo(pos.value.lat, pos.value.lng)
  else retry()
}

function start() {
  if (!seg.value || !pos.value || !canStart.value) return
  walk.start({
    segId: seg.value.id, startedAt: new Date().toISOString(), startLat: pos.value.lat, startLng: pos.value.lng,
    startDistanceM: dist.value!, startAccuracyM: pos.value.accuracy,
  })
  router.push(`/app/scene/${encodeURIComponent(seg.value.id)}`)
}
</script>

<template>
  <div class="map-tab">
    <p v-if="loadError" class="err pad">{{ loadError }}</p>
    <CorridorMap v-else-if="data.segments.length" ref="map" :segments="data.segments" :features="data.features" :site-id="SITE_ID"
      :selected-id="selectedId" :user-pos="pos" @select-segment="select" />

    <div class="top">
      <div v-if="walking" class="chip-card walking" @click="router.push(`/app/scene/${encodeURIComponent(walking.id)}`)">
        <img class="chip-frog" src="/frog/talk.png" alt="" />正在走：<b>{{ walking.road_name || '未命名道路' }}</b>　繼續 ›
      </div>
      <div v-else class="chip-card">點地圖上的路段，選一段去走</div>
      <div v-if="GEO_MESSAGE[status]" class="chip-card warn">
        {{ GEO_MESSAGE[status] }}
        <button v-if="status === 'denied' || status === 'unavailable'" @click="retry">重試</button>
      </div>
    </div>

    <div class="fabs">
      <button class="fab" aria-label="建議路段清單" @click="showList = !showList; selectedId = null"><UiIcon name="menu" /></button>
      <button class="fab" aria-label="移到我的位置" @click="centerOnMe">◎</button>
    </div>

    <button v-if="!seg && !showList" class="frog-task" :class="{ walking: !!walking }" aria-label="前往任務" @click="goTask">
      <img class="ring" src="/frog/task-ring.png" alt="" />
      <img class="frog" src="/frog/task-frog.png" alt="" />
      <span v-if="walking" class="badge">繼續</span>
    </button>
    <div v-if="taskMsg && !seg" class="task-msg">{{ taskMsg }}</div>

    <section v-if="seg" class="sheet">
      <button class="close" aria-label="關閉" @click="selectedId = null">×</button>
      <div class="row head">
        <span class="pill" :style="{ background: LEVEL_COLOR[seg.level] }">{{ LEVEL_LABEL[seg.level] }}</span>
        <h2>{{ seg.road_name || '未命名道路' }}</h2>
      </div>
      <p v-if="seg.from || seg.to" class="muted">{{ seg.from || '?' }} → {{ seg.to || '?' }}</p>
      <p>{{ seg.label }}</p>
      <p v-if="seg.kind === 'sidewalk'" class="muted">寬 {{ seg.width_m ?? '–' }} m・淨寬 {{ seg.net_width_m ?? '–' }} m・斜坡 {{ seg.ramps ?? '–' }} 處</p>

      <div class="dist" :class="{ ok: canStart }">
        <template v-if="dist == null">尚未取得你的位置</template>
        <template v-else-if="canStart"><UiIcon name="check" :size="16" /> 你在路段附近（{{ formatDistance(dist) }}），可以開始</template>
        <template v-else>距離這段路 {{ formatDistance(dist) }}，需在 {{ WALK_START_RADIUS_M }} m 內才能開始</template>
        <small v-if="pos" class="muted block">定位精度約 {{ Math.round(pos.accuracy) }} m</small>
      </div>
      <div class="actions">
        <a class="btn" :href="walkingUrl(seg.centroid, pos)" target="_blank" rel="noreferrer">導航前往</a>
        <button class="primary" :disabled="!canStart" @click="start">開始走這段</button>
      </div>
      <button v-if="seg.kind === 'sidewalk'" class="preview" @click="router.push(`/app/scene/${encodeURIComponent(seg.id)}?demo=1`)">預覽走路畫面（示範，不需在現場）</button>
    </section>

    <section v-if="showList" class="sheet list">
      <button class="close" aria-label="關閉" @click="showList = false">×</button>
      <h2>建議優先走訪（{{ priority.length }} 段）</h2>
      <p class="muted">模組一判為嚴重或需注意的路段{{ pos ? '，由近到遠' : '' }}</p>
      <ul>
        <li v-for="{ s, d } in priority" :key="s.id" @click="pick(s)">
          <span class="lvl" :style="{ background: LEVEL_COLOR[s.level] }"></span>
          <span class="grow"><b>{{ s.road_name || '未命名道路' }}</b><small class="muted block">{{ s.label }}</small></span>
          <span v-if="d != null" class="muted nowrap">{{ formatDistance(d) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.map-tab { position: absolute; inset: 0; }
.pad { padding: 16px; }
.top { position: absolute; z-index: 1000; top: calc(10px + env(safe-area-inset-top)); left: 10px; right: 64px; display: flex; flex-direction: column; gap: 6px; }
.chip-card { background: var(--card); border-radius: 12px; padding: 8px 12px; box-shadow: 0 1px 6px rgba(0, 0, 0, .18); font-size: 14px; }
.chip-card.walking { background: var(--primary); color: #fff; cursor: pointer; }
.chip-card.warn { background: #fff4d6; color: #8a5a00; font-size: 13px; display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.fabs { position: absolute; z-index: 1000; top: calc(64px + env(safe-area-inset-top)); right: 10px; display: flex; flex-direction: column; gap: 8px; }
.fab { display: flex; align-items: center; justify-content: center; color: #22292F; width: 46px; height: 46px; border-radius: 50%; border: 0; background: var(--card); box-shadow: 0 1px 6px rgba(0, 0, 0, .25); font-size: 20px; padding: 0; }
.sheet { position: absolute; z-index: 1100; left: 0; right: 0; bottom: 0; max-height: 70%; overflow-y: auto; background: var(--card); border-radius: 18px 18px 0 0; box-shadow: 0 -2px 14px rgba(0, 0, 0, .2); padding: 16px 16px 18px; display: flex; flex-direction: column; gap: 8px; }
@media (min-width: 720px) { .sheet { left: auto; right: 12px; bottom: 12px; width: 380px; border-radius: 18px; } }
.sheet p { margin: 0; }
.close { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 50%; border: 0; background: #f1f1f1; font-size: 20px; line-height: 1; padding: 0; }
.head { padding-right: 36px; flex-wrap: nowrap; }
.head h2 { font-size: 19px; }
.pill { color: #fff; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 10px; white-space: nowrap; text-shadow: 0 0 2px rgba(0, 0, 0, .35); }
.dist { border-radius: 10px; padding: 10px 12px; background: #f3f4f6; font-weight: 600; }
.dist.ok { background: #e3f6e8; color: #17692f; }
.block { display: block; font-weight: 400; }
.actions { display: flex; gap: 8px; }
.actions > * { flex: 1; padding: 12px; font-size: 16px; text-align: center; border-radius: 10px; }
.btn { border: 1px solid var(--line); text-decoration: none; color: var(--text); }
.list ul { list-style: none; margin: 0; padding: 0; }
.list li { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--line); cursor: pointer; }
.nowrap { white-space: nowrap; }
/* 地圖右上角的圖層按鈕避開手機狀態列 */
.map-tab :deep(.leaflet-top) { top: env(safe-area-inset-top); }
/* 任務按鈕：底圖（綠底＋白圈＋橘色虛線）固定 1:1 正圓，青蛙疊在上面、頭超出圓外 */
.frog-task { position: absolute; z-index: 1050; left: 50%; bottom: 30px; transform: translateX(-50%); width: 92px; height: 92px; padding: 0; border: 0; background: none;
  cursor: pointer; animation: frog-bob 2.4s ease-in-out infinite; filter: drop-shadow(0 3px 6px rgba(0, 0, 0, .3)); }
.frog-task .ring { position: absolute; inset: 0; width: 100%; height: 100%; aspect-ratio: 1 / 1; }
.frog-task .frog { position: absolute; left: 50%; bottom: 6%; height: 118%; transform: translateX(-50%); }
.chip-frog { width: 20px; height: 20px; object-fit: contain; vertical-align: -4px; margin-right: 4px; }
.frog-task .badge { position: absolute; top: 4px; right: -12px; background: #DC2626; color: #fff; font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 10px; border: 2px solid #fff; }
@keyframes frog-bob { 50% { transform: translateX(-50%) translateY(-4px); } }
.task-msg { position: absolute; z-index: 1050; left: 50%; bottom: 150px; transform: translateX(-50%); background: rgba(20, 20, 20, .85); color: #fff; padding: 8px 14px; border-radius: 18px; font-size: 14px; white-space: nowrap; max-width: calc(100% - 32px); overflow: hidden; text-overflow: ellipsis; }
.preview { border: 0; background: #eef2ff; color: #1e3a8a; border-radius: 10px; padding: 10px; font-size: 14px; font-weight: 600; }
</style>
