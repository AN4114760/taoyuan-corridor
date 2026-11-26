<script setup lang="ts">
// 我的：帳號資料、身分（後台設定，這裡只能看）、修改稱呼與身分類別、登出
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { useAuth } from '@/stores/auth'
import { PARTICIPANT_GROUPS, type ParticipantGroup, ROLE_LABEL } from '@/types'

const auth = useAuth()
const router = useRouter()
const editing = ref(false)
const name = ref('')
const group = ref<ParticipantGroup>('general')
const error = ref<string | null>(null)

function edit() {
  name.value = auth.user?.name ?? ''
  group.value = auth.user?.participantGroup ?? 'general'
  editing.value = true
}
async function save() {
  error.value = null
  try {
    await auth.update({ name: name.value, participantGroup: group.value })
    editing.value = false
  } catch (e) { error.value = (e as Error).message }
}
function logout() {
  auth.logout()
  router.replace('/login')
}
const masked = (p?: string) => (p ? `${p.slice(0, 4)}***${p.slice(-3)}` : '')
</script>

<template>
  <main class="page">
    <header class="title"><h1>我的</h1></header>
    <section class="card profile">
      <div class="avatar">{{ auth.user?.name.slice(0, 1) }}</div>
      <div class="grow">
        <b>{{ auth.user?.name }}</b>
        <small class="muted block">{{ masked(auth.user?.phone) }}</small>
      </div>
      <span class="chip role">{{ ROLE_LABEL[auth.user?.role ?? 0] }}</span>
    </section>

    <section v-if="!editing" class="card list">
      <div class="row"><span class="grow muted">身分類別</span>{{ auth.user ? PARTICIPANT_GROUPS[auth.user.participantGroup] : '' }}</div>
      <div class="row"><span class="grow muted">帳號權限</span>{{ ROLE_LABEL[auth.user?.role ?? 0] }}</div>
      <p class="muted small">帳號權限由研究團隊設定；需要調整請聯絡研究團隊。</p>
      <button @click="edit">修改稱呼與身分類別</button>
    </section>

    <section v-else class="card list">
      <label>稱呼<input v-model="name" maxlength="40" /></label>
      <label>身分類別
        <select v-model="group"><option v-for="(label, k) in PARTICIPANT_GROUPS" :key="k" :value="k">{{ label }}</option></select>
      </label>
      <p v-if="error" class="err">{{ error }}</p>
      <div class="row"><button class="primary" @click="save">儲存</button><button @click="editing = false">取消</button></div>
    </section>

    <button class="logout" @click="logout">登出</button>
  </main>
</template>

<style scoped>
.page { max-width: 640px; margin: 0 auto; padding: 0 14px 24px; display: flex; flex-direction: column; gap: 12px; }
.title { padding: calc(16px + env(safe-area-inset-top)) 2px 0; }
.title h1 { font-size: 22px; }
.profile { display: flex; align-items: center; gap: 12px; }
.avatar { width: 52px; height: 52px; border-radius: 50%; background: var(--primary); color: #fff; font-size: 22px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.profile b { font-size: 18px; }
.block { display: block; }
.role { background: var(--primary-soft); color: var(--primary); }
.list { display: flex; flex-direction: column; gap: 10px; }
.list p { margin: 0; }
.small { font-size: 12px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.logout { color: var(--severe); padding: 12px; border-radius: 10px; }
</style>
