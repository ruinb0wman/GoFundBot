// Frontend/src/main.js
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

import router from './router/index'

const app = createApp(App)
app.use(createPinia())
app.use(VXETable)
app.use(router)

app.config.errorHandler = (err, _instance, _info) => {
  console.error('[Global Error]', err)
}

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Rejection]', event.reason)
})

import LucideIcon from './components/LucideIcon.vue'
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
