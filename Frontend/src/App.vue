<template>
  <div id="app">
    <header class="app-header">
      <div class="header-content">
        <div class="header-left">
          <h1>GoFundBot</h1>
          <p>智能基金分析 · 实时市场追踪</p>
        </div>
        <div class="header-search">
          <FundSearch @fund-selected="handleHeaderSearch" :compact="true" />
        </div>
        <div class="header-right">
          <div class="mode-switch">
            <button
              class="mode-btn"
              :class="{ active: route.name === 'dashboard' }"
              @click="resetToDashboard"
            >
              <LucideIcon name="Home" :size="16" /> 市场大盘
            </button>
            <button
              class="mode-btn"
              :class="{ active: route.name === 'screening' }"
              @click="router.push({ name: 'screening' })"
            >
              <LucideIcon name="Search" :size="16" /> 基金筛选
            </button>
            <button
              class="mode-btn"
              :class="{ active: route.name === 'backtest' || route.name === 'backtest-fund' }"
              @click="router.push({ name: 'backtest' })"
            >
              <LucideIcon name="Coins" :size="16" /> 定投回测
            </button>
            <button
              class="mode-btn"
              :class="{ active: route.name === 'portfolio' }"
              @click="router.push({ name: 'portfolio' })"
            >
              <LucideIcon name="BarChart3" :size="16" /> 估值与持仓
            </button>
            <button
              class="mode-btn"
              :class="{ active: route.name === 'research' }"
              @click="router.push({ name: 'research' })"
            >
              <LucideIcon name="TrendingUp" :size="16" /> 投研看板
            </button>
          </div>
          <button
            class="theme-toggle"
            @click="toggleTheme"
            :title="themeTitle"
          >
            <span class="theme-icon"><LucideIcon :name="themeIcon" :size="20" /></span>
          </button>
        </div>
      </div>
    </header>

    <main class="app-main">
      <div v-if="route.meta.rightbar" class="dashboard-layout" :class="{ 'full-content': showFullContent }">
        <aside class="dashboard-sidebar">
          <FundWatchlist
            @view-fund="handleNavigate"
            @add-to-compare="handleAddToCompare"
            :compareMode="compareMode"
            :compareFunds="compareFunds"
            :showCompareToggle="true"
            @toggle-compare="toggleCompareMode"
          />
        </aside>

        <div class="dashboard-main">
          <FundComparison
            v-if="compareMode && compareFunds.length >= 2"
            :compareFunds="compareFunds"
            @remove-fund="handleRemoveFromCompare"
            @clear-funds="handleClearCompare"
          />
          <router-view v-else v-slot="{ Component }">
            <component
              :is="Component"
              @navigate-to-fund="handleNavigate"
              @view-fund="handleNavigate"
              @view-detail="handleNavigate"
            />
          </router-view>
        </div>

        <aside v-if="!showFullContent" class="dashboard-right">
          <FlashNews :count="30" :refreshInterval="30000" />
          <SectorRank :limit="90" />
        </aside>
      </div>

      <div v-else class="main-layout">
        <div class="content-area full-width">
          <router-view v-slot="{ Component }">
            <component
              :is="Component"
              @navigate-to-fund="handleNavigate"
              @view-fund="handleNavigate"
              @view-detail="handleNavigate"
            />
          </router-view>
        </div>
      </div>
    </main>

    <footer class="app-footer">
      <p>数据来源：天天基金 / 东方财富 / 百度股市通 | 更新时间：{{ currentTime }}</p>
    </footer>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from './composables/useTheme'
import FundSearch from './components/FundSearch.vue'
import FundWatchlist from './components/FundWatchlist.vue'
import FundComparison from './components/FundComparison.vue'
import FlashNews from './components/FlashNews.vue'
import SectorRank from './components/SectorRank.vue'
import LucideIcon from './components/LucideIcon.vue'

