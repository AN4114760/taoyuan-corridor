<script setup lang="ts">
// 走訪中：走完這段路後填行經感受、拍異狀 → 送出（狀態「待審核」），連同開始時的定位檢查一起送
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { distanceToSegment } from '@/lib/geo'
import { formatDistance, useGeo } from '@/lib/geolocation'
import { compressToDataUrl } from '@/lib/image'
import { useAuth } from '@/stores/auth'
import { useData } from '@/stores/data'
import { useWalk } from '@/stores/walk'
import { CATEGORIES, type Category, LEVEL_COLOR, LEVEL_LABEL, PARTICIPANT_GROUPS, type ParticipantGroup } from '@/types'

const route = useRoute()
const router = useRouter()
const data = useData()
const auth = useAuth()
const walk = useWalk()
const { pos } = useGeo()
onMounted(() => data.loadPublic())

const segId = String(route.params.segId)
const seg = computed(() => data.segmentById.get(segId) ?? null)
const started = computed(() => walk.current?.segId === segId ? walk.current : null)
const distNow = computed(() => (seg.value && pos.value ? distanceToSegment(pos.value.lat, pos.value.lng, seg.value) : null))
const startedAt = computed(() => started.value ? new Date(started.value.startedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '')

const group = ref<ParticipantGroup>(auth.user?.participantGroup ?? 'general')
const safety = ref(0)
const comfort = ref(0)
const comment = ref('')
const SCALE = ['很差', '差', '普通', '好', '很好']

interface AnomalyDraft { category: Category | ''; note: string; files: File[]; previews: string[] }
const anomalies = reactive<AnomalyDraft[]>([])
const addAnomaly = () => anomalies.push({ category: '', note: '', files: [], previews: [] })
function removeAnomaly(i: number) {
  anomalies[i].previews.forEach(URL.revokeObjectURL)
  anomalies.splice(i, 1)
}
function onPhotos(a: AnomalyDraft, ev: Event) {
  const input = ev.target as HTMLInputElement
  for (const f of [...(input.files ?? [])].filter((x) => x.type.startsWith('image/'))) {
    if (a.files.length >= 3) break
    a.files.push(f)
    a.previews.push(URL.createObjectURL(f))
  }
  input.value = ''
}
function removePhoto(a: AnomalyDraft, i: number) {
  URL.revokeObjectURL(a.previews[i])
  a.files.splice(i, 1)
  a.previews.splice(i, 1)
}

const submitting = ref(false)
const submitError = ref<string | null>(null)
const done = ref(false)
const problems = computed(() => {
  const p: string[] = []
  if (!safety.value) p.push('選擇安全感')
  if (!comfort.value) p.push('選擇舒適度')
  if (anomalies.some((a) => !a.category)) p.push('選擇異狀類別')
  return p
})

async function submit() {
  const w = started.value
  if (problems.value.length || !w) return
  submitting.value = true
  submitError.value = null
  try {
    const payload = await Promise.all(anomalies.map(async (a) => ({
      category: a.category, note: a.note, photos: await Promise.all(a.files.map(compressToDataUrl)),
    })))
    // 回饋位置：送出當下的位置；沒有定位時用開始位置
    const here = pos.value ?? { lat: w.startLat, lng: w.startLng }
    await data.submitFeedback({
      participantGroup: group.value, segId, lat: here.lat, lng: here.lng, safety: safety.value, comfort: comfort.value,
      comment: comment.value.trim(), anomalies: payload,
      walk: { startedAt: w.startedAt, startLat: w.startLat, startLng: w.startLng, startDistanceM: w.startDistanceM, startAccuracyM: w.startAccuracyM },
    })
    walk.finish()
    done.value = true
    window.scrollTo({ top: 0 })
  } catch (e) {
    submitError.value = (e as Error).message
  } finally {
    submitting.value = false
  }
}

function giveUp() {
  if (!confirm('放棄這次走訪？填寫的內容不會保存。')) return
  walk.finish()
  router.replace('/app/map')
}
</script>

<template>
  <main class="walk">
    <header class="bar">
      <RouterLink to="/app/map">‹ 地圖</RouterLink>
      <b>走訪回饋</b>
      <span></span>
    </header>

    <section v-if="done" class="card done">
      <div class="big-icon">✅</div>
      <h2>已送出，謝謝！</h2>
      <p class="muted">研究團隊複查後，結果會顯示在「紀錄」。</p>
      <RouterLink to="/app/map" class="btn primary">回地圖找下一段</RouterLink>
      <RouterLink to="/app/records" class="btn">查看紀錄</RouterLink>
    </section>

    <section v-else-if="!started" class="card">
      <h2>還沒開始這段路</h2>
      <p class="muted">請回到地圖，走到路段 50 m 內按「開始走這段」。</p>
      <RouterLink to="/app/map" class="btn primary">回地圖</RouterLink>
    </section>

    <template v-else>
      <section class="card seg">
        <div class="row">
          <span class="pill" :style="{ background: seg ? LEVEL_COLOR[seg.level] : '#999' }">{{ seg ? LEVEL_LABEL[seg.level] : '' }}</span>
          <h2>{{ seg?.road_name || '未命名道路' }}</h2>
        </div>
        <p v-if="seg?.from || seg?.to" class="muted">{{ seg?.from || '?' }} → {{ seg?.to || '?' }}</p>
        <p class="muted">{{ startedAt }} 開始（距離路段 {{ formatDistance(started.startDistanceM) }}）{{ distNow != null ? `・目前距離 ${formatDistance(distNow)}` : '' }}</p>
      </section>

      <section class="card">
        <h3>行經感受</h3>
        <label class="inline">這次以什麼身分走
          <select v-model="group"><option v-for="(label, k) in PARTICIPANT_GROUPS" :key="k" :value="k">{{ label }}</option></select>
        </label>
        <div class="scale">
          <span>安全感</span>
          <div class="opts"><button v-for="n in 5" :key="n" :class="{ on: safety === n }" @click="safety = n">{{ n }}<small>{{ SCALE[n - 1] }}</small></button></div>
        </div>
        <div class="scale">
          <span>舒適度</span>
          <div class="opts"><button v-for="n in 5" :key="n" :class="{ on: comfort === n }" @click="comfort = n">{{ n }}<small>{{ SCALE[n - 1] }}</small></button></div>
        </div>
        <textarea v-model="comment" rows="3" maxlength="1000" placeholder="走起來的感覺（選填），例如：樹穴太大，輪椅要下車道"></textarea>
      </section>

      <section class="card">
        <h3>有異狀嗎？（選填）</h3>
        <div v-for="(a, i) in anomalies" :key="i" class="anomaly">
          <div class="row">
            <select v-model="a.category" class="grow">
              <option value="" disabled>選擇類別</option>
              <option v-for="(label, k) in CATEGORIES" :key="k" :value="k">{{ label }}</option>
            </select>
            <button class="danger" @click="removeAnomaly(i)">刪除</button>
          </div>
          <div class="photos">
            <div v-for="(src, j) in a.previews" :key="src" class="thumb">
              <img :src="src" alt="" />
              <button aria-label="移除照片" @click="removePhoto(a, j)">×</button>
            </div>
            <label v-if="a.files.length < 3" class="add-photo">📷<br />拍照
              <input type="file" accept="image/*" capture="environment" multiple @change="onPhotos(a, $event)" />
            </label>
          </div>
          <input v-model="a.note" maxlength="500" placeholder="說明（選填）" />
        </div>
        <button @click="addAnomaly">＋ 新增異狀</button>
      </section>

      <section class="submit">
        <p v-if="problems.length" class="muted">還需要：{{ problems.join('、') }}</p>
        <p v-if="submitError" class="err">{{ submitError }}</p>
        <button class="primary big" :disabled="!!problems.length || submitting" @click="submit">{{ submitting ? '送出中…' : '送出回饋' }}</button>
        <button class="link" @click="giveUp">放棄這次走訪</button>
      </section>
    </template>
  </main>
</template>

<style scoped>
.walk { max-width: 640px; margin: 0 auto; padding: 0 14px 32px; display: flex; flex-direction: column; gap: 12px; }
.bar { position: sticky; top: 0; z-index: 10; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: calc(12px + env(safe-area-inset-top)) 2px 10px; background: var(--bg); }
.bar a { text-decoration: none; }
.card { display: flex; flex-direction: column; gap: 10px; }
.card p { margin: 0; }
.seg h2 { font-size: 18px; }
.pill { color: #fff; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 10px; text-shadow: 0 0 2px rgba(0, 0, 0, .35); }
.inline { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.scale { display: flex; flex-direction: column; gap: 6px; }
.opts { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.opts button { display: flex; flex-direction: column; align-items: center; padding: 8px 0; font-size: 18px; font-weight: 600; }
.opts small { font-size: 11px; font-weight: 400; color: var(--muted); }
.opts button.on { background: var(--primary); border-color: var(--primary); color: #fff; }
.opts button.on small { color: #dbe3ff; }
.anomaly { border: 1px dashed #cfd4dc; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.photos { display: flex; gap: 8px; flex-wrap: wrap; }
.thumb { position: relative; width: 84px; height: 84px; }
.thumb img { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; }
.thumb button { position: absolute; top: -6px; right: -6px; width: 24px; height: 24px; padding: 0; border-radius: 12px; background: #111; color: #fff; border: 0; }
.add-photo { width: 84px; height: 84px; border: 1.5px dashed #9ca3af; border-radius: 8px; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 12px; color: var(--muted); cursor: pointer; }
.add-photo input { display: none; }
.submit { display: flex; flex-direction: column; gap: 6px; }
.submit p { margin: 0; }
.big { padding: 13px; font-size: 17px; border-radius: 10px; }
button.link { border: 0; background: none; color: var(--muted); }
.done { text-align: center; align-items: center; padding: 32px 16px; }
.big-icon { font-size: 44px; }
.btn { display: block; width: 100%; padding: 12px; border-radius: 10px; border: 1px solid var(--line); text-decoration: none; color: var(--text); text-align: center; }
.btn.primary { background: var(--primary); border-color: var(--primary); color: #fff; }
</style>
