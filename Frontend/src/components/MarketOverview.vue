<template>
  <div class="market-overview-container">
    <div class="market-section" v-if="showSSE30Min">
      <div class="section-header">
        <h3><LucideIcon name="TrendingDown" :size="20" /> {{ t('market.indexTrend1m') }}</h3>
        <div class="tab-group">
          <span v-for="tab in tabs" :key="tab.key" :class="{ active: activeTab === tab.key }" @click="activeTab = tab.key">{{ tab.name }}</span>
        </div>
        <span class="update-tag" :class="{ failed: klineStatus === 'failed' || !hasCurrentData }" v-if="klineUpdateTime">
          {{ (klineStatus === 'success' && hasCurrentData) ? t('market.updatedAt') : t('market.fetchFailed') + ': ' }}{{ formatUpdateTime(klineUpdateTime) }}
        </span>
      </div>
      <div class="chart-container sse-chart-container">
        <v-chart class="chart" :option="currentChartOption" autoresize :theme="echartThemeName" v-if="hasCurrentData" />
        <div v-else class="empty-state">{{ t('common.noData') }} ({{ activeTabName }})</div>
      </div>
    </div>

    <div class="market-section">
      <div class="section-header">
        <h3><LucideIcon name="Globe" :size="20" /> {{ t('market.indices') }}</h3>
        <div class="header-actions">
          <span class="update-tag" :class="{ failed: indicesStatus === 'failed' }" v-if="indicesUpdateTime">
            {{ indicesStatus === 'success' ? t('market.updatedAt') : t('market.fetchFailed') + ': ' }}{{ formatUpdateTime(indicesUpdateTime) }}
          </span>
          <BButton size="small" icon="RefreshCw" :loading="loading" @click="fetchAll" :disabled="loading" />
        </div>
      </div>

      <div class="market-sub-section">
        <h4 class="sub-title"><span class="flag">🇨🇳</span> {{ t('market.chinaMarket') }} <span class="sub-desc">{{ t('market.ahDesc') }}</span></h4>
        <div class="index-grid china-grid" v-if="indices.china.length">
            <div v-for="item in indices.china" :key="item.name" class="index-card clickable" :class="getUpDnClass(item.change_pct)" @click="navigateToIndex(item)" :title="item.code ? t('market.clickForDetail') : ''">
            <div class="index-name">{{ item.name }}</div>
            <div class="index-price">{{ item.price }}</div>
            <div class="index-change">{{ item.change_pct }}</div>
          </div>
        </div>
      </div>

      <div class="market-sub-section">
        <h4 class="sub-title"><span class="flag"><LucideIcon name="Globe" :size="16" /></span> {{ t('market.globalIndices') }}</h4>
        <div class="index-grid global-grid" v-if="indices.global.length">
            <div v-for="item in indices.global" :key="item.name" class="index-card clickable" :class="getUpDnClass(item.change_pct)" @click="navigateToIndex(item)" :title="item.code ? t('market.clickForDetail') : ''">
            <div class="index-name">{{ item.name }}</div>
            <div class="index-price">{{ item.price }}</div>
            <div class="index-change">{{ item.change_pct }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="market-section">
      <div class="section-header">
        <h3><LucideIcon name="BarChart3" :size="20" /> {{ t('market.volume') }}</h3>
        <span class="update-tag" :class="{ failed: volumeStatus === 'failed' }" v-if="volumeUpdateTime">
          {{ volumeStatus === 'success' ? t('market.updatedAt') : t('market.fetchFailed') + ': ' }}{{ formatUpdateTime(volumeUpdateTime) }}
        </span>
      </div>
      <div class="chart-container volume-chart-container">
        <v-chart class="chart" :option="volumeOption" autoresize :theme="echartThemeName" v-if="aVolume.length" />
        <div v-else class="empty-state">{{ t('market.noVolumeData') }}</div>
      </div>
    </div>

    <div class="market-section">
      <div class="section-header">
        <h3><LucideIcon name="Award" :size="20" /> {{ t('market.gold') }}</h3>
        <span class="update-tag" :class="{ failed: goldStatus === 'failed' }" v-if="goldUpdateTime">
          {{ goldStatus === 'success' ? t('market.updatedAt') : t('market.fetchFailed') + ': ' }}{{ formatUpdateTime(goldUpdateTime) }}
        </span>
      </div>
      <div class="gold-grid" v-if="goldRealtime.length">
        <div v-for="item in goldRealtime" :key="item.name" class="gold-card" :class="{ 'up': item.change >= 0, 'down': item.change < 0, 'clickable': isGoldItem(item) }"             @click="isGoldItem(item) && openGoldHistory(item)" :title="isGoldItem(item) ? t('market.clickForHistory') : ''">
          <div class="gold-name">{{ item.name }}<span v-if="isGoldItem(item)" class="chart-hint"><LucideIcon name="TrendingUp" :size="14" /></span></div>
          <div class="gold-price">{{ item.price }} <span class="unit">{{ item.unit }}</span></div>
          <div class="gold-change"><span>{{ item.change >= 0 ? '+' : '' }}{{ item.change }}</span><span class="pct">{{ item.change_pct }}</span></div>
        </div>
      </div>
    </div>

    <div class="market-section">
      <div class="section-header">
        <h3><LucideIcon name="BellRing" :size="20" /> {{ t('market.anomaly') }}</h3>
        <div class="header-actions">
          <BButton size="small" icon="RefreshCw" :loading="anomaliesLoading" @click="fetchAnomalies" :disabled="anomaliesLoading" />
          <BButton size="small" icon="Settings" @click="goToAnomalySettings" />
        </div>
      </div>
      <div v-if="anomaliesLoading" class="anomaly-loading">{{ t('common.loading') }}</div>
      <div v-else-if="anomalies.length === 0" class="anomaly-empty"><LucideIcon name="CheckCircle" :size="16" /> {{ t('alert.anomaly.empty') }}</div>
      <div v-else class="anomaly-list">
        <div v-for="(item, i) in anomalies" :key="i" class="anomaly-item" :class="item.type">
          <span class="anomaly-type-badge">{{ item.type === 'index_surge' ? t('market.surge') : item.type === 'index_plunge' ? t('market.plunge') : t('market.anomalyLabel') }}</span>
          <span class="anomaly-name">{{ item.name }}</span>
          <span class="anomaly-value" :class="item.type === 'index_surge' ? 'positive' : 'negative'">{{ item.value }}</span>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="goldModal.visible" class="gold-modal-overlay" @click.self="closeGoldHistory">
        <div class="gold-modal">
          <div class="gold-modal-header">
            <h3><LucideIcon name="TrendingUp" :size="20" /> {{ goldModal.name }} — {{ t('market.goldTrendDays', { days: goldDays }) }}</h3>
            <div class="gold-modal-controls">
              <select v-model="goldDays" class="days-select" @change="fetchMetalHistoryForModal">
                <option :value="7">{{ t('market.days7') }}</option>
                <option :value="10">{{ t('market.days10') }}</option>
                <option :value="30">{{ t('market.days30') }}</option>
              </select>
              <BButton circle size="small" @click="closeGoldHistory">×</BButton>
            </div>
          </div>
          <div class="gold-modal-body">
            <v-chart v-if="metalChartOption" class="gold-chart" :option="metalChartOption" autoresize :theme="echartThemeName" />
            <div v-else class="empty-state">{{ t('market.noHistoryData') }}</div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import BButton from './BButton.vue'
import LucideIcon from './LucideIcon.vue'
import VChart from 'vue-echarts'
import { use } from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { LineChart, BarChart } from "echarts/charts"
import { GridComponent, TooltipComponent, TitleComponent, LegendComponent, DataZoomComponent } from "echarts/components"
import { useMarketOverview } from '../composables/useMarketOverview'

use([CanvasRenderer, LineChart, BarChart, GridComponent, TooltipComponent, TitleComponent, LegendComponent, DataZoomComponent])

const { t } = useI18n()
const router = useRouter()

function formatUpdateTime(isoStr: string) {
  try {
    return new Date(isoStr).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return isoStr.slice(11, 19) }
}

const goToAnomalySettings = () => {
  router.push({ name: 'settings-anomaly' })
}

const props = defineProps({
  showGoldHistory: { type: Boolean, default: true },
  showSSE30Min: { type: Boolean, default: true },
  autoRefresh: { type: Boolean, default: true },
  refreshInterval: { type: Number, default: 60000 }
})

const {
  loading, fetchAll, marketIndex, indices,
  klineUpdateTime, klineStatus,
  indicesUpdateTime, indicesStatus,
  goldUpdateTime, goldStatus,
  volumeUpdateTime, volumeStatus,
  goldRealtime, goldModal, goldDays, metalChartOption,
  openGoldHistory, closeGoldHistory, isGoldItem, fetchMetalHistoryForModal,
  aVolume, volumeOption, echartThemeName,
  tabs, activeTab, activeTabName, hasCurrentData, latestKlineDate,
  currentChartOption, getUpDnClass, navigateToIndex, formatDate,
  anomalies, anomaliesLoading, fetchAnomalies,
} = useMarketOverview(props)
</script>

<style scoped>
@import './MarketOverview.css';
</style>
