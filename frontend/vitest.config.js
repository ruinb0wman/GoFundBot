import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import viteConfig from './vite.config'

// 别名单一真源：直接用 `vite.config.ts` 的 `resolve.alias`
// （以前这里手抄一份，加包别名漏改就会出现「测试里找不到模块」）。
export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.{js,ts}'],
    setupFiles: ['src/__tests__/setup.ts'],
  },
  resolve: {
    alias: viteConfig.resolve.alias,
  },
})
