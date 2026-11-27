<script setup lang="ts">
// App 外框：依帳號身分顯示底部分頁（志工：地圖；錄影：上傳；都有：兩個都顯示）
// 待開通（role 0）的帳號只看得到等待畫面與「我的」
import { computed, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

import { useAuth } from '@/stores/auth'
import { ROLE_LABEL } from '@/types'

const auth = useAuth()
const route = useRoute()
const hideTabs = computed(() => route.meta.hideTabs === true)

const tabs = computed(() => [
  ...(auth.isVolunteer ? [{ to: '/app/map', label: '地圖', icon: 'map' }] : []),
  ...(auth.isRecorder ? [{ to: '/app/upload', label: '上傳', icon: 'upload' }] : []),
  ...(auth.pending ? [] : [{ to: '/app/records', label: '紀錄', icon: 'list' }]),
  { to: '/app/me', label: '我的', icon: 'user' },
])

const ICON: Record<string, string> = {
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
}

const refreshing = ref(false)
async function checkAgain() {
  refreshing.value = true
  try { await auth.refresh() } finally { refreshing.value = false }
}
</script>

<template>
  <div class="shell">
    <div class="content">
      <section v-if="auth.pending && route.path !== '/app/me'" class="pending">
        <div class="icon">⏳</div>
        <h2>帳號等待開通</h2>
        <p>{{ auth.user?.name }}，你的帳號已建立，研究團隊開通志工或錄影權限後就可以開始使用。</p>
        <p class="muted">目前身分：{{ ROLE_LABEL[auth.user?.role ?? 0] }}</p>
        <button class="primary" :disabled="refreshing" @click="checkAgain">{{ refreshing ? '確認中…' : '重新確認' }}</button>
      </section>
      <RouterView v-else />
    </div>
    <nav v-if="!hideTabs" class="tabbar">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ICON[t.icon]" /></svg>
        <span>{{ t.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.shell { height: 100dvh; display: flex; flex-direction: column; background: var(--bg); }
.content { flex: 1; min-height: 0; overflow-y: auto; position: relative; }
.tabbar { display: flex; background: var(--card); border-top: 1px solid var(--line); padding-bottom: env(safe-area-inset-bottom); }
.tabbar a { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px 0 6px; color: var(--muted); text-decoration: none; font-size: 11px; }
.tabbar svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.tabbar a.router-link-active { color: var(--primary); font-weight: 600; }
.pending { max-width: 420px; margin: 0 auto; padding: 64px 24px; text-align: center; display: flex; flex-direction: column; gap: 10px; align-items: center; }
.pending .icon { font-size: 48px; }
.pending p { margin: 0; }
</style>
