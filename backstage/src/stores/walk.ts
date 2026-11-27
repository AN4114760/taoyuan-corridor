// 目前正在走的路段：按下「開始走這段」時記錄定位檢查結果，送出回饋時一起送。
// 存在 sessionStorage，走到一半重新整理頁面不會遺失。
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface WalkStart {
  segId: string
  startedAt: string
  startLat: number
  startLng: number
  startDistanceM: number
  startAccuracyM: number
}

/** 開始走一段路時，與路段的距離上限（公尺；伺服器也會檢查） */
export const WALK_START_RADIUS_M = 50

const KEY = 'currentWalk'
const restore = (): WalkStart | null => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') } catch { return null } }

export const useWalk = defineStore('walk', () => {
  const current = ref<WalkStart | null>(restore())
  watch(current, (v) => {
    try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY) } catch { /* 無痕模式 */ }
  })
  return { current, start: (w: WalkStart) => { current.value = w }, finish: () => { current.value = null } }
})
