<script setup lang="ts">
// App 登入：手機號碼＋密碼
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { useAuth } from '@/stores/auth'

const auth = useAuth()
const router = useRouter()
const route = useRoute()
const phone = ref('')
const password = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

async function submit() {
  busy.value = true
  error.value = null
  try {
    await auth.login(phone.value, password.value)
    const to = String(route.query.redirect ?? '')
    router.replace(to.startsWith('/app') ? to : auth.home)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="auth">
    <div class="brand">
      <div class="logo">♿</div>
      <h1>無障礙廊道</h1>
      <p class="muted">衛福部桃園醫院周邊｜一起找出不好走的人行道</p>
    </div>
    <form class="card" @submit.prevent="submit">
      <label>手機號碼<input v-model="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="0912345678" required /></label>
      <label>密碼<input v-model="password" type="password" autocomplete="current-password" required /></label>
      <p v-if="error" class="err">{{ error }}</p>
      <button class="primary big" :disabled="busy">{{ busy ? '登入中…' : '登入' }}</button>
    </form>
    <p class="switch">還沒有帳號？<RouterLink to="/register">註冊</RouterLink></p>
    <p class="muted forgot">忘記密碼請聯絡研究團隊重設</p>
  </main>
</template>

<style scoped>
.auth { min-height: 100%; max-width: 420px; margin: 0 auto; padding: calc(40px + env(safe-area-inset-top)) 20px 32px; display: flex; flex-direction: column; gap: 16px; }
.brand { text-align: center; }
.logo { width: 64px; height: 64px; margin: 0 auto 10px; border-radius: 18px; background: var(--primary); color: #fff; font-size: 34px; display: flex; align-items: center; justify-content: center; }
.brand h1 { font-size: 24px; color: var(--primary); }
.brand p { margin: 4px 0 0; }
form { display: flex; flex-direction: column; gap: 12px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
input { padding: 11px 12px; font-size: 16px; }
.big { padding: 12px; font-size: 17px; }
.switch, .forgot { text-align: center; margin: 0; }
</style>
