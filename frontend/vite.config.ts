import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const uiEntry = fileURLToPath(new URL('../packages/ui/src/index.ts', import.meta.url))
const uiCss = fileURLToPath(new URL('../packages/ui/src/index.css', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      // UI 库直连源码（开发 HMR 从源）
      { find: '@gofund/ui/style.css', replacement: uiCss },
      { find: '@gofund/ui', replacement: uiEntry },
    ],
  },
  server: {
    port: 8517,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8310',
        changeOrigin: true,
      },
      '/docs': {
        target: 'http://localhost:8574',
        changeOrigin: true,
      },
    },
  },
})