export default {
  name: 'App',
  components: {
    FundSearch,
    FundWatchlist,
    FundComparison,
    FlashNews,
    SectorRank,
    LucideIcon
  },
  setup() {
    const { theme: appTheme, savedTheme, toggleTheme } = useTheme()
    const currentTime = ref('')
    const route = useRoute()
    const router = useRouter()
    const compareFunds = ref([])
    const compareMode = ref(false)

    const showFullContent = computed(() =>
      !!route.params.code || (compareMode.value && compareFunds.value.length >= 2)
    )

    const themeIcon = computed(() => {
      if (savedTheme.value === 'dark') return 'Moon'
      if (savedTheme.value === 'auto') return 'Monitor'
      return 'Sun'
    })

    const themeTitle = computed(() => {
      if (savedTheme.value === 'light') return '浅色模式（点击切换）'
      if (savedTheme.value === 'dark') return '深色模式（点击切换）'
      return '跟随系统（点击切换）'
    })

    const normalizeFundCode = (fundOrCode) => {
      if (fundOrCode && typeof fundOrCode === 'object') {
        return fundOrCode.CODE || fundOrCode.fund_code || fundOrCode.code || ''
      }
      return fundOrCode || ''
    }

    const handleNavigate = (fundOrCode) => {
      if (compareMode.value) return
      const code = normalizeFundCode(fundOrCode)
      if (code) router.push({ name: 'fund-detail', params: { code } })
    }

    const handleHeaderSearch = (fundOrCode) => {
      compareMode.value = false
      const code = normalizeFundCode(fundOrCode)
      if (code) router.push({ name: 'fund-detail', params: { code } })
    }

    const resetToDashboard = () => {
      compareMode.value = false
      compareFunds.value = []
      router.push({ name: 'dashboard' })
    }

    const toggleCompareMode = () => {
      compareMode.value = !compareMode.value
      if (!compareMode.value) {
        compareFunds.value = []
      }
    }

    const handleAddToCompare = (fund) => {
      if (compareFunds.value.length >= 5) {
        alert('最多只能对比5只基金')
        return
      }
      if (compareFunds.value.some(f => f.code === fund.code)) {
        compareFunds.value = compareFunds.value.filter(f => f.code !== fund.code)
        return
      }
      compareFunds.value.push({
        code: fund.code,
        name: fund.name
      })
    }

    const handleRemoveFromCompare = (fundCode) => {
      compareFunds.value = compareFunds.value.filter(f => f.code !== fundCode)
    }

    const handleClearCompare = () => {
      compareFunds.value = []
    }

    const updateTime = () => {
      const now = new Date()
      currentTime.value = now.toLocaleString('zh-CN')
    }

    onMounted(() => {
      updateTime()
      setInterval(updateTime, 60000)
    })

    return {
      currentTime,
      route,
      router,
      compareFunds,
      compareMode,
      showFullContent,
      themeIcon,
      themeTitle,
      toggleTheme,
      handleNavigate,
      handleHeaderSearch,
      resetToDashboard,
      toggleCompareMode,
      handleAddToCompare,
      handleRemoveFromCompare,
      handleClearCompare
    }
  }
}
</script>

<style>
:root {
  /* ── Surfaces ── */
  --bg-page: #f5f7fa;
  --bg-primary: #f8fafc;
  --bg-card: #ffffff;
  --bg-elevated: #ffffff;
  --bg-hover: #f0f2f5;
  --bg-subtle: #f3f4f6;
  --bg-overlay: rgba(0, 0, 0, 0.45);
  --bg-gradient: linear-gradient(135deg, #1677ff 0%, #0958d9 100%);

  /* ── Text ── */
  --text-primary: #1f2937;
  --text-secondary: #6b7280;
  --text-tertiary: #9ca3af;
  --text-disabled: #d1d5db;
  --text-inverse: #ffffff;

  /* ── Borders ── */
  --border-default: #e5e7eb;
  --border-subtle: #f0f0f0;
  --border-strong: #1677ff;

  /* ── Semantic colors ── */
  --color-primary: #1677ff;
  --color-primary-hover: #0958d9;
  --color-primary-bg: #eef4ff;
  --color-primary-border: #91bffa;
  --color-success: #52c41a;
  --color-success-bg: #f6ffed;
  --color-success-border: #b7eb8f;
  --color-danger: #ff4d4f;
  --color-danger-bg: #fff1f0;
  --color-danger-border: #ffa39e;
  --color-warning: #faad14;
  --color-warning-bg: #fff7e6;
  --color-warning-border: #ffd591;
  --color-info: #13c2c2;
  --color-info-bg: #e6fffb;

  /* ── Chart palette ── */
  --chart-1: #1677ff;
  --chart-2: #52c41a;
  --chart-3: #faad14;
  --chart-4: #ff4d4f;
  --chart-5: #73c0de;
  --chart-6: #3ba272;
  --chart-7: #fc8452;
  --chart-8: #9a60b4;
  --chart-9: #ea7ccc;
  --chart-10: #bfbfbf;
  --chart-bg: #ffffff;
  --chart-grid: #e5e7eb;
  --chart-axis-label: #6b7280;

  /* ── Shadows ── */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);

  /* ── Legacy aliases (backward compat) ── */
  --primary-color: var(--color-primary);
  --primary-gradient: var(--bg-gradient);
  --success-color: var(--color-success);
  --danger-color: var(--color-danger);
  --warning-color: var(--color-warning);
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
}

