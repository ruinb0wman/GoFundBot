// frontend/src/main.ts
import { LucideIcon } from '@gofund/ui'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import VXETable from 'vxe-table'
import 'vxe-table/lib/style.css'
import App from './App.vue'

import './style.css'

VXETable.setup({
  table: {
    borderColor: 'var(--border-default)',
    headerBackgroundColor: 'var(--bg-subtle)',
  }
})

import { clientLogger, initClientLogger } from './core/logger'
import { migrateLocalUserDataToServer } from './db/migrateToServer'
import router from './router/index'

initClientLogger()

// 一次性把本地 Dexie 的用户数据搬到 service（失败则保留下次再试，见 db/migrateToServer.ts）。
void migrateLocalUserDataToServer().catch((error) => {
  clientLogger.warn('user data migration skipped', { error: String(error) })
})

const app = createApp(App)
app.use(createPinia())
app.use(VXETable)
app.use(router)

app.config.errorHandler = (err, instance, _info) => {
  clientLogger.error('Vue error', {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    component: instance?.$options?.name || undefined,
  })
}

app.component('LucideIcon', LucideIcon)

import SearchBar from './components/SearchBar.vue'
app.component('SearchBar', SearchBar)

router.isReady().then(() => {
  app.mount('#app')
  const loadingElement = document.getElementById('loading')
  if (loadingElement) {
    loadingElement.style.display = 'none'
  }
})
