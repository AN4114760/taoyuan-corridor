<script setup lang="ts">
// 執行情況：各模組資料進度（以全部路段的覆蓋率表示），以及「高優先但還沒有資料」的路段
import { computed } from 'vue'

import { useData } from '@/stores/data'
import { CATEGORIES, LEVEL_COLOR, LEVEL_LABEL, type Level, PARTICIPANT_GROUPS } from '@/types'

const data = useData()
const total = computed(() => data.segments.length)
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' }) : '–')
const latest = (xs: string[]) => xs.sort().at(-1)
const label = (k: string) => (CATEGORIES as Record<string, string>)[k] ?? k

const m1 = computed(() => (['severe', 'caution', 'good', 'missing'] as Level[]).map((lv) => ({
  lv, n: data.segments.filter((s) => s.level === lv).length,
})))

const m2 = computed(() => {
  const segs = new Set(data.drive.map((d) => d.segId).filter(Boolean))
  const byLabel = new Map<string, number>()
  for (const d of data.drive) byLabel.set(d.label, (byLabel.get(d.label) ?? 0) + 1)
  return {
    covered: segs.size, rows: data.drive.length,
    problems: data.drive.filter((d) => d.label in CATEGORIES).length,
    sessions: new Set(data.drive.map((d) => d.sessionId)).size,
    byLabel: [...byLabel].sort((a, b) => b[1] - a[1]),
    last: latest(data.drive.map((d) => d.ts)),
  }
})

const m3 = computed(() => {
  const fb = data.feedback.filter((f) => f.status !== 'rejected')
  const segs = new Set([...data.walks.map((w) => w.segId), ...fb.map((f) => f.segId)].filter(Boolean))
  const groups = Object.keys(PARTICIPANT_GROUPS).map((g) => ({
    g, n: data.walks.filter((w) => w.participantGroup === g).length + fb.filter((f) => f.participantGroup === g).length,
  }))
  return {
    covered: segs.size, walks: data.walks.length, game: data.walks.filter((w) => w.source === 'game').length,
    feedback: fb.length, groups, last: latest([...data.walks.map((w) => w.ts), ...fb.map((f) => f.createdAt)]),
  }
})

const review = computed(() => {
  const withAnomaly = data.feedback.filter((f) => f.anomalies.length)
  return {
    total: data.feedback.length, withAnomaly: withAnomaly.length,
    photos: data.feedback.reduce((s, f) => s + f.anomalies.reduce((t, a) => t + a.photoCount, 0), 0),
    new: withAnomaly.filter((f) => f.status === 'new').length,
    confirmed: withAnomaly.filter((f) => f.status === 'confirmed').length,
    rejected: withAnomaly.filter((f) => f.status === 'rejected').length,
  }
})

/** 嚴重／需注意，但模組二沒拍到、也沒人走過評分的路段：下一次出隊優先 */
const gaps = computed(() => {
  const seen = new Set([
    ...data.drive.map((d) => d.segId), ...data.walks.map((w) => w.segId),
    ...data.feedback.filter((f) => f.status !== 'rejected').map((f) => f.segId),
  ])
  return data.segments.filter((s) => (s.level === 'severe' || s.level === 'caution') && !seen.has(s.id))
})

const fileErrors = computed(() => [
  ...data.moduleFiles.m2.map((f) => ({ ...f, module: '模組二' })),
  ...data.moduleFiles.m3.map((f) => ({ ...f, module: '模組三' })),
])
const pct = (n: number) => `${total.value ? Math.round((n / total.value) * 100) : 0}%`
</script>

