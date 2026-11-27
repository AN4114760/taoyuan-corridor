<script setup lang="ts">
// 單筆走訪回饋：內容、照片、審核狀態與研究團隊備註
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { api, myPhotoUrl } from '@/lib/api'
import { formatDistance } from '@/lib/geolocation'
import { useData } from '@/stores/data'
import { CATEGORIES, type Feedback, FEEDBACK_STATUS, LEVEL_COLOR, LEVEL_LABEL, PARTICIPANT_GROUPS } from '@/types'

const id = String(useRoute().params.id)
const data = useData()
const rec = ref<Feedback | null | undefined>(undefined)
const zoom = ref<string | null>(null)
const SCALE = ['很差', '差', '普通', '好', '很好']
const fmt = (iso: string) => new Date(iso).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })

onMounted(async () => {
  data.loadPublic().catch(() => {})
  const list = await api<Feedback[]>('me/feedback', { user: true }).catch(() => [])
  rec.value = list.find((f) => f.id === id) ?? null
})
</script>

<template>
  <main class="page">
    <header class="bar"><RouterLink to="/app/records">‹ 紀錄</RouterLink></header>
    <p v-if="rec === undefined" class="muted">載入中…</p>
    <p v-else-if="rec === null" class="card">找不到這筆紀錄。</p>
    <template v-else>
      <section class="card">
        <div class="row nowrap">
          <span class="lvl" :style="{ background: data.segmentById.get(rec.segId) ? LEVEL_COLOR[data.segmentById.get(rec.segId)!.level] : '#999' }"></span>
          <h2 class="grow">{{ data.segmentById.get(rec.segId)?.road_name || rec.segId }}</h2>
          <span class="chip" :class="rec.status">{{ FEEDBACK_STATUS[rec.status] }}</span>
        </div>
        <p v-if="rec.reviewNote" class="review">研究團隊：{{ rec.reviewNote }}</p>
        <dl>
          <dt>送出時間</dt><dd>{{ fmt(rec.createdAt) }}</dd>
          <dt>路段</dt><dd>{{ data.segmentById.get(rec.segId) ? LEVEL_LABEL[data.segmentById.get(rec.segId)!.level] : '' }} <small class="muted">{{ rec.segId }}</small></dd>
          <template v-if="rec.walk"><dt>開始時距離</dt><dd>{{ formatDistance(rec.walk.startDistanceM) }}</dd></template>
          <dt>身分</dt><dd>{{ PARTICIPANT_GROUPS[rec.participantGroup] }}</dd>
          <dt>安全感</dt><dd>{{ rec.safety }}（{{ SCALE[rec.safety - 1] }}）</dd>
          <dt>舒適度</dt><dd>{{ rec.comfort }}（{{ SCALE[rec.comfort - 1] }}）</dd>
        </dl>
        <p v-if="rec.comment">「{{ rec.comment }}」</p>
      </section>
      <section v-for="(a, i) in rec.anomalies" :key="i" class="card">
        <h3>異狀 {{ i + 1 }}：{{ CATEGORIES[a.category] }}</h3>
        <p v-if="a.note">{{ a.note }}</p>
        <div class="photos">
          <img v-for="j in a.photoCount" :key="j" :src="myPhotoUrl(rec.id, i, j - 1)" alt="" @click="zoom = myPhotoUrl(rec.id, i, j - 1)" />
        </div>
      </section>
      <p v-if="!rec.anomalies.length" class="muted">這筆沒有回報異狀。</p>
    </template>
    <div v-if="zoom" class="zoom" @click="zoom = null"><img :src="zoom" alt="" /></div>
  </main>
</template>

<style scoped>
.page { max-width: 640px; margin: 0 auto; padding: 0 14px 24px; display: flex; flex-direction: column; gap: 10px; }
.bar { padding: calc(14px + env(safe-area-inset-top)) 2px 0; }
.bar a { text-decoration: none; }
.card { display: flex; flex-direction: column; gap: 8px; }
.card p { margin: 0; }
.nowrap { flex-wrap: nowrap; }
.review { background: var(--primary-soft); border-radius: 8px; padding: 6px 10px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; font-size: 14px; }
dt { color: var(--muted); }
dd { margin: 0; }
.photos { display: flex; gap: 8px; flex-wrap: wrap; }
.photos img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; cursor: zoom-in; }
.zoom { position: fixed; inset: 0; background: rgba(0, 0, 0, .85); display: flex; align-items: center; justify-content: center; z-index: 2000; }
.zoom img { max-width: 95%; max-height: 95%; }
</style>
