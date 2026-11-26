<script setup lang="ts">
// 帳號：開通志工／錄影權限（role 0–3）、重設密碼。待開通的排最前面
import { computed, onMounted, ref } from 'vue'

import { api } from '@/lib/api'
import { type AppUser, PARTICIPANT_GROUPS, type Role, ROLE_LABEL } from '@/types'

const users = ref<AppUser[] | null>(null)
const error = ref<string | null>(null)
const q = ref('')
const onlyPending = ref(false)
const saving = ref<string | null>(null)

async function load() {
  error.value = null
  try { users.value = await api<AppUser[]>('users', { admin: true }) } catch (e) { error.value = (e as Error).message }
}
onMounted(load)

const rows = computed(() => (users.value ?? [])
  .filter((u) => (!onlyPending.value || u.role === 0) && (!q.value || `${u.name} ${u.phone}`.includes(q.value)))
  .sort((a, b) => Number(b.role === 0) - Number(a.role === 0) || b.createdAt.localeCompare(a.createdAt)))
const pendingCount = computed(() => (users.value ?? []).filter((u) => u.role === 0).length)

async function setRole(u: AppUser, role: Role) {
  saving.value = u.id
  try {
    const updated = await api<AppUser>(`users/${u.id}`, { method: 'PATCH', admin: true, body: { role } })
    Object.assign(u, updated)
  } catch (e) { error.value = (e as Error).message } finally { saving.value = null }
}

async function resetPassword(u: AppUser) {
  const pw = prompt(`為「${u.name}」（${u.phone}）設定新密碼（至少 6 個字）：`)
  if (!pw) return
  try {
    await api(`users/${u.id}`, { method: 'PATCH', admin: true, body: { password: pw } })
    alert('已重設，請把新密碼告訴對方')
  } catch (e) { alert((e as Error).message) }
}

const fmt = (iso: string) => new Date(iso).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })
const ROLES: Role[] = [0, 1, 2, 3]
</script>

<template>
  <div class="page">
    <div class="row">
      <h2 class="grow">帳號（{{ users?.length ?? 0 }}）<span v-if="pendingCount" class="chip new">待開通 {{ pendingCount }}</span></h2>
      <label class="row"><input v-model="onlyPending" type="checkbox" />只看待開通</label>
      <input v-model="q" placeholder="搜尋稱呼、手機" />
      <button @click="load">重新整理</button>
    </div>
    <p class="muted">志工、錄影人員用手機註冊後是「待開通」，在這裡選身分後才能使用：1 志工（走訪回饋）、2 錄影人員（上傳影片）、3 兩者都有。</p>
    <p v-if="error" class="err">{{ error }}</p>

    <div class="card list">
      <p v-if="!users" class="muted">載入中…</p>
      <table v-else>
        <thead><tr><th>稱呼</th><th>手機</th><th>身分類別</th><th>註冊時間</th><th>回饋</th><th>影片</th><th>帳號權限</th><th></th></tr></thead>
        <tbody>
          <tr v-for="u in rows" :key="u.id" :class="{ pending: u.role === 0 }">
            <td><b>{{ u.name }}</b></td>
            <td>{{ u.phone }}</td>
            <td>{{ PARTICIPANT_GROUPS[u.participantGroup] }}</td>
            <td>{{ fmt(u.createdAt) }}</td>
            <td>{{ u.feedbackCount ?? 0 }}</td>
            <td>{{ u.videoCount ?? 0 }}</td>
            <td>
              <select :value="u.role" :disabled="saving === u.id" @change="setRole(u, Number(($event.target as HTMLSelectElement).value) as Role)">
                <option v-for="r in ROLES" :key="r" :value="r">{{ r }}｜{{ ROLE_LABEL[r] }}</option>
              </select>
            </td>
            <td><button @click="resetPassword(u)">重設密碼</button></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="8" class="muted">沒有帳號</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.page > p { margin: 0; }
h2 .chip { margin-left: 8px; vertical-align: 2px; }
.list { overflow-x: auto; padding: 0; }
tr.pending { background: #f0f5ff; }
td { white-space: nowrap; }
</style>
