import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import viteCompression from 'vite-plugin-compression'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      vue(),
      viteCompression({ algorithm: 'gzip', ext: '.gz', threshold: 1024 }),
      viteCompression({ algorithm: 'brotliCompress', ext: '.br', threshold: 1024 }),
    ],
    server: {
      proxy: {
        '/api': {
          target: env.VITE_FALLBACK_API_BASE || 'http://localhost:5000',
          changeOrigin: true,
        },
        '/sqlite-admin': {
          target: env.VITE_FALLBACK_API_BASE || 'http://localhost:5000',
          changeOrigin: true,
        },
      },
    },
  }
})
