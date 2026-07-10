<template>
  <div id="app">
    <OfflineBanner />
    <header class="app-header">
      <div class="header-content">
        <div class="header-left">
          <h1>GoFundBot</h1>
          <p>{{ t('app.subtitle') }}</p>
        </div>
        <div class="header-search">
          <FundSearch @fund-selected="handleHeaderSearch" :compact="true" />
        </div>
        <div class="header-right">
          <HamburgerButton :isOpen="drawerOpen" @toggle="drawerOpen = !drawerOpen" />
          <div class="mode-switch" :class="{ 'mobile-hidden': isMobile }">
            <button class="mode-btn" :class="{ active: route.name === 'dashboard' }" @click="resetToDashboard"><LucideIcon name="Home" :size="16" /> {{ t('nav.dashboard') }}</button>
            <button class="mode-btn" :class="{ active: route.name === 'screening' }" @click="router.push({ name: 'screening' })"><LucideIcon name="Search" :size="16" /> {{ t('nav.screening') }}</button>
            <button class="mode-btn" :class="{ active: route.name === 'backtest' || route.name === 'backtest-fund' }" @click="router.push({ name: 'backtest' })"><LucideIcon name="Coins" :size="16" /> {{ t('nav.backtest') }}</button>
            <button class="mode-btn" :class="{ active: route.name === 'portfolio' }" @click="router.push({ name: 'portfolio' })"><LucideIcon name="BarChart3" :size="16" /> {{ t('nav.portfolio') }}</button>
            <button class="mode-btn" :class="{ active: route.name === 'research' }" @click="router.push({ name: 'research' })"><LucideIcon name="TrendingUp" :size="16" /> {{ t('nav.research') }}</button>
          </div>
          <AlertBadge />
          <button class="header-icon-btn" @click="router.push('/settings')" :title="t('common.settings')">
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
      <p>{{ t('app.footer', { time: currentTime }) }}</p>
    </footer>

    <MobileDrawer :isOpen="drawerOpen" :activeRoute="String(route.name || '')" @close="drawerOpen = false" />
    <BottomNav />
    <ChatBubble />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import LucideIcon from './components/LucideIcon.vue'
import OfflineBanner from './components/OfflineBanner.vue'
import FundSearch from './components/FundSearch.vue'
import FundWatchlist from './components/FundWatchlist.vue'
import FundComparison from './components/FundComparison.vue'
import HamburgerButton from './components/HamburgerButton.vue'
import MobileDrawer from './components/MobileDrawer.vue'
import BottomNav from './components/BottomNav.vue'
import ErrorBoundary from './components/ErrorBoundary.vue'
import FlashNews from './components/FlashNews.vue'
import SectorRank from './components/SectorRank.vue'
import AlertBadge from './components/AlertBadge.vue'
import ChatBubble from './components/ChatBubble.vue'
import { onMounted } from 'vue'
import { useApp } from './composables/useApp'
import { useAppSettings } from './composables/useAppSettings'

defineOptions({ name: 'App' })

const { t } = useI18n()
const { settings, syncToExpress } = useAppSettings()

const {
  drawerOpen, currentTime, route, router, isMobile,
  compareFunds, compareMode, showFullContent,
  toggleCompareMode,
  handleNavigate, handleHeaderSearch, resetToDashboard,
  handleAddToCompare, handleRemoveFromCompare, handleClearCompare
} = useApp()

onMounted(() => {
  syncToExpress()
})
</script>

<style>
@import './App.css';
</style>
