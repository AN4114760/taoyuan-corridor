<script setup lang="ts">
// 錄影人員：選影片（可多選）→ 依序上傳到 Firebase Storage（有進度、可取消）→ 登記到帳號的紀錄
import type { User } from 'firebase/auth'
import type { UploadTask } from 'firebase/storage'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { api } from '@/lib/api'
import { firebaseConfigured } from '@/lib/firebase'
import { ensureFirebaseUser, MAX_VIDEO_BYTES, uploadVideoFile } from '@/lib/videos'

type Status = 'pending' | 'uploading' | 'done' | 'failed'
interface Item { key: number; file: File; note: string; status: Status; progress: number; error?: string }
const STATUS: Record<Status, string> = { pending: '待上傳', uploading: '上傳中', done: '已完成', failed: '失敗' }

const fbUser = ref<User | null>(null)
const connectError = ref<string | null>(null)
onMounted(async () => {
  if (!firebaseConfigured) return
  try { fbUser.value = await ensureFirebaseUser() } catch (e) { connectError.value = `無法連線到 Firebase：${(e as Error).message}` }
})

const items = reactive<Item[]>([])
const warning = ref<string | null>(null)
let seq = 0
let current: UploadTask | null = null
const running = ref(false)
const waiting = computed(() => items.filter((i) => i.status === 'pending' || i.status === 'failed').length)

const fmtSize = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`)
const fmtTime = (ms: number) => new Date(ms).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })

function onFiles(ev: Event) {
  const input = ev.target as HTMLInputElement
  const tooBig: string[] = []
  for (const f of input.files ?? []) {
    if (f.size > MAX_VIDEO_BYTES) tooBig.push(f.name)
    else items.push({ key: ++seq, file: f, note: '', status: 'pending', progress: 0 })
  }
  warning.value = tooBig.length ? `超過 ${fmtSize(MAX_VIDEO_BYTES)} 上限，未加入：${tooBig.join('、')}` : null
  input.value = ''
}

async function start() {
  if (running.value || !fbUser.value) return
  running.value = true
  items.forEach((i) => { if (i.status === 'failed') { i.status = 'pending'; i.error = undefined } })
  for (const it of items) {
    if (it.status !== 'pending') continue
    it.status = 'uploading'
    it.progress = 0
    try {
      const h = uploadVideoFile(fbUser.value, it.file, (r) => { it.progress = r })
      current = h.task
      const { storagePath, downloadUrl } = await h.done
      await api('me/videos', {
        method: 'POST', user: true,
        body: {
          fileName: it.file.name, sizeBytes: it.file.size, contentType: it.file.type || 'video/mp4',
          recordedAt: new Date(it.file.lastModified).toISOString(), storagePath, downloadUrl, note: it.note.trim() || undefined,
        },
      })
      it.status = 'done'
    } catch (e) {
      const code = (e as { code?: string }).code
      it.status = 'failed'
      it.error = code === 'storage/canceled' ? '已取消' : code === 'storage/unauthorized' ? '沒有上傳權限（請確認 Firebase 規則已部署、已啟用匿名登入）' : (e as Error).message
      if (code === 'storage/canceled') break
    } finally {
      current = null
    }
  }
  running.value = false
}

const cancel = () => current?.cancel()
const remove = (key: number) => { const i = items.findIndex((x) => x.key === key); if (i >= 0) items.splice(i, 1) }
const clearDone = () => { for (let i = items.length - 1; i >= 0; i--) if (items[i].status === 'done') items.splice(i, 1) }

const warnLeave = (e: BeforeUnloadEvent) => { if (running.value) e.preventDefault() }
window.addEventListener('beforeunload', warnLeave)
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnLeave))
</script>

<template>
  <main class="page">
    <header class="title"><h1>錄影上傳</h1></header>

    <section v-if="!firebaseConfigured" class="card">
      <h2>尚未設定</h2>
      <p class="muted">伺服器還沒有設定影片儲存空間，暫時無法上傳。請聯絡研究團隊。</p>
    </section>

    <template v-else>
      <p v-if="connectError" class="err">{{ connectError }}</p>
      <label class="pick" :class="{ disabled: !fbUser }">
        ＋ 選擇影片（可多選）
        <input type="file" accept="video/*" multiple :disabled="!fbUser" @change="onFiles" />
      </label>
      <p v-if="!fbUser && !connectError" class="muted">連線中…</p>
      <p v-if="warning" class="err">{{ warning }}</p>

      <section v-if="items.length" class="card">
        <div class="row">
          <h2 class="grow">上傳清單</h2>
          <button v-if="!running && items.some((i) => i.status === 'done')" @click="clearDone">清除已完成</button>
        </div>
        <div v-for="it in items" :key="it.key" class="item" :class="it.status">
          <div class="row nowrap">
            <span class="grow name"><b>{{ it.file.name }}</b><small class="muted block">{{ fmtSize(it.file.size) }}・拍攝於 {{ fmtTime(it.file.lastModified) }}</small></span>
            <span class="chip" :class="it.status">{{ STATUS[it.status] }}</span>
          </div>
          <div v-if="it.status === 'pending' || it.status === 'failed'" class="row nowrap">
            <input v-model="it.note" class="grow" maxlength="500" placeholder="備註（例如：中山路往桃園醫院方向）" />
            <button v-if="!running" class="danger" @click="remove(it.key)">移除</button>
          </div>
          <small v-else-if="it.note" class="muted">備註：{{ it.note }}</small>
          <template v-if="it.status === 'uploading'">
            <div class="bar"><div :style="{ width: `${Math.round(it.progress * 100)}%` }"></div></div>
            <div class="row"><small class="grow">{{ Math.round(it.progress * 100) }}%，請勿關閉頁面</small><button @click="cancel">取消</button></div>
          </template>
          <small v-if="it.error" class="err">{{ it.error }}</small>
        </div>
        <button v-if="waiting && !running" class="primary big" :disabled="!fbUser" @click="start">開始上傳（{{ waiting }} 支）</button>
        <RouterLink v-if="!running && items.some((i) => i.status === 'done')" to="/app/records?tab=videos">查看上傳紀錄 ›</RouterLink>
      </section>
    </template>
  </main>
</template>

<style scoped>
.page { max-width: 640px; margin: 0 auto; padding: 0 14px 24px; display: flex; flex-direction: column; gap: 12px; }
.title { padding: calc(16px + env(safe-area-inset-top)) 2px 0; }
.title h1 { font-size: 22px; }
.card { display: flex; flex-direction: column; gap: 10px; }
.card p { margin: 0; }
.pick { display: flex; align-items: center; justify-content: center; padding: 16px; border-radius: 12px; background: var(--primary); color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
.pick.disabled { opacity: .5; cursor: default; }
.pick input { display: none; }
.item { border: 1px solid var(--line); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.item.done { background: #f3faf5; }
.item.failed { border-color: #f3b4b2; }
.nowrap { flex-wrap: nowrap; }
.name { min-width: 0; word-break: break-all; }
.block { display: block; }
.chip.uploading { background: #dbeafe; color: #1e40af; }
.chip.done { background: #e3f6e8; color: #17692f; }
.chip.failed { background: #fde2e1; color: #9f1d24; }
.big { padding: 12px; font-size: 17px; border-radius: 10px; }
</style>
