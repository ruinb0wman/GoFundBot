<template>
  <div id="app">
    <OfflineBanner />
    <header class="app-header">
      <div class="header-content">
        <div class="header-left">
          <h1>GoFundBot</h1>
          <p>{{ '智能基金分析 · 实时市场追踪' }}</p>
        </div>
        <div class="header-search">
          <FundSearch @fund-selected="handleHeaderSearch" :compact="true" />
        </div>
        <div class="header-right">
          <BHamburgerButton class="hamburger-btn" :open="drawerOpen" @toggle="drawerOpen = !drawerOpen" />
          <div class="mode-switch">
            <button class="mode-btn" :class="{ active: route.name === 'dashboard' }" @click="resetToDashboard"><LucideIcon name="Home" :size="16" /> {{ '市场大盘' }}</button>
            <button class="mode-btn" :class="{ active: route.name === 'screening' }" @click="router.push({ name: 'screening' })"><LucideIcon name="Search" :size="16" /> {{ '基金筛选' }}</button>
            <button class="mode-btn" :class="{ active: route.name === 'backtest' || route.name === 'backtest-fund' }" @click="router.push({ name: 'backtest' })"><LucideIcon name="Code2" :size="16" /> {{ '回测' }}</button>
            <button class="mode-btn" :class="{ active: route.name === 'portfolio' }" @click="router.push({ name: 'portfolio' })"><LucideIcon name="BarChart3" :size="16" /> {{ '估值与持仓' }}</button>
            <button class="mode-btn" :class="{ active: route.name === 'research' }" @click="router.push({ name: 'research' })"><LucideIcon name="TrendingUp" :size="16" /> {{ '投研看板' }}</button>
            <button class="mode-btn" :class="{ active: route.name === 'strategy' }" @click="router.push({ name: 'strategy' })"><LucideIcon name="NotebookPen" :size="16" /> {{ '策略研究' }}</button>
          </div>
          <AlertBadge />
          <button class="header-icon-btn" @click="router.push('/settings')" :title="'设置'">
            <LucideIcon name="Settings" :size="20" />
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
          <FundComparison v-if="compareMode && compareFunds.length >= 2" :compareFunds="compareFunds" @remove-fund="handleRemoveFromCompare" @clear-funds="handleClearCompare" />
          <ErrorBoundary v-else>
            <router-view v-slot="{ Component }">
              <component :is="Component" @navigate-to-fund="handleNavigate" @view-fund="handleNavigate" @view-detail="handleNavigate" />
            </router-view>
          </ErrorBoundary>
        </div>

        <aside v-if="!showFullContent" class="dashboard-right">
          <FlashNews :count="30" :refreshInterval="30000" />
          <SectorRank :limit="90" />
        </aside>
      </div>

      <div v-else class="main-layout">
        <div class="content-area full-width">
          <ErrorBoundary>
            <router-view v-slot="{ Component }">
              <component :is="Component" @navigate-to-fund="handleNavigate" @view-fund="handleNavigate" @view-detail="handleNavigate" />
            </router-view>
          </ErrorBoundary>
        </div>
      </div>
    </main>

    <footer class="app-footer" :class="{ 'mobile-hidden': isMobile }">
      <p>{{ `数据来源：天天基金 / 东方财富 / 百度股市通 | 更新时间：${currentTime}` }}</p>
    </footer>

    <BDrawer
      :visible="drawerOpen"
      :items="navItems"
      :active-key="String(route.name || '')"
      @close="drawerOpen = false"
      @select="goToRoute"
    />
    <BTabBar v-if="isMobile" class="mobile-tabbar" :items="tabItems" :active-key="String(route.name || '')" @select="goToRoute" />
  </div>
</template>

<script setup lang="ts">

import { BDrawer, BHamburgerButton, BTabBar, LucideIcon, OfflineBanner, ErrorBoundary } from '@ruinb0w/ui'
import FundSearch from './components/FundSearch.vue'
import FundWatchlist from './components/FundWatchlist.vue'
import FundComparison from './components/FundComparison.vue'

import FlashNews from './components/FlashNews.vue'
import SectorRank from './components/SectorRank.vue'
import AlertBadge from './components/AlertBadge.vue'
import { useApp } from './composables/useApp'

defineOptions({ name: 'App' })

const {
  drawerOpen, currentTime, route, router, isMobile,
  compareFunds, compareMode, showFullContent,
  toggleCompareMode,
  handleNavigate, handleHeaderSearch, resetToDashboard,
  handleAddToCompare, handleRemoveFromCompare, handleClearCompare
} = useApp()

// 抽屉与底部标签栏共用一份导航数据（键 = 路由名）
const navItems = [
  { key: 'dashboard', label: '市场大盘', icon: 'Home' },
  { key: 'screening', label: '基金筛选', icon: 'Search' },
  { key: 'backtest', label: '回测', icon: 'Code2' },
  { key: 'portfolio', label: '估值与持仓', icon: 'BarChart3' },
  { key: 'research', label: '投研看板', icon: 'TrendingUp' },
  { key: 'strategy', label: '策略研究', icon: 'NotebookPen' },
]
const shortLabels: Record<string, string> = { dashboard: '大盘', screening: '筛选', backtest: '回测', portfolio: '持仓', research: '投研', strategy: '策略' }
const tabItems = navItems.map((item) => ({ ...item, label: shortLabels[item.key] ?? item.label }))

function goToRoute(name: string) {
  if (name === 'dashboard') resetToDashboard()
  else router.push({ name })
  drawerOpen.value = false
}
</script>

<style>
@import './App.css';
</style>