:root[data-theme="dark"] {
  /* ── Surfaces ── */
  --bg-page: #1b1b1f;
  --bg-primary: #1b1b1f;
  --bg-card: #202127;
  --bg-elevated: #202127;
  --bg-hover: #2a2b31;
  --bg-subtle: #161618;
  --bg-overlay: rgba(0, 0, 0, 0.70);
  --bg-gradient: linear-gradient(135deg, #202127 0%, #1b1b1f 100%);

  /* ── Text ── */
  --text-primary: #dfdfd6;
  --text-secondary: #98989f;
  --text-tertiary: #6a6a71;
  --text-disabled: #4a4a52;
  --text-inverse: #1b1b1f;

  /* ── Borders ── */
  --border-default: #3c3f44;
  --border-subtle: #2e2e32;
  --border-strong: #a8b1ff;

  /* ── Semantic colors ── */
  --color-primary: #a8b1ff;
  --color-primary-hover: #5c73e7;
  --color-primary-bg: rgba(100, 108, 255, 0.12);
  --color-primary-border: rgba(100, 108, 255, 0.30);
  --color-success: #3dd68c;
  --color-success-bg: rgba(16, 185, 129, 0.12);
  --color-success-border: rgba(16, 185, 129, 0.25);
  --color-danger: #f66f81;
  --color-danger-bg: rgba(244, 63, 94, 0.12);
  --color-danger-border: rgba(244, 63, 94, 0.25);
  --color-warning: #f9b44e;
  --color-warning-bg: rgba(234, 179, 8, 0.12);
  --color-warning-border: rgba(234, 179, 8, 0.25);
  --color-info: #5c73e7;
  --color-info-bg: rgba(100, 108, 255, 0.10);

  /* ── Chart palette ── */
  --chart-1: #a8b1ff;
  --chart-2: #3dd68c;
  --chart-3: #f9b44e;
  --chart-4: #f66f81;
  --chart-5: #38bdf8;
  --chart-6: #c8abfa;
  --chart-7: #fb923c;
  --chart-8: #f67373;
  --chart-9: #f0abfc;
  --chart-10: #6a6a71;
  --chart-bg: #202127;
  --chart-grid: #2e2e32;
  --chart-axis-label: #98989f;

  /* ── Shadows ── */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.35);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.50);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.60);

  /* ── Legacy aliases ── */
  --primary-color: var(--color-primary);
  --success-color: var(--color-success);
  --danger-color: var(--color-danger);
  --warning-color: var(--color-warning);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

#app {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: var(--text-primary);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
}

.app-header {
  background: var(--bg-gradient);
  color: white;
  padding: 12px 24px;
  box-shadow: var(--shadow-md);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-content {
  max-width: 1920px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left h1 {
  font-size: 1.6rem;
  font-weight: 700;
  margin-bottom: 2px;
  letter-spacing: -0.5px;
}

.header-left p {
  opacity: 0.85;
  font-size: 0.85rem;
}

.header-search {
  flex: 1;
  max-width: 600px;
  margin: 0 40px;
}

.header-search .fund-search {
  margin-bottom: 0;
  background: transparent;
  padding: 0;
  box-shadow: none;
}

.header-search .search-header {
  gap: 8px;
}

.header-search .search-box {
  min-width: 300px;
  flex: 1;
}

.header-search .search-input {
  background: rgba(255, 255, 255, 0.10);
  border: 1px solid rgba(255, 255, 255, 0.18);
  height: 40px;
  flex: 1;
  color: #fff;
}

.header-search .search-input::placeholder {
  color: rgba(255, 255, 255, 0.45);
}

.header-search .search-input:focus {
  border-color: rgba(255, 255, 255, 0.35);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.08);
}

.header-search .search-btn {
  background: linear-gradient(135deg, #f9b44e 0%, #da8b17 100%);
  height: 40px;
  padding: 0 24px;
  color: white;
  font-weight: 600;
  border: none;
  box-shadow: 0 2px 8px rgba(218, 139, 23, 0.35);
}

.header-search .search-btn:hover {
  background: linear-gradient(135deg, #fcc162 0%, #f9b44e 100%);
  box-shadow: 0 4px 12px rgba(249, 180, 78, 0.45);
  transform: translateY(-1px);
}

.header-search .refresh-btn {
  background: rgba(255, 255, 255, 0.2);
  color: white;
  width: 40px;
  height: 40px;
  border-radius: 8px;
}

.header-search .refresh-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.3);
}

.header-search .search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 1000;
  margin-top: 4px;
  max-height: 300px;
}

[data-theme="dark"] .header-search .search-input {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.10);
}