<template>
  <div class="page">
    <div class="grid">
      <section class="card">
        <h2>模組一・遙測判釋</h2>
        <p class="big">{{ total }} / {{ total }} 段 <span class="chip" style="background: #e3f6e8; color: #17692f">完成</span></p>
        <div class="bar"><div style="width: 100%"></div></div>
        <ul>
          <li v-for="x in m1" :key="x.lv"><span class="lvl" :style="{ background: LEVEL_COLOR[x.lv] }"></span>{{ LEVEL_LABEL[x.lv] }} {{ x.n }}</li>
        </ul>
        <p class="muted">國土管理署人行道＋SAM 3 樹冠（航照 2024）</p>
      </section>

      <section class="card">
        <h2>模組二・車行影像＋VLM</h2>
        <p class="big">{{ m2.covered }} / {{ total }} 段 <span class="muted">{{ pct(m2.covered) }}</span></p>
        <div class="bar"><div :style="{ width: pct(m2.covered) }"></div></div>
        <ul>
          <li>偵測 {{ m2.rows }} 筆（問題 {{ m2.problems }}、設施 {{ m2.rows - m2.problems }}）・{{ m2.sessions }} 趟行車</li>
          <li v-for="[k, n] in m2.byLabel.slice(0, 5)" :key="k" class="muted">{{ label(k) }} {{ n }}</li>
        </ul>
        <p class="muted">最後資料：{{ fmt(m2.last) }}</p>
      </section>

      <section class="card">
        <h2>模組三＋志工・行經感受</h2>
        <p class="big">{{ m3.covered }} / {{ total }} 段 <span class="muted">{{ pct(m3.covered) }}</span></p>
        <div class="bar"><div :style="{ width: pct(m3.covered) }"></div></div>
        <ul>
          <li>模組三 {{ m3.walks }} 筆（遊戲 {{ m3.game }}、實走 {{ m3.walks - m3.game }}）・志工回饋 {{ m3.feedback }} 筆</li>
          <li class="muted"><template v-for="(x, i) in m3.groups" :key="x.g">{{ i ? '、' : '' }}{{ PARTICIPANT_GROUPS[x.g as keyof typeof PARTICIPANT_GROUPS] }} {{ x.n }}</template></li>
        </ul>
        <p class="muted">最後資料：{{ fmt(m3.last) }}</p>
      </section>

      <section class="card">
        <h2>複查（有異狀的回饋）</h2>
        <p class="big">{{ review.confirmed + review.rejected }} / {{ review.withAnomaly }} 筆已審</p>
        <div class="bar"><div :style="{ width: `${review.withAnomaly ? ((review.confirmed + review.rejected) / review.withAnomaly) * 100 : 0}%` }"></div></div>
        <ul>
          <li>待審核 <b>{{ review.new }}</b>・已確認 {{ review.confirmed }}・不成立 {{ review.rejected }}</li>
          <li class="muted">回饋共 {{ review.total }} 筆，照片 {{ review.photos }} 張</li>
        </ul>
        <RouterLink to="/admin/review">去複查 →</RouterLink>
      </section>
    </div>

    <section class="card">
      <h2>高優先但還沒有資料（{{ gaps.length }} 段）</h2>
      <p class="muted">模組一判為嚴重或需注意，模組二還沒拍到、也沒有人走過評分。建議排入下一次車行或實走。</p>
      <table v-if="gaps.length">
        <thead><tr><th>等級</th><th>道路</th><th>起訖</th><th>判定原因</th><th></th></tr></thead>
        <tbody>
          <tr v-for="s in gaps" :key="s.id">
            <td><span class="lvl" :style="{ background: LEVEL_COLOR[s.level] }"></span>{{ LEVEL_LABEL[s.level] }}</td>
            <td>{{ s.road_name || '–' }}</td>
            <td>{{ s.from || '?' }} → {{ s.to || '?' }}</td>
            <td>{{ s.label }}</td>
            <td><RouterLink :to="{ path: '/admin/map', query: { seg: s.id } }">地圖</RouterLink></td>
          </tr>
        </tbody>
      </table>
      <p v-else>全部高優先路段都已經有資料。</p>
    </section>

    <section class="card">
      <h2>交件檔案</h2>
      <p class="muted">隊友把 CSV 放進 <code>data/module2/</code>、<code>data/module3/</code> 後按右上「重新整理」。格式見 docs/data-contract.md。</p>
      <table v-if="fileErrors.length">
        <thead><tr><th>模組</th><th>檔名</th><th>有效筆數</th><th>錯誤</th><th>更新時間</th></tr></thead>
        <tbody>
          <tr v-for="f in fileErrors" :key="f.module + f.name">
            <td>{{ f.module }}</td>
            <td>{{ f.name }} <span v-if="f.name.startsWith('demo-')" class="chip demo">示範</span></td>
            <td>{{ f.rows }}</td>
            <td>
              <span v-if="!f.errors.length" class="muted">無</span>
              <details v-else><summary class="err">{{ f.errors.length }} 列有誤（不會計入）</summary>
                <div v-for="e in f.errors.slice(0, 30)" :key="e.row" class="muted">第 {{ e.row }} 列：{{ e.message }}</div>
              </details>
            </td>
            <td class="muted">{{ fmt(f.mtime) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">還沒有交件檔案。</p>
    </section>
  </div>
</template>

<style scoped>
.page { padding: 16px; display: flex; flex-direction: column; gap: 14px; max-width: 1200px; margin: 0 auto; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.grid .card { display: flex; flex-direction: column; gap: 8px; }
.big { font-size: 22px; font-weight: 700; margin: 0; }
ul { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
section > p { margin: 4px 0 8px; }
code { background: #f1f3f5; padding: 0 4px; border-radius: 4px; }
</style>
