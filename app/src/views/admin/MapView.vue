<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import CorridorMap, { type Overlay } from '@/components/CorridorMap.vue'
import { SITE_ID, useData } from '@/stores/data'
import {
  CATEGORIES, FEEDBACK_STATUS, GRADE_COLOR, GRADE_LABEL, type Grade, LEVEL_COLOR, LEVEL_LABEL, type Level,
} from '@/types'

const data = useData()
const route = useRoute()
const router = useRouter()
const map = ref<InstanceType<typeof CorridorMap>>()

const colorBy = ref<'level' | 'grade'>(data.integrated ? 'grade' : 'level')
const stopAuto = watch(() => data.integrated, (v) => { if (v) { colorBy.value = 'grade'; stopAuto() } })
const selectedId = ref<string | null>((route.query.seg as string) ?? null)
const seg = computed(() => (selectedId.value ? data.segmentById.get(selectedId.value) ?? null : null))
const it = computed(() => (selectedId.value ? data.integrated?.get(selectedId.value) ?? null : null))

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const label = (k: string) => (CATEGORIES as Record<string, string>)[k] ?? k
const STATUS_COLOR = { new: '#2563eb', confirmed: '#b91c1c', rejected: '#9ca3af' }

const overlays = computed<Overlay[]>(() => [
  {
    key: 'feedback', name: '志工回饋', color: '#2563eb',
    points: data.feedback.map((f) => ({
      id: f.id, lat: f.lat, lng: f.lng, color: STATUS_COLOR[f.status],
      popup: `<b>${esc(FEEDBACK_STATUS[f.status])}</b>｜安全感 ${f.safety}・舒適度 ${f.comfort}<br>`
        + `${f.anomalies.map((a) => esc(label(a.category))).join('、') || '無異狀'}`
        + `${f.comment ? `<br><span style="color:#666">${esc(f.comment)}</span>` : ''}`,
    })),
  },
  {
    key: 'm2', name: '模組二偵測', color: '#7c3aed', visible: false,
    points: data.drive.map((d, i) => ({
      id: String(i), lat: d.lat, lng: d.lng, color: d.label in CATEGORIES ? '#7c3aed' : '#c4b5fd',
      popup: `<b>${esc(label(d.label))}</b>（信心 ${d.confidence}）<br>${esc(d.sessionId)}・${esc(d.model)}`,
    })),
  },
])

const counts = computed(() => {
  const id = selectedId.value
  return {
    feedback: data.feedback.filter((f) => f.segId === id && f.status !== 'rejected').length,
    walks: data.walks.filter((w) => w.segId === id).length,
    drive: data.drive.filter((d) => d.segId === id).length,
  }
})

function select(id: string | null) {
  selectedId.value = id
  router.replace({ query: id ? { seg: id } : {} })
}
function focus() {
  if (seg.value) map.value?.flyTo(seg.value.centroid.lat, seg.value.centroid.lng, 18)
}
onMounted(() => nextTick(focus))
watch(() => route.query.seg, (v) => { if (v && v !== selectedId.value) { selectedId.value = v as string; focus() } })

