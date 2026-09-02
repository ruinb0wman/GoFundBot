<template>
  <div class="market-dashboard">
    <div class="dashboard-header">
      <h2><LucideIcon name="TrendingUp" :size="22" /> {{ '市场实时数据' }}</h2>
      <div class="tab-switch">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="tab-btn"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <LucideIcon :name="tab.icon" :size="16" /> {{ tab.label }}
        </button>
      </div>
    </div>

    <div class="dashboard-content">
      <!-- 综合概览 Tab -->
      <div v-show="activeTab === 'overview'" class="tab-content">
        <div class="overview-grid">
          <div class="grid-main">
            <MarketOverview
              :showGoldHistory="false"
              :showSSE30Min="true"
            />
          </div>
          <div class="grid-side">
            <FlashNews :count="15" />
          </div>
        </div>
      </div>

      <!-- 板块排行 Tab -->
      <div v-show="activeTab === 'sectors'" class="tab-content">
        <SectorRank :limit="500" />
      </div>

      <!-- 快讯 Tab - 无限滚动，不设上限 -->
      <div v-show="activeTab === 'news'" class="tab-content">
        <FlashNews :count="50" :refreshInterval="60000" />
      </div>

      <!-- 贵金属 Tab -->
      <div v-show="activeTab === 'gold'" class="tab-content">
        <div class="gold-section-full">
          <MarketOverview
            :showGoldHistory="true"
            :showSSE30Min="false"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import MarketOverview from './MarketOverview.vue'
import FlashNews from './FlashNews.vue'
import SectorRank from './SectorRank.vue'

const activeTab = ref('overview')

const tabs = computed(() => [
  { key: 'overview', label: '综合概览', icon: 'Globe' },
  { key: 'sectors', label: '板块排行', icon: 'Factory' },
  { key: 'news', label: '7×24 快讯', icon: 'Newspaper' },
  { key: 'gold', label: '贵金属', icon: 'Award' }
])
</script>

<style scoped>
.market-dashboard {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  overflow: hidden;
  min-height: calc(100vh - 200px);
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: var(--bg-gradient);
  border-bottom: 1px solid var(--border-default);
}

.dashboard-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-inverse);
}

.tab-switch {
  display: flex;
  gap: 6px;
  background: rgba(255, 255, 255, 0.15);
  padding: 4px;
  border-radius: var(--radius-md);
}

.tab-btn {
  padding: 10px 18px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.tab-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: var(--text-inverse);
}

.tab-btn.active {
  background: var(--bg-elevated);
  color: var(--color-primary);
  box-shadow: var(--shadow-md);
}

.dashboard-content {
  padding: 20px;
  min-height: calc(100vh - 280px);
}

.tab-content {
  min-height: 400px;
}

/* 综合概览布局 - 全屏优化 */
.overview-grid {
  display: grid;
  grid-template-columns: 1fr 420px;
  gap: 20px;
  min-height: calc(100vh - 300px);
}

.grid-main {
  min-width: 0;
}

.grid-side {
  min-width: 0;
}

/* 贵金属区域 - 全宽 */
.gold-section-full {
  width: 100%;
}

/* 响应式调整 */
@media (max-width: 1400px) {
  .overview-grid {
    grid-template-columns: 1fr 380px;
  }
}

@media (max-width: 1200px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }

  .grid-side {
    order: -1;
  }

  .tab-switch {
    flex-wrap: wrap;
  }
}

@media (max-width: 768px) {
  .dashboard-header {
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
    padding: 12px 16px;
  }

  .dashboard-header h2 {
    font-size: 18px;
  }

  .tab-switch {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .tab-btn {
    padding: 8px 12px;
    font-size: 13px;
  }

  .dashboard-content {
    padding: 12px;
  }
}
</style>
