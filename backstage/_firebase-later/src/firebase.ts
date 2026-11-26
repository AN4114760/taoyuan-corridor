import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence, connectAuthEmulator, indexedDBLocalPersistence, inMemoryPersistence, initializeAuth,
} from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

const env = import.meta.env

export const firebaseApp = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})

// Capacitor 的 WKWebView 裡 indexedDB 偶爾會卡住不回應，依序退回其他儲存方式
export const auth = initializeAuth(firebaseApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
})
export const db = getFirestore(firebaseApp)
export const storage = getStorage(firebaseApp)

export const SITE_ID: string = env.VITE_SITE_ID || 'taoyuan_hospital'
export const USING_EMULATOR = env.VITE_USE_EMULATOR === '1'

if (USING_EMULATOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
}
