import { defineStore } from 'pinia'

/**
 * 文档面板状态（主窗口内嵌 iframe，Tauri 桌面用）。
 * 纯状态容器：URL 由 docLink.ts 计算后传入（openDocs(src)），Web 端不触发。
 */
export const useDocsStore = defineStore('docs', {
  state: () => ({
    open: false,
    src: null as string | null,
  }),
  actions: {
    openDocs(src: string) {
      this.src = src
      this.open = true
    },
    closeDocs() {
      this.open = false
      this.src = null
    },
  },
})

export default useDocsStore
