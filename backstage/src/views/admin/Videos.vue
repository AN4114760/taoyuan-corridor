<script setup lang="ts">
// 影片：錄影人員上傳的影片（檔案在 Firebase Storage，紀錄在地端伺服器）。播放、更新處理狀態、匯出
import { computed, onMounted, ref } from 'vue'

import { api } from '@/lib/api'
import { firebaseConfigured } from '@/lib/firebase'
import { type Video, VIDEO_PROCESSING, type VideoProcessing } from '@/types'

const videos = ref<Video[] | null>(null)
const error = ref<string | null>(null)
const filter = ref<VideoProcessing | ''>('')
const q = ref('')
const selected = ref<Video | null>(null)
const form = ref<{ processing: VideoProcessing; adminNote: string }>({ processing: 'pending', adminNote: '' })
const saving = ref(false)
const saved = ref(false)

const fmt = (iso: string) => new Date(iso).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })
const fmtSize = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`)

async function load() {
  error.value = null
  try { videos.value = await api<Video[]>('videos', { admin: true }) } catch (e) { error.value = (e as Error).message }
}
onMounted(load)

const rows = computed(() => (videos.value ?? []).filter((v) =>
  (!filter.value || v.processing === filter.value) &&
  (!q.value || `${v.fileName} ${v.recorderName} ${v.note ?? ''}`.includes(q.value))))
const totalBytes = computed(() => rows.value.reduce((s, v) => s + v.sizeBytes, 0))

function open(v: Video) {
  selected.value = v
  form.value = { processing: v.processing, adminNote: v.adminNote ?? '' }
}

async function save() {
  if (!selected.value) return
  saving.value = true
  try {
    Object.assign(selected.value, await api<Video>(`videos/${selected.value.id}`, { method: 'PATCH', admin: true, body: form.value }))
    saved.value = true
    setTimeout(() => { saved.value = false }, 1500)
  } catch (e) { error.value = (e as Error).message } finally { saving.value = false }
}

function exportCsv() {
  const head = ['id', 'file_name', 'recorder', 'user_id', 'recorded_at', 'uploaded_at', 'size_bytes', 'note', 'processing', 'admin_note', 'storage_path', 'download_url']
  const esc = (x: unknown) => { const s = x == null ? '' : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const lines = rows.value.map((v) => [v.id, v.fileName, v.recorderName, v.userId, v.recordedAt, v.uploadedAt, v.sizeBytes, v.note, v.processing, v.adminNote, v.storagePath, v.downloadUrl].map(esc).join(','))
  const url = URL.createObjectURL(new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' }))
  Object.assign(document.createElement('a'), { href: url, download: 'videos.csv' }).click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="page">
    <div class="row">
      <h2 class="grow">影片（{{ rows.length }} 支・{{ fmtSize(totalBytes) }}）</h2>
      <select v-model="filter">
        <option value="">全部處理狀態</option>
        <option v-for="(label, k) in VIDEO_PROCESSING" :key="k" :value="k">{{ label }}</option>
      </select>
      <input v-model="q" placeholder="搜尋檔名、上傳者、備註" />
      <button @click="load">重新整理</button>
      <button :disabled="!rows.length" @click="exportCsv">匯出 CSV</button>
    </div>
    <p v-if="!firebaseConfigured" class="muted">提醒：這台伺服器還沒設定 Firebase，錄影人員目前無法上傳（README「錄影上傳的 Firebase 設定」）。</p>
    <p v-if="error" class="err">{{ error }}</p>

    <div class="layout" :class="{ split: selected }">
      <div class="card list">
        <p v-if="!videos" class="muted">載入中…</p>
        <table v-else>
          <thead><tr><th>檔名</th><th>上傳者</th><th>拍攝</th><th>上傳</th><th>大小</th><th>處理</th></tr></thead>
          <tbody>
            <tr v-for="v in rows" :key="v.id" :class="{ on: selected?.id === v.id }" @click="open(v)">
              <td class="name">{{ v.fileName }}<small v-if="v.note" class="muted block">{{ v.note }}</small></td>
              <td>{{ v.recorderName }}</td>
              <td>{{ fmt(v.recordedAt) }}</td>
              <td>{{ fmt(v.uploadedAt) }}</td>
              <td>{{ fmtSize(v.sizeBytes) }}</td>
              <td><span class="chip" :class="`p-${v.processing}`">{{ VIDEO_PROCESSING[v.processing] }}</span></td>
            </tr>
            <tr v-if="!rows.length"><td colspan="6" class="muted">沒有影片</td></tr>
          </tbody>
        </table>
      </div>

      <div v-if="selected" class="card detail">
        <div class="row"><b class="grow name">{{ selected.fileName }}</b><button @click="selected = null">×</button></div>
        <video :key="selected.id" :src="selected.downloadUrl" controls preload="metadata"></video>
        <a :href="selected.downloadUrl" target="_blank" rel="noreferrer">下載原檔</a>
        <label>處理狀態
          <select v-model="form.processing">
            <option v-for="(label, k) in VIDEO_PROCESSING" :key="k" :value="k">{{ label }}</option>
          </select>
        </label>
        <label>備註（錄影人員在 App「紀錄」看得到）<textarea v-model="form.adminNote" rows="2" maxlength="500"></textarea></label>
        <div class="row"><button class="primary" :disabled="saving" @click="save">儲存</button><span v-if="saved" class="muted">已儲存</span></div>
        <small class="muted">Storage 路徑：{{ selected.storagePath }}</small>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.page > p { margin: 0; }
.layout { display: grid; grid-template-columns: 1fr; gap: 12px; }
.layout.split { grid-template-columns: minmax(0, 1fr) 380px; }
@media (max-width: 900px) { .layout.split { grid-template-columns: 1fr; } }
.list { overflow-x: auto; padding: 0; }
tbody tr { cursor: pointer; }
tbody tr:hover, tbody tr.on { background: var(--primary-soft); }
.name { word-break: break-all; }
.block { display: block; }
.detail { display: flex; flex-direction: column; gap: 10px; align-self: start; position: sticky; top: 0; }
.detail video { width: 100%; max-height: 50vh; background: #000; border-radius: 8px; }
.detail label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.chip.p-processing { background: #dbeafe; color: #1e40af; }
.chip.p-processed { background: #e3f6e8; color: #17692f; }
.chip.p-unusable { background: #fde2e1; color: #9f1d24; }
</style>
