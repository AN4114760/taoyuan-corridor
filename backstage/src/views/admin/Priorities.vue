<script setup lang="ts">
// 需改善路段：模組四綜合評級（module4/integrate.py），分數由高到低
import { computed, ref } from 'vue'

import { prioritiesCsvUrl } from '@/lib/api'
import { useData } from '@/stores/data'
import { GRADE_LABEL, type Grade, type Integrated, LEVEL_COLOR, LEVEL_LABEL, type Segment } from '@/types'

const data = useData()
const show = ref<'CD' | 'BCD' | 'all'>('CD')
const busy = ref(false)
const msg = ref<string | null>(null)
const err = ref<string | null>(null)

const rows = computed(() => {
  if (!data.integrated) return []
  const keep: Record<typeof show.value, Grade[]> = { CD: ['C', 'D'], BCD: ['B', 'C', 'D'], all: ['A', 'B', 'C', 'D'] }
  return data.segments
    .map((seg) => ({ seg, it: data.integrated!.get(seg.id) }))
    .filter((r): r is { seg: Segment; it: Integrated } => !!r.it && keep[show.value].includes(r.it.grade))
    .sort((a, b) => b.it.composite_score - a.it.composite_score || a.seg.id.localeCompare(b.seg.id))
})
const meta = computed(() => data.integratedMeta as { integrated_at?: string; grade_counts?: Record<Grade, number> } | null)
// 時間要轉成數字比較：Python 寫 +00:00、JS 寫 Z，字串比較會錯
const lastReview = computed(() => Math.max(0, ...data.feedback.map((f) => (f.reviewedAt ? Date.parse(f.reviewedAt) : 0))))
const stale = computed(() => !!meta.value?.integrated_at && lastReview.value > Date.parse(meta.value.integrated_at))

async function recompute() {
  busy.value = true
  msg.value = err.value = null
  try { msg.value = await data.recompute() } catch (e) { err.value = (e as Error).message } finally { busy.value = false }
}

const PARTS = [
  { k: 'm1', label: '模組一', color: '#64748b' },
  { k: 'anomalies', label: '已確認異狀', color: '#e5322d' },
  { k: 'm2', label: '模組二', color: '#7c3aed' },
  { k: 'safety', label: '安全感', color: '#f08a24' },
] as const
const MAX = 9 // 各項上限加總 2+3+2+2
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' }) : '–')
</script>

<template>
  <div class="page">
    <div class="card head">
      <div class="grow">
        <h2>需改善路段</h2>
        <p class="muted">
          最後計算：{{ fmt(meta?.integrated_at) }}
          <template v-if="meta?.grade_counts">｜D {{ meta.grade_counts.D }}・C {{ meta.grade_counts.C }}・B {{ meta.grade_counts.B }}・A {{ meta.grade_counts.A }}</template>
        </p>
        <p v-if="stale" class="err">計算之後又有審核變動，請重新計算。</p>
        <p v-if="msg" class="muted">{{ msg }}</p>
        <p v-if="err" class="err">{{ err }}</p>
      </div>
      <select v-model="show">
        <option value="CD">C、D（待改善、優先改善）</option>
        <option value="BCD">B–D</option>
        <option value="all">全部路段</option>
      </select>
      <button class="primary" :disabled="busy" @click="recompute">{{ busy ? '計算中…' : '重新計算' }}</button>
      <a v-if="data.integrated" :href="prioritiesCsvUrl()" download><button>匯出 CSV</button></a>
    </div>

    <p v-if="!data.integrated" class="card">還沒有計算結果，請按「重新計算」。</p>

    <template v-else>
      <div class="legend muted">
        分數組成：<span v-for="p in PARTS" :key="p.k"><i :style="{ background: p.color }"></i>{{ p.label }}</span>
        ｜等級：A &lt; 1、B 1–2、C 2–3.5、D ≥ 3.5（權重在 config.yaml）
      </div>
      <table class="card">
        <thead><tr><th>#</th><th>等級</th><th>分數</th><th>道路</th><th>模組一</th><th class="wide">分數組成</th><th>資料</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="r.seg.id">
            <td class="muted">{{ i + 1 }}</td>
            <td><span class="grade" :class="r.it.grade" :title="GRADE_LABEL[r.it.grade]">{{ r.it.grade }}</span></td>
            <td><b>{{ +r.it.composite_score.toFixed(2) }}</b></td>
            <td><b>{{ r.seg.road_name || '未命名道路' }}</b>
              <div class="muted">{{ r.seg.kind === 'missing' ? `${r.seg.side === 'left' ? '左' : '右'}側無人行道・${r.seg.id.split('-').pop()}` : `${r.seg.from || '?'} → ${r.seg.to || '?'}` }}</div></td>
            <td><span class="lvl" :style="{ background: LEVEL_COLOR[r.seg.level] }"></span>{{ LEVEL_LABEL[r.seg.level] }}
              <div class="muted">{{ r.seg.kind === 'sidewalk' ? r.seg.label : '' }}</div></td>
            <td>
              <div class="stack">
                <div v-for="p in PARTS" :key="p.k" :style="{ width: `${(r.it.components[p.k] / MAX) * 100}%`, background: p.color }"
                  :title="`${p.label} ${r.it.components[p.k]}`"></div>
              </div>
              <div class="muted small">
                <template v-for="p in PARTS" :key="p.k"><span v-if="r.it.components[p.k]">{{ p.label }} {{ r.it.components[p.k] }}　</span></template>
              </div>
            </td>
            <td class="muted small">確認異狀 {{ r.it.counts.confirmed_anomalies }}<br>模組二 {{ r.it.counts.m2_detections }}<br>評分 {{ r.it.counts.ratings }}（平均 {{ r.it.safety_mean ?? '–' }}）</td>
            <td><RouterLink :to="{ path: '/admin/map', query: { seg: r.seg.id } }">地圖</RouterLink></td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.page { padding: 16px; display: flex; flex-direction: column; gap: 12px; max-width: 1200px; margin: 0 auto; }
.head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.head p { margin: 2px 0 0; }
table.card { padding: 0; }
.wide { width: 32%; }
.stack { display: flex; height: 12px; border-radius: 6px; background: #eef0f3; overflow: hidden; }
.small { font-size: 12px; }
.legend span { margin-right: 10px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
</style>
