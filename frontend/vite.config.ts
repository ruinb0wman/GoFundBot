import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// UI 库源码在仓库外（~/Workspace/ui），dev/build 都直连源码
const uiSrc = fileURLToPath(new URL('../../ui/src', import.meta.url))
const uiEntry = `${uiSrc}/index.ts`
const uiCss = `${uiSrc}/index.css`
const projectRoot = fileURLToPath(new URL('./', import.meta.url))
const uiRoot = fileURLToPath(new URL('../../ui', import.meta.url))
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
  { find: '@ruinb0w/ui/style.css', replacement: uiCss },
  { find: '@ruinb0w/ui', replacement: uiEntry },
]

export default defineConfig({
  plugins: [vue()],
  resolve: { alias },
  server: {
    port: 8517,
    strictPort: true,
    // 源码在仓外：fs.allow 一旦设置就覆盖默认值，项目根要自己列
    fs: { allow: [projectRoot, uiRoot] },
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
