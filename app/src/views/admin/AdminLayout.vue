<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api, ApiError, getPin, setPin } from '@/lib/api'
import { useData } from '@/stores/data'

const data = useData()
const authed = ref(false)
const pinInput = ref('')
const pinError = ref<string | null>(null)

async function login(pin: string) {
  setPin(pin)
  try {
    await api('admin/check', { method: 'POST', admin: true })
    authed.value = true
    pinError.value = null
    await data.loadAdmin()
  } catch (e) {
    setPin(null)
    authed.value = false
    pinError.value = e instanceof ApiError && e.status === 401 ? 'PIN 錯誤' : (e as Error).message
  }
}
onMounted(() => { if (getPin()) login(getPin()) })

function logout() {
  setPin(null)
  authed.value = false
}

const TABS = [
  { to: '/admin/map', label: '地圖' },
  { to: '/admin/progress', label: '執行情況' },
  { to: '/admin/review', label: '複查情況' },
  { to: '/admin/voices', label: '志工回饋' },
  { to: '/admin/priorities', label: '需改善路段' },
]
const pending = computed(() => data.feedback.filter((f) => f.status === 'new' && f.anomalies.length).length)
const hasDemo = computed(() => data.feedback.some((f) => f.demo) || data.drive.some((d) => d.demo) || data.walks.some((w) => w.demo))
</script>

<template>
  <div v-if="!authed" class="gate">
    <form class="card" @submit.prevent="login(pinInput)">
      <h2>無障礙廊道・後台</h2>
      <p class="muted">請輸入 PIN（設定在 app/.env.local 的 ADMIN_PIN；沒設定時看伺服器啟動訊息）</p>
      <input v-model="pinInput" type="password" inputmode="numeric" autocomplete="current-password" placeholder="PIN" autofocus />
      <p v-if="pinError" class="err">{{ pinError }}</p>
      <button class="primary" :disabled="!pinInput">進入</button>
    </form>
  </div>

  <div v-else class="admin">
    <nav>
      <b class="brand">無障礙廊道後台</b>
      <span class="muted site">衛福部桃園醫院</span>
      <RouterLink v-for="t in TABS" :key="t.to" :to="t.to">
        {{ t.label }}<span v-if="t.to.endsWith('review') && pending" class="badge-n">{{ pending }}</span>
      </RouterLink>
      <span class="grow"></span>
      <span v-if="hasDemo" class="chip demo" title="含 scripts/seed_demo.py 產生的假資料">含示範資料</span>
      <button :disabled="data.loading" @click="data.loadAdmin()">{{ data.loading ? '載入中…' : '重新整理' }}</button>
      <button @click="logout">登出</button>
    </nav>
    <p v-if="data.error" class="err banner">{{ data.error }}</p>
    <main>
      <RouterView v-if="data.segments.length" />
      <p v-else-if="data.loading" class="muted" style="padding: 24px">載入中…</p>
    </main>
  </div>
</template>

<style scoped>
.gate { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 16px; }
.gate form { width: 100%; max-width: 360px; display: flex; flex-direction: column; gap: 10px; }
.admin { height: 100%; display: flex; flex-direction: column; }
nav { display: flex; align-items: center; gap: 4px; padding: 8px 14px; background: var(--card); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.brand { color: var(--primary); margin-right: 4px; }
.site { margin-right: 12px; }
nav a { padding: 6px 12px; border-radius: 8px; text-decoration: none; color: var(--text); }
nav a.router-link-active { background: var(--primary-soft); color: var(--primary); font-weight: 600; }
.badge-n { margin-left: 5px; background: var(--severe); color: #fff; border-radius: 9px; padding: 0 6px; font-size: 11px; }
.banner { margin: 0; padding: 8px 16px; background: #fff1f0; }
main { flex: 1; min-height: 0; overflow: auto; }
</style>
