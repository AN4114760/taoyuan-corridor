<script setup lang="ts">
// 志工：全螢幕地圖 → 點路段看資訊 → 在路段 50m 內才能「開始走這段」→ 走訪頁填回饋
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import CorridorMap from '@/components/CorridorMap.vue'
import { distanceToSegment } from '@/lib/geo'
import { formatDistance, GEO_MESSAGE, useGeo, walkingUrl } from '@/lib/geolocation'
import { SITE_ID, useData } from '@/stores/data'
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
  router.push(`/app/walk/${encodeURIComponent(seg.value.id)}`)
}
</script>

<template>
  <div class="map-tab">
    <p v-if="loadError" class="err pad">{{ loadError }}</p>
    <CorridorMap v-else-if="data.segments.length" ref="map" :segments="data.segments" :features="data.features" :site-id="SITE_ID"
      :selected-id="selectedId" :user-pos="pos" @select-segment="select" />

    <div class="top">
      <div v-if="walking" class="chip-card walking" @click="router.push(`/app/walk/${encodeURIComponent(walking.id)}`)">
        🚶 正在走：<b>{{ walking.road_name || '未命名道路' }}</b>　繼續填寫 ›
      </div>
      <div v-else class="chip-card">點地圖上的路段，選一段去走</div>
      <div v-if="GEO_MESSAGE[status]" class="chip-card warn">
        {{ GEO_MESSAGE[status] }}
        <button v-if="status === 'denied' || status === 'unavailable'" @click="retry">重試</button>
      </div>
    </div>

    <div class="fabs">
      <button class="fab" aria-label="建議路段清單" @click="showList = !showList; selectedId = null">☰</button>
      <button class="fab" aria-label="移到我的位置" @click="centerOnMe">◎</button>
    </div>

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
        <template v-else-if="canStart">✓ 你在路段附近（{{ formatDistance(dist) }}），可以開始</template>
        <template v-else>距離這段路 {{ formatDistance(dist) }}，需在 {{ WALK_START_RADIUS_M }} m 內才能開始</template>
        <small v-if="pos" class="muted block">定位精度約 {{ Math.round(pos.accuracy) }} m</small>
      </div>
      <div class="actions">
        <a class="btn" :href="walkingUrl(seg.centroid, pos)" target="_blank" rel="noreferrer">導航前往</a>
        <button class="primary" :disabled="!canStart" @click="start">開始走這段</button>
      </div>
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
.fabs { position: absolute; z-index: 1000; top: calc(10px + env(safe-area-inset-top)); right: 10px; display: flex; flex-direction: column; gap: 8px; }
.fab { width: 46px; height: 46px; border-radius: 50%; border: 0; background: var(--card); box-shadow: 0 1px 6px rgba(0, 0, 0, .25); font-size: 20px; padding: 0; }
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
</style>
