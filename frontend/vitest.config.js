import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.{js,ts}'],
    setupFiles: ['src/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // 共享计算内核（更长/更具体的 key 先匹配）
      '@gofund/core/': resolve(__dirname, '../packages/core/src') + '/',
      '@gofund/core': resolve(__dirname, '../packages/core/src/index.ts'),
      '@gofund/ui': resolve(__dirname, '../packages/ui/src/index.ts'),
      '@gofund/ui/style.css': resolve(__dirname, '../packages/ui/src/index.css'),
    },
  },
})
