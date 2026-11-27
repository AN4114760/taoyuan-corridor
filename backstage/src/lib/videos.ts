// 錄影上傳：影片檔傳到 Firebase Storage（可續傳、有進度、可取消），傳完拿到下載網址，
// 再把紀錄登記到地端伺服器（/api/me/videos，跟著 App 帳號）。規則見 backstage/firebase/storage.rules。
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth'
import { getDownloadURL, ref as storageRef, uploadBytesResumable, type UploadTask } from 'firebase/storage'

import { firebase } from './firebase'

/** 影片大小上限（storage.rules 也有同樣限制） */
export const MAX_VIDEO_BYTES = 4 * 1024 ** 3

/** Firebase 匿名登入（只為了通過 Storage 規則；誰上傳的以 App 帳號為準） */
export async function ensureFirebaseUser(): Promise<User> {
  const { auth } = firebase()
  const u = await new Promise<User | null>((resolve) => { const off = onAuthStateChanged(auth, (x) => { off(); resolve(x) }) })
  return u ?? (await signInAnonymously(auth)).user
}

export interface UploadHandle { task: UploadTask; done: Promise<{ storagePath: string; downloadUrl: string }> }

export function uploadVideoFile(fbUser: User, file: File, onProgress: (ratio: number) => void): UploadHandle {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const storagePath = `videos/${fbUser.uid}/${id}/${file.name.replace(/[/\\#?]/g, '_')}`
  const ref = storageRef(firebase().storage, storagePath)
  const task = uploadBytesResumable(ref, file, { contentType: file.type || 'video/mp4' })
  const done = new Promise<{ storagePath: string; downloadUrl: string }>((resolve, reject) => {
    task.on('state_changed', (s) => onProgress(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0), reject,
      () => getDownloadURL(ref).then((downloadUrl) => resolve({ storagePath, downloadUrl }), reject))
  })
  return { task, done }
}
