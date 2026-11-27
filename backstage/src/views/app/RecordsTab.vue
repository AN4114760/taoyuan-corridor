<script setup lang="ts">
// 紀錄：這個帳號送出的志工回饋（審核狀態）與上傳的影片（處理狀態），換手機登入也看得到
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { api } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useData } from '@/stores/data'
import { type Feedback, FEEDBACK_STATUS, LEVEL_COLOR, type Video, VIDEO_PROCESSING } from '@/types'

const auth = useAuth()
const data = useData()
const route = useRoute()
const router = useRouter()

// 只顯示這個帳號有權限（或已經有資料）的分頁
const feedback = ref<Feedback[] | null>(null)
const videos = ref<Video[] | null>(null)
const error = ref<string | null>(null)
const showFeedback = computed(() => auth.isVolunteer || !!feedback.value?.length)
const showVideos = computed(() => auth.isRecorder || !!videos.value?.length)
const tab = computed(() => (route.query.tab === 'videos' || !showFeedback.value ? 'videos' : 'feedback'))
const setTab = (t: string) => router.replace({ query: t === 'videos' ? { tab: t } : {} })
const playing = ref<string | null>(null)

onMounted(async () => {
  data.loadPublic().catch(() => {})
  try {
    [feedback.value, videos.value] = await Promise.all([api<Feedback[]>('me/feedback', { user: true }), api<Video[]>('me/videos', { user: true })])
  } catch (e) { error.value = (e as Error).message }
})

const fmt = (iso: string) => new Date(iso).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })
const fmtSize = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`)
const segOf = (id: string) => data.segmentById.get(id)
</script>

<template>
  <main class="page">
    <header class="title"><h1>紀錄</h1></header>
    <div v-if="showFeedback && showVideos" class="tabs">
      <button :class="{ on: tab === 'feedback' }" @click="setTab('feedback')">走訪回饋{{ feedback ? `（${feedback.length}）` : '' }}</button>
      <button :class="{ on: tab === 'videos' }" @click="setTab('videos')">影片{{ videos ? `（${videos.length}）` : '' }}</button>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <template v-if="tab === 'feedback'">
      <p v-if="!feedback" class="muted">載入中…</p>
      <p v-else-if="!feedback.length" class="card muted">還沒有走訪紀錄，<RouterLink to="/app/map">到地圖選一段路</RouterLink></p>
      <RouterLink v-for="f in feedback" v-else :key="f.id" :to="`/app/records/feedback/${f.id}`" class="card item">
        <span class="lvl" :style="{ background: segOf(f.segId) ? LEVEL_COLOR[segOf(f.segId)!.level] : '#999' }"></span>
        <span class="grow">
          <b>{{ segOf(f.segId)?.road_name || f.segId }}</b>
          <small class="muted block">{{ fmt(f.createdAt) }}・安全感 {{ f.safety }}・異狀 {{ f.anomalies.length }} 項</small>
        </span>
        <span class="chip" :class="f.status">{{ FEEDBACK_STATUS[f.status] }}</span>
      </RouterLink>
    </template>

    <template v-else>
      <p v-if="!videos" class="muted">載入中…</p>
      <p v-else-if="!videos.length" class="card muted">還沒有上傳紀錄，<RouterLink to="/app/upload">去上傳</RouterLink></p>
      <div v-for="v in videos" v-else :key="v.id" class="card video">
        <div class="row nowrap">
          <b class="grow name">{{ v.fileName }}</b>
          <span class="chip" :class="`p-${v.processing}`">{{ VIDEO_PROCESSING[v.processing] }}</span>
        </div>
        <small class="muted">上傳 {{ fmt(v.uploadedAt) }}・拍攝 {{ fmt(v.recordedAt) }}・{{ fmtSize(v.sizeBytes) }}</small>
        <small v-if="v.note">備註：{{ v.note }}</small>
        <small v-if="v.adminNote" class="admin-note">研究團隊：{{ v.adminNote }}</small>
        <video v-if="playing === v.id" :src="v.downloadUrl" controls autoplay playsinline></video>
        <button v-else class="link" @click="playing = v.id">▶ 播放</button>
      </div>
    </template>
  </main>
</template>

<style scoped>
.page { max-width: 640px; margin: 0 auto; padding: 0 14px 24px; display: flex; flex-direction: column; gap: 10px; }
.title { padding: calc(16px + env(safe-area-inset-top)) 2px 0; }
.title h1 { font-size: 22px; }
.tabs { display: flex; background: #e9ebef; border-radius: 10px; padding: 3px; }
.tabs button { flex: 1; border: 0; background: none; padding: 7px; border-radius: 8px; }
.tabs button.on { background: var(--card); font-weight: 600; box-shadow: 0 1px 3px rgba(0, 0, 0, .12); }
.item { display: flex; align-items: center; gap: 8px; text-decoration: none; color: inherit; }
.block { display: block; }
.nowrap { flex-wrap: nowrap; }
.video { display: flex; flex-direction: column; gap: 4px; }
.video video { width: 100%; border-radius: 8px; background: #000; margin-top: 4px; }
.name { word-break: break-all; min-width: 0; }
.admin-note { background: var(--primary-soft); border-radius: 6px; padding: 4px 8px; }
button.link { align-self: flex-start; border: 0; background: none; color: var(--primary); padding: 2px 0; }
.chip.p-processing { background: #dbeafe; color: #1e40af; }
.chip.p-processed { background: #e3f6e8; color: #17692f; }
.chip.p-unusable { background: #fde2e1; color: #9f1d24; }
</style>
