<script setup lang="ts">
// 志工回饋：依路段彙整「行經感受」（志工回饋＋模組三評分），安全感低的排前面
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { useData } from '@/stores/data'
import { LEVEL_COLOR, LEVEL_LABEL, PARTICIPANT_GROUPS, type ParticipantGroup, type Segment } from '@/types'

const data = useData()
const route = useRoute()
const open = ref<string | null>((route.query.seg as string) ?? null)
const sortBy = ref<'safety' | 'count'>('safety')

interface Entry { key: string; source: string; group: ParticipantGroup; safety: number; comfort: number; text: string; at: string; demo?: boolean }
interface Row { seg: Segment; entries: Entry[]; safety: number; comfort: number; byGroup: { g: ParticipantGroup; mean: number; n: number }[] }

const mean = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10

const rows = computed<Row[]>(() => {
  const by = new Map<string, Entry[]>()
  const push = (id: string | null | undefined, e: Entry) => { if (id) by.set(id, [...(by.get(id) ?? []), e]) }
  for (const f of data.feedback) {
    if (f.status === 'rejected') continue
    push(f.segId, { key: f.id, source: f.volunteerName || '志工', group: f.participantGroup, safety: f.safety, comfort: f.comfort, text: f.comment ?? '', at: f.createdAt, demo: f.demo })
  }
  data.walks.forEach((w, i) => push(w.segId, {
    key: `w${i}`, source: w.source === 'game' ? '模組三・遊戲' : '模組三・實走', group: w.participantGroup,
    safety: w.safety, comfort: w.comfort, text: '', at: w.ts, demo: w.demo,
  }))
  const out: Row[] = []
  for (const [id, entries] of by) {
    const seg = data.segmentById.get(id)
    if (!seg) continue
    entries.sort((a, b) => b.at.localeCompare(a.at))
    const byGroup = (Object.keys(PARTICIPANT_GROUPS) as ParticipantGroup[])
      .map((g) => ({ g, xs: entries.filter((e) => e.group === g).map((e) => e.safety) }))
      .filter((x) => x.xs.length).map((x) => ({ g: x.g, mean: mean(x.xs), n: x.xs.length }))
    out.push({ seg, entries, safety: mean(entries.map((e) => e.safety)), comfort: mean(entries.map((e) => e.comfort)), byGroup })
  }
  return out.sort((a, b) => (sortBy.value === 'safety' ? a.safety - b.safety || b.entries.length - a.entries.length : b.entries.length - a.entries.length))
})

const scoreColor = (v: number) => (v < 2.5 ? 'var(--severe)' : v < 3.5 ? 'var(--orange)' : 'var(--good)')
const fmt = (iso: string) => new Date(iso).toLocaleDateString('zh-TW')
const quotes = (r: Row) => r.entries.filter((e) => e.text).slice(0, 2)
</script>

<template>
  <div class="page">
    <div class="row head">
      <h2 class="grow">行經感受（{{ rows.length }} 段有資料）</h2>
      <label class="row">排序
        <select v-model="sortBy"><option value="safety">安全感低的優先</option><option value="count">回饋多的優先</option></select>
      </label>
    </div>
    <p class="muted">包含志工回饋（不成立的除外）與模組三的遊戲／實走評分；分數 1–5，5 最好。</p>

    <table class="card">
      <thead><tr><th>道路</th><th>模組一</th><th>筆數</th><th>安全感</th><th>舒適度</th><th>各身分安全感</th><th>最近的感受</th></tr></thead>
      <tbody>
        <template v-for="r in rows" :key="r.seg.id">
          <tr class="main" :class="{ open: open === r.seg.id }" @click="open = open === r.seg.id ? null : r.seg.id">
            <td><b>{{ r.seg.road_name || '未命名道路' }}</b><div class="muted">{{ r.seg.kind === 'missing' ? `${r.seg.side === 'left' ? '左' : '右'}側無人行道・${r.seg.id.split('-').pop()}` : `${r.seg.from || '?'} → ${r.seg.to || '?'}` }}</div></td>
            <td><span class="lvl" :style="{ background: LEVEL_COLOR[r.seg.level] }"></span>{{ LEVEL_LABEL[r.seg.level] }}</td>
            <td>{{ r.entries.length }}</td>
            <td><b :style="{ color: scoreColor(r.safety) }">{{ r.safety }}</b></td>
            <td><b :style="{ color: scoreColor(r.comfort) }">{{ r.comfort }}</b></td>
            <td class="groups"><span v-for="x in r.byGroup" :key="x.g" class="chip">{{ PARTICIPANT_GROUPS[x.g] }} {{ x.mean }}（{{ x.n }}）</span></td>
            <td class="quote"><div v-for="q in quotes(r)" :key="q.key">「{{ q.text }}」</div></td>
          </tr>
          <tr v-if="open === r.seg.id" class="detail">
            <td colspan="7">
              <div class="row" style="margin-bottom: 6px">
                <RouterLink :to="{ path: '/admin/map', query: { seg: r.seg.id } }">在地圖上看</RouterLink>
              </div>
              <table>
                <tbody>
                  <tr v-for="e in r.entries" :key="e.key">
                    <td class="muted">{{ fmt(e.at) }}</td>
                    <td>{{ e.source }} <span v-if="e.demo" class="chip demo">示範</span></td>
                    <td>{{ PARTICIPANT_GROUPS[e.group] }}</td>
                    <td>安全 {{ e.safety }}・舒適 {{ e.comfort }}</td>
                    <td>{{ e.text }}</td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.page { padding: 16px; max-width: 1200px; margin: 0 auto; }
.head { margin-bottom: 4px; }
table.card { padding: 0; overflow: hidden; }
tr.main { cursor: pointer; }
tr.main:hover, tr.main.open { background: #f8fafc; }
.groups { max-width: 260px; }
.groups .chip { margin: 0 4px 4px 0; }
.quote { max-width: 320px; font-size: 13px; color: #374151; }
tr.detail > td { background: #f8fafc; padding: 8px 16px 12px; }
tr.detail td td { font-size: 13px; padding: 4px 6px; }
</style>
