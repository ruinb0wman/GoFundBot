// frontend/src/main.ts
import { RLucideIcon } from '@ruinb0w/ui'
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
import router from './router/index'
import './core/icons'

initClientLogger()

// 触摸尺寸走库的 density token（default=36px / touch=44px）：手机上继续用桌面档会又小又挤
const applyDensity = () => {
  document.documentElement.dataset.density = window.innerWidth < 768 ? 'touch' : 'default'
}
applyDensity()
window.addEventListener('resize', applyDensity)

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

app.component('RLucideIcon', RLucideIcon)

import SearchBar from './components/SearchBar.vue'
app.component('SearchBar', SearchBar)

router.isReady().then(() => {
  app.mount('#app')
  const loadingElement = document.getElementById('loading')
  if (loadingElement) {
    loadingElement.style.display = 'none'
  }
})
