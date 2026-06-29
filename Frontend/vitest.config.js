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
    },
  },
})
