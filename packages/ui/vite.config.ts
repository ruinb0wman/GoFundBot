import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
    vue(),
    dts({
      entryRoot: 'src',
      tsconfigPath: './tsconfig.json',
      insertTypesEntry: true,
      cleanVueFileName: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      // 保留组件级 chunk，支持按需导入（tree-shaking）
      external: ['vue', /@lucide\/vue/, /^@gofund\/ui\/.*/],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: (chunk) => {
          // 去除 Vue SFC 产生的 .vue / .vue2 后缀，产出干净文件名（BButton.js）
          return chunk.name.replace(/\.vue2?$/, '') + '.js'
        },
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? ''
          if (name.endsWith('.css')) return 'style.css'
          return '[name][extname]'
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
})
