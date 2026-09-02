import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import viteCompression from 'vite-plugin-compression'
import { fileURLToPath } from 'node:url'

const uiEntry = fileURLToPath(new URL('../packages/ui/src/index.ts', import.meta.url))
const uiCss = fileURLToPath(new URL('../packages/ui/src/index.css', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      vue(),
      viteCompression({ algorithm: 'gzip', ext: '.gz', threshold: 1024 }),
      viteCompression({ algorithm: 'brotliCompress', ext: '.br', threshold: 1024 }),
    ],
    resolve: {
      alias: [
        // UI 库直连源码（开发 HMR + 构建 tree-shaking 均从源）
        { find: '@gofund/ui/style.css', replacement: uiCss },
        { find: '@gofund/ui', replacement: uiEntry },
      ],
    },
    server: {
      port: 8517,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_FALLBACK_API_BASE || 'http://localhost:8310',
          changeOrigin: true,
        },
        '/docs': {
          target: 'http://localhost:8574',
          changeOrigin: true,
        },
      },
    },
  }
})
