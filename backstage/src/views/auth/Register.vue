<script setup lang="ts">
// App 註冊：手機號碼＋密碼＋稱呼＋身分類別。註冊後為「待開通」，由後台設定志工／錄影權限
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { useAuth } from '@/stores/auth'
import { PARTICIPANT_GROUPS, type ParticipantGroup } from '@/types'

const auth = useAuth()
const router = useRouter()
const phone = ref('')
const password = ref('')
const password2 = ref('')
const name = ref('')
const group = ref<ParticipantGroup>('general')
const busy = ref(false)
const error = ref<string | null>(null)

async function submit() {
  if (password.value !== password2.value) { error.value = '兩次輸入的密碼不一樣'; return }
  busy.value = true
  error.value = null
  try {
    await auth.register({ phone: phone.value, password: password.value, name: name.value, participantGroup: group.value })
    router.replace(auth.home)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="auth">
    <nav><RouterLink to="/login">‹ 登入</RouterLink></nav>
    <h1>註冊帳號</h1>
    <form class="card" @submit.prevent="submit">
      <label>手機號碼<input v-model="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="0912345678" required /></label>
      <label>密碼（至少 6 個字）<input v-model="password" type="password" autocomplete="new-password" minlength="6" required /></label>
      <label>再輸入一次密碼<input v-model="password2" type="password" autocomplete="new-password" minlength="6" required /></label>
      <label>稱呼<input v-model="name" maxlength="40" placeholder="例如：小林" required /></label>
      <label>你是
        <select v-model="group">
          <option v-for="(label, k) in PARTICIPANT_GROUPS" :key="k" :value="k">{{ label }}</option>
        </select>
      </label>
      <p class="muted">註冊後由研究團隊開通志工或錄影權限。</p>
      <p v-if="error" class="err">{{ error }}</p>
      <button class="primary big" :disabled="busy">{{ busy ? '註冊中…' : '註冊' }}</button>
    </form>
  </main>
</template>

<style scoped>
.auth { min-height: 100%; max-width: 420px; margin: 0 auto; padding: calc(16px + env(safe-area-inset-top)) 20px 32px; display: flex; flex-direction: column; gap: 14px; }
nav a { text-decoration: none; font-size: 14px; }
h1 { font-size: 22px; color: var(--primary); }
form { display: flex; flex-direction: column; gap: 12px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
input, select { padding: 11px 12px; font-size: 16px; }
.big { padding: 12px; font-size: 17px; }
form p { margin: 0; }
</style>
