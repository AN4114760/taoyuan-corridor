<script setup lang="ts">
// 複查情況：審核志工回報的異狀（看照片 → 確認／不成立 → 備註）
import { computed, reactive, ref } from 'vue'

import { photoUrl } from '@/lib/api'
import { useData } from '@/stores/data'
import { CATEGORIES, type Feedback, FEEDBACK_STATUS, type FeedbackStatus, LEVEL_COLOR, LEVEL_LABEL, PARTICIPANT_GROUPS } from '@/types'

const data = useData()
const status = ref<FeedbackStatus | 'all'>('new')
const category = ref<string>('')
const onlyAnomaly = ref(true)
const notes = reactive<Record<string, string>>({})
const busy = ref<string | null>(null)
const err = ref<string | null>(null)
const lightbox = ref<string | null>(null)

const base = computed(() => data.feedback.filter((f) => !onlyAnomaly.value || f.anomalies.length))
const stats = computed(() => Object.fromEntries((['new', 'confirmed', 'rejected'] as FeedbackStatus[])
  .map((s) => [s, base.value.filter((f) => f.status === s).length])) as Record<FeedbackStatus, number>)
const list = computed(() => base.value
  .filter((f) => status.value === 'all' || f.status === status.value)
  .filter((f) => !category.value || f.anomalies.some((a) => a.category === category.value))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' }) : '')
const label = (k: string) => (CATEGORIES as Record<string, string>)[k] ?? k
const noteOf = (f: Feedback) => notes[f.id] ?? f.reviewNote ?? ''

async function decide(f: Feedback, s: FeedbackStatus) {
  busy.value = f.id
  err.value = null
  try {
    await data.review(f.id, s, noteOf(f))
    delete notes[f.id]
  } catch (e) {
    err.value = (e as Error).message
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="page">
    <div class="filters card">
      <div class="tabs">
        <button v-for="s in (['new', 'confirmed', 'rejected'] as const)" :key="s" :class="{ on: status === s }" @click="status = s">
          {{ FEEDBACK_STATUS[s] }} <b>{{ stats[s] }}</b>
        </button>
        <button :class="{ on: status === 'all' }" @click="status = 'all'">全部 <b>{{ base.length }}</b></button>
      </div>
      <select v-model="category">
        <option value="">所有類別</option>
        <option v-for="(l, k) in CATEGORIES" :key="k" :value="k">{{ l }}</option>
      </select>
      <label class="row"><input v-model="onlyAnomaly" type="checkbox" /> 只看有異狀的回饋</label>
      <span class="muted">審核後到「需改善路段」按重新計算，評級才會更新</span>
    </div>
    <p v-if="err" class="err">{{ err }}</p>
    <p v-if="!list.length" class="muted empty">沒有符合條件的回饋。</p>

    <article v-for="f in list" :key="f.id" class="card item">
      <header class="row">
        <span class="chip" :class="f.status">{{ FEEDBACK_STATUS[f.status] }}</span>
        <span v-if="f.demo" class="chip demo">示範</span>
        <b>{{ data.segmentById.get(f.segId)?.road_name || '未命名道路' }}</b>
        <span v-if="data.segmentById.get(f.segId)" class="muted">
          <span class="lvl" :style="{ background: LEVEL_COLOR[data.segmentById.get(f.segId)!.level] }"></span>{{ LEVEL_LABEL[data.segmentById.get(f.segId)!.level] }}
        </span>
        <RouterLink :to="{ path: '/admin/map', query: { seg: f.segId } }" class="muted">{{ f.segId }}</RouterLink>
        <span class="grow"></span>
        <span class="muted">{{ f.volunteerName || '匿名' }}・{{ PARTICIPANT_GROUPS[f.participantGroup] }}・{{ fmt(f.createdAt) }}</span>
      </header>
      <p class="feel">安全感 <b>{{ f.safety }}</b>・舒適度 <b>{{ f.comfort }}</b><span v-if="f.comment">｜{{ f.comment }}</span></p>

      <div v-for="(a, ai) in f.anomalies" :key="ai" class="anomaly">
        <div><span class="chip">{{ label(a.category) }}</span> <span v-if="a.note">{{ a.note }}</span></div>
        <div class="photos">
          <img v-for="p in a.photoCount" :key="p" :src="photoUrl(f.id, ai, p - 1)" loading="lazy" alt="回報照片"
            @click="lightbox = photoUrl(f.id, ai, p - 1)" />
          <span v-if="!a.photoCount" class="muted">（沒有照片）</span>
        </div>
      </div>

      <footer class="row">
        <input :value="noteOf(f)" class="grow" maxlength="500" placeholder="審核備註（例如：現場確認樹穴占 2/3 寬度）"
          @input="notes[f.id] = ($event.target as HTMLInputElement).value" />
        <button class="ok" :disabled="busy === f.id" @click="decide(f, 'confirmed')">✓ 確認</button>
        <button class="danger" :disabled="busy === f.id" @click="decide(f, 'rejected')">✗ 不成立</button>
        <button v-if="f.status !== 'new'" :disabled="busy === f.id" @click="decide(f, 'new')">改回待審</button>
      </footer>
      <p v-if="f.reviewedAt" class="muted">上次審核：{{ fmt(f.reviewedAt) }}</p>
    </article>

    <div v-if="lightbox" class="lightbox" @click="lightbox = null"><img :src="lightbox" alt="" /></div>
  </div>
</template>

<style scoped>
.page { padding: 16px; display: flex; flex-direction: column; gap: 12px; max-width: 1000px; margin: 0 auto; }
.filters { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; position: sticky; top: 0; z-index: 5; }
.tabs { display: flex; gap: 4px; }
.tabs button.on { background: var(--primary); color: #fff; border-color: var(--primary); }
.item { display: flex; flex-direction: column; gap: 8px; }
.feel { margin: 0; }
.anomaly { background: #fafafa; border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.photos { display: flex; gap: 8px; flex-wrap: wrap; }
.photos img { width: 120px; height: 90px; object-fit: cover; border-radius: 6px; cursor: zoom-in; border: 1px solid var(--line); }
.empty { padding: 24px; text-align: center; }
.lightbox { position: fixed; inset: 0; background: rgba(0, 0, 0, .8); display: flex; align-items: center; justify-content: center; z-index: 2000; cursor: zoom-out; }
.lightbox img { max-width: 94vw; max-height: 92vh; border-radius: 6px; }
</style>
