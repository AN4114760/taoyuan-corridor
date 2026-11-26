// Firebase：只用 Storage 存錄影人員的影片檔（影片太大，不放地端伺服器）。紀錄、帳號都在地端伺服器。
// 沒有設定 VITE_FIREBASE_* 時不初始化，上傳頁會顯示「尚未設定」，其他功能不受影響。
import { initializeApp } from 'firebase/app'
import { type Auth, browserLocalPersistence, indexedDBLocalPersistence, initializeAuth } from 'firebase/auth'
import { type FirebaseStorage, getStorage } from 'firebase/storage'

const env = import.meta.env

export const firebaseConfigured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_STORAGE_BUCKET)

let services: { auth: Auth; storage: FirebaseStorage } | null = null

export function firebase() {
  if (!firebaseConfigured) throw new Error('尚未設定 Firebase（backstage/.env.local 的 VITE_FIREBASE_*）')
  if (!services) {
    const app = initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    })
    services = {
      auth: initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] }),
      storage: getStorage(app),
    }
  }
  return services
}