const levelLegend = (['severe', 'caution', 'good', 'missing'] as Level[]).map((k) => ({ color: LEVEL_COLOR[k], label: LEVEL_LABEL[k] }))
const gradeLegend = (['D', 'C', 'B', 'A'] as Grade[]).map((k) => ({ color: GRADE_COLOR[k], label: GRADE_LABEL[k] }))
const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`)
</script>

<template>
  <div class="wrap">
    <CorridorMap ref="map" :segments="data.gradedSegments" :features="data.features" :color-by="colorBy" :overlays="overlays"
      :selected-id="selectedId" :site-id="SITE_ID" @select-segment="select" />

    <div class="panel tools card">
      <div class="seg-toggle">
        <button :class="{ on: colorBy === 'level' }" @click="colorBy = 'level'">模組一等級</button>
        <button :class="{ on: colorBy === 'grade' }" :disabled="!data.integrated" title="需先在「需改善路段」按重新計算"
          @click="colorBy = 'grade'">A–D 綜合評級</button>
      </div>
      <div class="legend">
        <span v-for="l in colorBy === 'level' ? levelLegend : gradeLegend" :key="l.label">
          <i :style="{ background: l.color }"></i>{{ l.label }}
        </span>
      </div>
      <div class="legend muted">
        <span><i class="dot" style="background: #2563eb"></i>回饋待審</span>
        <span><i class="dot" style="background: #b91c1c"></i>已確認</span>
        <span><i class="dot" style="background: #9ca3af"></i>不成立</span>
      </div>
    </div>

    <div v-if="seg" class="panel info card">
      <div class="row">
        <span v-if="it" class="grade" :class="it.grade">{{ it.grade }}</span>
        <h3 class="grow">{{ seg.road_name || '未命名道路' }}</h3>
        <button @click="select(null)" aria-label="關閉">×</button>
      </div>
      <p class="muted">{{ seg.id }}<template v-if="seg.from || seg.to">｜{{ seg.from || '?' }} → {{ seg.to || '?' }}</template></p>
      <table>
        <tbody>
          <tr><th>模組一</th><td><span class="lvl" :style="{ background: LEVEL_COLOR[seg.level] }"></span>{{ LEVEL_LABEL[seg.level] }}｜{{ seg.label }}</td></tr>
          <tr v-if="seg.kind === 'sidewalk'"><th>寬度／淨寬</th><td>{{ seg.width_m ?? '–' }} m／{{ seg.net_width_m ?? '–' }} m・斜坡 {{ seg.ramps ?? '–' }}</td></tr>
          <tr v-if="seg.kind === 'sidewalk'"><th>綠蔽交集率</th><td>{{ pct(seg.canopy_overlap_ratio) }}</td></tr>
          <tr><th>資料</th><td>志工回饋 {{ counts.feedback }}・模組三 {{ counts.walks }}・模組二 {{ counts.drive }}</td></tr>
          <template v-if="it">
            <tr><th>安全感平均</th><td>{{ it.safety_mean ?? '–' }}</td></tr>
            <tr><th>綜合分數</th><td><b>{{ +it.composite_score.toFixed(2) }}</b>（模組一 {{ it.components.m1 }}＋異狀 {{ it.components.anomalies }}＋模組二 {{ it.components.m2 }}＋安全感 {{ it.components.safety }}）</td></tr>
          </template>
        </tbody>
      </table>
      <RouterLink :to="{ path: '/admin/voices', query: { seg: seg.id } }">看這段的志工回饋 →</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; height: 100%; }
.panel { position: absolute; z-index: 500; box-shadow: 0 2px 10px rgba(0, 0, 0, .12); }
.tools { top: 12px; left: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.seg-toggle { display: flex; }
.seg-toggle button { border-radius: 0; }
.seg-toggle button:first-child { border-radius: 8px 0 0 8px; }
.seg-toggle button:last-child { border-radius: 0 8px 8px 0; border-left: 0; }
.seg-toggle button.on { background: var(--primary); border-color: var(--primary); color: #fff; }
.legend { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; }
.legend i { display: inline-block; width: 18px; height: 6px; border-radius: 3px; margin-right: 4px; vertical-align: 2px; outline: 1.5px solid #2b2b2b; }
.legend i.dot { width: 10px; height: 10px; border-radius: 5px; outline: 0; border: 1.5px solid #fff; box-shadow: 0 0 0 1px #94a3b8; vertical-align: -1px; }
.info { bottom: 12px; left: 12px; width: min(380px, calc(100% - 24px)); max-height: 60%; overflow: auto; display: flex; flex-direction: column; gap: 4px; }
.info p { margin: 0; }
.info th { width: 84px; }
.info td, .info th { padding: 4px 6px; font-size: 13px; }
.info button { padding: 0 8px; }
</style>
