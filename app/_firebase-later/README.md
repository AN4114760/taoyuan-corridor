# 之後改接 Firebase 用（目前未使用）

11/30 前採用地端版（見 `../README.md`）。這裡保留之前寫好的 Firebase 設定，之後要公開上線時再使用：
- `firestore.rules`、`storage.rules`：Firestore 與 Storage 的存取規則
- `firebase.json`、`firestore.indexes.json`：專案設定與索引
- `capacitor.config.ts`：原生 App 設定
- `src/firebase.ts`、`src/stores/auth.ts`：Firebase 初始化與登入

改接步驟：
1. 建立 Firebase 專案
2. 把 `src/stores/data.ts` 的 `api()` 呼叫改成 Firestore 讀寫。欄位不用改，`types.ts` 已經對齊
3. 照片：可以照現在的做法壓縮成 base64 存在文件裡（不需要 Blaze 方案），也可以改存 Storage
