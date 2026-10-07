/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module 'vxe-table' {
  import type { DefineComponent, PluginFunction } from 'vue'
  const VXETable: {
    setup: (options: Record<string, any>) => void
    install: PluginFunction
  }
  export default VXETable
  export const VxeTable: any
  export const VxeColumn: any
}
