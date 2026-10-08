import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const uiEntry = fileURLToPath(new URL('../packages/ui/src/index.ts', import.meta.url))
const uiCss = fileURLToPath(new URL('../packages/ui/src/index.css', import.meta.url))
const coreSrc = fileURLToPath(new URL('../packages/core/src', import.meta.url))
const srcDir = fileURLToPath(new URL('./src', import.meta.url))

/**
 * 别名**只在这里定义**：`vitest.config.js` 直接读 `resolve.alias`，
 * `tsconfig.json` 的 `paths` 仍需同步（TS 类型解析不走 Vite）。加包别名时改两处即可。
 */
const alias = [
  { find: '@', replacement: srcDir },
  // 共享计算内核直连源码（顺序：带斜杠的先匹配，最后的精确别名留给包入口）
  { find: '@gofund/core/', replacement: `${coreSrc}/` },
  { find: '@gofund/core', replacement: `${coreSrc}/index.ts` },
  // UI 库直连源码（开发 HMR 从源）
  { find: '@gofund/ui/style.css', replacement: uiCss },
  { find: '@gofund/ui', replacement: uiEntry },
]

export default defineConfig({
  plugins: [vue()],
  resolve: { alias },
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
