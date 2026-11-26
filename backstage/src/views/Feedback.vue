<script setup lang="ts">
// 志工回饋（手機網頁）：選路段 → 行經感受 → 有異狀時拍照 → 送出（狀態「待審核」）
import { computed, onMounted, reactive, ref, watch } from 'vue'

import CorridorMap from '@/components/CorridorMap.vue'
import { compressToDataUrl, currentPosition } from '@/lib/image'
import { SITE_ID, useData } from '@/stores/data'
import { CATEGORIES, type Category, LEVEL_COLOR, LEVEL_LABEL, PARTICIPANT_GROUPS, type ParticipantGroup } from '@/types'

const data = useData()
const loadError = ref<string | null>(null)
onMounted(() => data.loadPublic().catch((e) => { loadError.value = e.message }))

const remember = (k: string, fallback = '') => { try { return localStorage.getItem(k) ?? fallback } catch { return fallback } }
const name = ref(remember('volunteerName'))
const group = ref<ParticipantGroup>(remember('participantGroup', 'general') as ParticipantGroup)
watch([name, group], () => { try { localStorage.setItem('volunteerName', name.value); localStorage.setItem('participantGroup', group.value) } catch { /* 無痕模式 */ } })

const picked = ref<{ lat: number; lng: number } | null>(null)
const match = computed(() => (picked.value ? data.matchSegment(picked.value.lat, picked.value.lng) : null))
const seg = computed(() => (match.value ? data.segmentById.get(match.value.id) ?? null : null))
const locating = ref(false)
const locError = ref<string | null>(null)
const map = ref<InstanceType<typeof CorridorMap>>()

async function useGps() {
  locating.value = true
  locError.value = null
  try {
    const p = await currentPosition()
    picked.value = { lat: p.coords.latitude, lng: p.coords.longitude }
    map.value?.flyTo(picked.value.lat, picked.value.lng)
  } catch (e) {
    locError.value = (e as GeolocationPositionError).code === 1 ? '定位權限被拒絕，請在地圖上點選位置' : (e as Error).message
  } finally {
    locating.value = false
  }
}

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
  const files = [...(input.files ?? [])].filter((f) => f.type.startsWith('image/'))
  for (const f of files) {
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
  if (!seg.value) p.push('在地圖上選擇路段')
  if (!safety.value) p.push('選擇安全感')
  if (!comfort.value) p.push('選擇舒適度')
  if (anomalies.some((a) => !a.category)) p.push('選擇異狀類別')
  return p
})

async function submit() {
  if (problems.value.length || !seg.value || !picked.value) return
  submitting.value = true
  submitError.value = null
  try {
    const payload = await Promise.all(anomalies.map(async (a) => ({
      category: a.category, note: a.note, photos: await Promise.all(a.files.map(compressToDataUrl)),
    })))
    await data.submitFeedback({
      volunteerName: name.value.trim(), participantGroup: group.value, segId: seg.value.id,
      lat: picked.value.lat, lng: picked.value.lng, safety: safety.value, comfort: comfort.value,
      comment: comment.value.trim(), anomalies: payload,
    })
    done.value = true
    window.scrollTo({ top: 0 })
  } catch (e) {
    submitError.value = (e as Error).message
  } finally {
    submitting.value = false
  }
}

function again() {
  picked.value = null
  safety.value = comfort.value = 0
  comment.value = ''
  while (anomalies.length) removeAnomaly(0)
  done.value = false
}
</script>

