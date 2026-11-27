// 持續定位：整個 App 共用一份（切換分頁不會重新定位）。瀏覽器只在 https 或 localhost 允許定位。
import { ref } from 'vue'

export type GeoStatus = 'idle' | 'locating' | 'tracking' | 'denied' | 'unavailable' | 'insecure'
export interface GeoPos { lat: number; lng: number; accuracy: number }

export const GEO_MESSAGE: Partial<Record<GeoStatus, string>> = {
  locating: '定位中…',
  denied: '定位權限被拒絕，請到手機設定允許瀏覽器使用位置',
  unavailable: '目前抓不到位置，請確認已開啟 GPS',
  insecure: '目前不是 https 連線，無法定位。請改用 https 網址開啟',
}

const status = ref<GeoStatus>('idle')
const pos = ref<GeoPos | null>(null)
let watchId: number | null = null

function start() {
  if (!window.isSecureContext || !('geolocation' in navigator)) { status.value = 'insecure'; return }
  if (watchId != null) navigator.geolocation.clearWatch(watchId)
  status.value = pos.value ? 'tracking' : 'locating'
  watchId = navigator.geolocation.watchPosition(
    (p) => { pos.value = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }; status.value = 'tracking' },
    (e) => { status.value = e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable' },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  )
}

/** 第一次呼叫時開始定位，之後共用 */
export function useGeo() {
  if (status.value === 'idle') start()
  return { status, pos, retry: start }
}

export const formatDistance = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`)

/** Google Maps 步行導航（手機會開 Google Maps App） */
export function walkingUrl(dest: { lat: number; lng: number }, origin?: { lat: number; lng: number } | null) {
  const p = new URLSearchParams({ api: '1', destination: `${dest.lat},${dest.lng}`, travelmode: 'walking' })
  if (origin) p.set('origin', `${origin.lat},${origin.lng}`)
  return `https://www.google.com/maps/dir/?${p}`
}
