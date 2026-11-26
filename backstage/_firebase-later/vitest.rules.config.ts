import { defineConfig } from 'vitest/config'

// Security rules 測試：`npm run test:rules`（firebase emulators:exec 會啟動 emulator，需要 Java 21）
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
