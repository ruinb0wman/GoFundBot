// Frontend/src/main.js
import { createApp } from 'vue'
import VXETable from 'vxe-table'
import 'vxe-table/lib/style.css'
import App from './App.vue'

// 全局样式
import './style.css'

// VXETable 主题配置（背景/边框色由 style.css CSS 变量接管）
VXETable.setup({
  table: {
    borderColor: 'var(--border-default)',
    headerBackgroundColor: 'var(--bg-subtle)',
  }
})

import router from './router/index.js'

// 创建Vue应用
const app = createApp(App)
app.use(VXETable)
app.use(router)

import LucideIcon from './components/LucideIcon.vue'
app.component('LucideIcon', LucideIcon)

import SearchBar from './components/SearchBar.vue'
app.component('SearchBar', SearchBar)

// 等待路由初始导航完成后再挂载
router.isReady().then(() => {
  app.mount('#app')

  // 移除加载状态
  const loadingElement = document.getElementById('loading')
  if (loadingElement) {
    loadingElement.style.display = 'none'
  }
})
