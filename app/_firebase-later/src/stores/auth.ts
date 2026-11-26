import { GoogleAuthProvider, onAuthStateChanged, signInAnonymously, signInWithPopup, signOut, type User } from 'firebase/auth'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { auth } from '@/firebase'

export const useAuth = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const isAdmin = ref(false)
  const ready = ref(false)
  let readyPromise: Promise<void> | null = null

  function init() {
    if (readyPromise) return readyPromise
    readyPromise = new Promise((resolve) => {
      onAuthStateChanged(auth, async (u) => {
        user.value = u
        isAdmin.value = u ? (await u.getIdTokenResult()).claims.admin === true : false
        ready.value = true
        resolve()
      })
    })
    return readyPromise
  }

  /** 民眾端：匿名登入（回報需要 uid，不需要帳號） */
  async function ensureSignedIn() {
    await init()
    if (!auth.currentUser) await signInAnonymously(auth)
    return auth.currentUser!
  }

  /** 後台：Google 登入；admin 權限由 scripts/set_admin.py 設定 custom claim */
  async function signInAdmin() {
    const cred = await signInWithPopup(auth, new GoogleAuthProvider())
    isAdmin.value = (await cred.user.getIdTokenResult(true)).claims.admin === true
    return isAdmin.value
  }

  return { user, isAdmin, ready, init, ensureSignedIn, signInAdmin, signOut: () => signOut(auth) }
})
