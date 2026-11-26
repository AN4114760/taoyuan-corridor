import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 單元測試＋地端伺服器 API 測試（不需要網路或 Firebase）
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
})
