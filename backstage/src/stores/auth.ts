// App 帳號：手機號碼＋密碼登入，token 存在手機；身分（role）由後台設定
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { api, ApiError, getToken, setToken } from '@/lib/api'
import { type AppUser, canRecord, canVolunteer, type ParticipantGroup } from '@/types'

export const useAuth = defineStore('auth', () => {
  const user = ref<AppUser | null>(null)
  const ready = ref(false)

  const isVolunteer = computed(() => canVolunteer(user.value?.role))
  const isRecorder = computed(() => canRecord(user.value?.role))
  const pending = computed(() => user.value?.role === 0)
  /** 登入後的第一個分頁 */
  const home = computed(() => (isVolunteer.value ? '/app/map' : isRecorder.value ? '/app/upload' : '/app/me'))

  /** 啟動時用手機上的 token 取回帳號；失效就清掉 */
  async function init() {
    if (ready.value) return
    if (getToken()) {
      try { user.value = await api<AppUser>('me', { user: true }) } catch (e) {
        if (e instanceof ApiError && e.status === 401) setToken(null)
      }
    }
    ready.value = true
  }

  /** 重新取帳號（例如等待後台開通時按「重新整理」） */
  async function refresh() {
    user.value = await api<AppUser>('me', { user: true })
  }

  async function login(phone: string, password: string) {
    const r = await api<{ token: string; user: AppUser }>('auth/login', { method: 'POST', body: { phone, password } })
    setToken(r.token)
    user.value = r.user
  }

  async function register(input: { phone: string; password: string; name: string; participantGroup: ParticipantGroup }) {
    const r = await api<{ token: string; user: AppUser }>('auth/register', { method: 'POST', body: input })
    setToken(r.token)
    user.value = r.user
  }

  async function update(patch: { name?: string; participantGroup?: ParticipantGroup }) {
    user.value = await api<AppUser>('me', { method: 'PATCH', body: patch, user: true })
  }

  function logout() {
    setToken(null)
    user.value = null
  }

  return { user, ready, isVolunteer, isRecorder, pending, home, init, refresh, login, register, update, logout }
})