[data-theme="dark"] .header-search .search-input:focus {
  border-color: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.05);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.theme-toggle {
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.theme-toggle:hover {
  background: rgba(255, 255, 255, 0.28);
}

.theme-icon {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

.mode-switch {
  display: flex;
  gap: 6px;
  background: rgba(255, 255, 255, 0.08);
  padding: 4px;
  border-radius: var(--radius-md);
}

.mode-btn {
  padding: 8px 14px;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  transition: all 0.2s ease;
  white-space: nowrap;
}

.mode-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
}

.mode-btn.active {
  background: rgba(255, 255, 255, 0.22);
  color: white;
  font-weight: 600;
}

[data-theme="dark"] .mode-switch {
  background: rgba(255, 255, 255, 0.05);
}

[data-theme="dark"] .mode-btn.active {
  background: rgba(255, 255, 255, 0.15);
}

.app-main {
  flex: 1;
  max-width: 1920px;
  width: 100%;
  margin: 0 auto;
  padding: 20px;
}

/* ==================== 仪表盘三栏布局 ==================== */
.dashboard-layout {
  display: grid;
  grid-template-columns: 380px 1fr 380px;
  gap: 20px;
  min-height: calc(100vh - 140px);
  transition: grid-template-columns 0.3s ease;
}

.dashboard-layout.full-content {
  grid-template-columns: 380px 1fr;
}

.dashboard-sidebar {
  position: sticky;
  top: 80px;
  height: fit-content;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
}

.dashboard-main {
  min-width: 0;
}

.dashboard-right {
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: sticky;
  top: 80px;
  height: calc(100vh - 100px);
  min-height: 0;
  overflow: hidden;
}

.dashboard-right .flash-news-container,
.dashboard-right .sector-rank-container {
  flex: 1 1 0;
  min-height: 0;
  max-height: none;
}

.dashboard-right .sector-rank-container {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px;
}

.dashboard-right .sector-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.dashboard-right .sector-list {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  overflow-y: auto;
  gap: 6px;
}

.dashboard-right .sector-item {
  padding: 7px 10px;
}

.dashboard-right .filter-panel,
.dashboard-right .overview-bar {
  flex-shrink: 0;
  margin-bottom: 8px;
}

.dashboard-right .update-time {
  flex-shrink: 0;
}

/* ==================== 默认布局 ==================== */
.main-layout {
  display: flex;
  gap: 20px;
  min-height: calc(100vh - 160px);
}

.sidebar-left {
  width: 400px;
  flex-shrink: 0;
}

.content-area {
  flex: 1;
  min-width: 0;
}

.content-area.full-width {
  width: 100%;
}

/* ==================== 对比面板 ==================== */
.compare-panel {
  margin-bottom: 20px;
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

/* ==================== 页脚 ==================== */
.app-footer {
  background: var(--bg-card);
  text-align: center;
  padding: 12px;
  border-top: 1px solid var(--border-color);
  font-size: 0.8rem;
  color: var(--text-tertiary);
}

/* ==================== 响应式设计 ==================== */
@media (max-width: 1600px) {
 .header-search {
    max-width: 400px;
    margin: 0 20px;
  }
}

@media (max-width: 1400px) {
 .dashboard-layout {
    grid-template-columns: 340px 1fr 340px;
  }

 .sidebar-left {
    width: 360px;
  }

 .header-search {
    max-width: 350px;
  }
}

@media (max-width: 1200px) {
 .dashboard-layout {
    grid-template-columns: 1fr 340px;
  }

 .dashboard-sidebar {
    display: none;
  }

 .sidebar-left {
    width: 320px;
  }

 .header-search {
    max-width: 280px;
    margin: 0 15px;
  }
}

@media (max-width: 1024px) {
 .main-layout {
    flex-direction: column;
  }

 .sidebar-left {
    width: 100%;
  }

 .dashboard-layout {
    grid-template-columns: 1fr;
  }

 .dashboard-right {
    position: static;
    max-height: none;
  }

 .mode-switch {
    flex-wrap: wrap;
    justify-content: center;
  }

 .header-search {
    order: 3;
    width: 100%;
    max-width: 100%;
    margin: 10px 0 0 0;
  }
}

@media (max-width: 768px) {
 .app-header {
    padding: 10px 16px;
  }

 .header-content {
    flex-direction: column;
    gap: 12px;
  }

 .header-left {
    text-align: center;
  }

 .mode-btn {
    padding: 6px 10px;
    font-size: 12px;
  }

 .app-main {
    padding: 12px;
  }

  .header-search .db-status {
    display: none;
  }
}

/* ==================== 滚动条美化 ==================== */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--text-disabled);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}
</style>
