import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 允許讀取 repo 根目錄的 icons/ 與 data/outputs/（設施圖標、院內大樓名稱）
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    fs: { allow: [repoRoot] },
    host: true,
    proxy: { '/api': 'http://localhost:8787' }, // npm run server
  },
})