<template>
  <main class="fb">
    <header>
      <h1>無障礙廊道・志工回饋</h1>
      <p class="muted">衛福部桃園醫院周邊 500m｜走過一段路，告訴我們感受；看到異狀請拍照</p>
    </header>

    <section v-if="done" class="card done">
      <h2>已送出，謝謝！</h2>
      <p>回饋會由研究團隊複查。</p>
      <button class="primary" @click="again">再填一段路</button>
    </section>

    <template v-else>
      <section class="card">
        <h2>1. 你是誰</h2>
        <label>稱呼（選填）<input v-model="name" maxlength="40" placeholder="例如：志工 小林" /></label>
        <label>身分
          <select v-model="group">
            <option v-for="(label, k) in PARTICIPANT_GROUPS" :key="k" :value="k">{{ label }}</option>
          </select>
        </label>
      </section>

      <section class="card">
        <h2>2. 走過哪一段路</h2>
        <p class="muted">點地圖上有顏色的路段；有 GPS 可以直接定位。</p>
        <div class="map">
          <p v-if="loadError" class="err">{{ loadError }}</p>
          <CorridorMap v-else-if="data.segments.length" ref="map" :segments="data.segments" :features="data.features"
            :site-id="SITE_ID" pick-mode :picked="picked" :selected-id="seg?.id ?? null" @pick="picked = $event" />
        </div>
        <div class="row" style="margin-top: 8px">
          <button :disabled="locating" @click="useGps">{{ locating ? '定位中…' : '📍 用目前位置' }}</button>
          <span v-if="locError" class="muted">{{ locError }}</span>
        </div>
        <div v-if="seg" class="picked">
          <span class="lvl" :style="{ background: LEVEL_COLOR[seg.level] }"></span>
          <b>{{ seg.road_name || '未命名道路' }}</b>
          <span v-if="seg.from || seg.to">（{{ seg.from || '?' }} → {{ seg.to || '?' }}）</span>
          <span class="muted">・{{ LEVEL_LABEL[seg.level] }}</span>
        </div>
        <p v-else-if="picked" class="err">這個位置 25m 內沒有路段，請點在有顏色的路段上</p>
      </section>

      <section class="card">
        <h2>3. 行經感受</h2>
        <div class="scale">
          <span>安全感</span>
          <div class="opts">
            <button v-for="n in 5" :key="n" :class="{ on: safety === n }" @click="safety = n">{{ n }}<small>{{ SCALE[n - 1] }}</small></button>
          </div>
        </div>
        <div class="scale">
          <span>舒適度</span>
          <div class="opts">
            <button v-for="n in 5" :key="n" :class="{ on: comfort === n }" @click="comfort = n">{{ n }}<small>{{ SCALE[n - 1] }}</small></button>
          </div>
        </div>
        <textarea v-model="comment" rows="3" maxlength="1000" placeholder="走起來的感覺（選填），例如：樹穴太大，輪椅要下車道"></textarea>
      </section>

      <section class="card">
        <h2>4. 有異狀嗎？（選填）</h2>
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
              <button @click="removePhoto(a, j)" aria-label="移除照片">×</button>
            </div>
            <label v-if="a.files.length < 3" class="add-photo">
              📷 拍照／選照片
              <input type="file" accept="image/*" capture="environment" multiple @change="onPhotos(a, $event)" />
            </label>
          </div>
          <input v-model="a.note" maxlength="500" placeholder="說明（選填）" style="width: 100%" />
        </div>
        <button @click="addAnomaly">＋ 新增異狀</button>
      </section>

      <section class="submit">
        <p v-if="problems.length" class="muted">還需要：{{ problems.join('、') }}</p>
        <p v-if="submitError" class="err">{{ submitError }}</p>
        <button class="primary big" :disabled="!!problems.length || submitting" @click="submit">
          {{ submitting ? '送出中…' : '送出回饋' }}
        </button>
      </section>
    </template>
  </main>
</template>

<style scoped>
.fb { max-width: 640px; margin: 0 auto; padding: 16px 16px 48px; display: flex; flex-direction: column; gap: 12px; }
header h1 { font-size: 20px; color: var(--primary); }
header p { margin: 4px 0 0; }
.card { display: flex; flex-direction: column; gap: 10px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.map { height: 50vh; min-height: 300px; border-radius: 10px; overflow: hidden; border: 1px solid var(--line); }
.picked { background: var(--primary-soft); border-radius: 8px; padding: 8px 10px; }
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
.add-photo { width: 84px; height: 84px; border: 1.5px dashed #9ca3af; border-radius: 8px; align-items: center; justify-content: center; text-align: center; font-size: 12px; color: var(--muted); cursor: pointer; }
.add-photo input { display: none; }
.submit { display: flex; flex-direction: column; gap: 6px; }
.big { padding: 12px; font-size: 17px; }
.done { text-align: center; align-items: center; }
</style>
