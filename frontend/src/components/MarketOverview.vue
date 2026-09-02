<template>
  <div class="market-overview-container">
    <div class="market-section" v-if="showSSE30Min">
      <div class="section-header">
        <h3><LucideIcon name="TrendingDown" :size="20" /> {{ '市场指数近一月走势' }}</h3>
        <div class="header-actions">
          <a class="doc-link" href="/docs/market-index-trend" target="_blank" title="查看文档">
            <LucideIcon name="HelpCircle" :size="16" />
          </a>
        </div>
        <div class="tab-group">
          <span v-for="tab in tabs" :key="tab.key" :class="{ active: activeTab === tab.key }" @click="activeTab = tab.key">{{ tab.name }}</span>
        </div>
        <span class="update-tag" :class="{ failed: klineStatus === 'failed' || !hasCurrentData }" v-if="klineUpdateTime">
          {{ (klineStatus === 'success' && hasCurrentData) ? '更新于' : '获取失败' + ': ' }}{{ formatUpdateTime(klineUpdateTime) }}
        </span>
        <span class="date-tag" v-if="latestKlineDate">{{ '数据日期' }} {{ formatDataDate(latestKlineDate) }}</span>
      </div>
      <div class="chart-container sse-chart-container">
        <v-chart class="chart" :option="currentChartOption" autoresize :theme="echartThemeName" v-if="hasCurrentData" />
        <div v-else class="empty-state">{{ '暂无数据' }} ({{ activeTabName }})</div>
      </div>
    </div>

    <div class="market-section">
      <div class="section-header">
        <h3><LucideIcon name="Globe" :size="20" /> {{ '全球行情' }}</h3>
        <div class="header-actions">
          <a class="doc-link" href="/docs/market-global" target="_blank" title="查看文档">
            <LucideIcon name="HelpCircle" :size="16" />
          </a>
          <span class="update-tag" :class="{ failed: indicesStatus === 'failed' }" v-if="indicesUpdateTime">
            {{ indicesStatus === 'success' ? '更新于' : '获取失败' + ': ' }}{{ formatUpdateTime(indicesUpdateTime) }}
          </span>
          <BButton size="small" icon="RefreshCw" :loading="loading" @click="fetchAll" :disabled="loading" />
        </div>
      </div>

      <div class="market-sub-section">
        <h4 class="sub-title"><span class="flag">🇨🇳</span> {{ '中国市场' }} <span class="sub-desc">{{ 'A股 / 港股' }}</span><span class="date-tag" v-if="chinaIndicesDate">{{ '数据日期' }} {{ formatDataDate(chinaIndicesDate) }}</span></h4>
        <div class="index-grid china-grid" v-if="indices.china.length">
            <div v-for="item in indices.china" :key="item.name" class="index-card clickable" :class="getUpDnClass(item.change_pct)" @click="navigateToIndex(item)" :title="item.code ? '点击查看详情' : ''">
            <div class="index-name">{{ item.name }}</div>
            <div class="index-price">{{ item.price }}</div>
            <div class="index-change">{{ fmtPercent(item.change_pct) }}</div>
          </div>
        </div>
      </div>

      <div class="market-sub-section">
        <h4 class="sub-title"><span class="flag"><LucideIcon name="Globe" :size="16" /></span> {{ '全球指数' }}<span class="date-tag" v-if="globalIndicesDate">{{ '数据日期' }} {{ formatDataDate(globalIndicesDate) }}</span></h4>
        <div class="index-grid global-grid" v-if="indices.global.length">
            <div v-for="item in indices.global" :key="item.name" class="index-card clickable" :class="getUpDnClass(item.change_pct)" @click="navigateToIndex(item)" :title="item.code ? '点击查看详情' : ''">
            <div class="index-name">{{ item.name }}</div>
            <div class="index-price">{{ item.price }}</div>
            <div class="index-change">{{ fmtPercent(item.change_pct) }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="market-section">
      <div class="section-header">
        <h3><LucideIcon name="BarChart3" :size="20" /> {{ '近7日A股成交量' }}</h3>
        <div class="header-actions">
          <a class="doc-link" href="/docs/market-volume" target="_blank" title="查看文档">
            <LucideIcon name="HelpCircle" :size="16" />
          </a>
          <span class="update-tag" :class="{ failed: volumeStatus === 'failed' }" v-if="volumeUpdateTime">
          {{ volumeStatus === 'success' ? '更新于' : '获取失败' + ': ' }}{{ formatUpdateTime(volumeUpdateTime) }}
        </span>
        <span class="date-tag" v-if="aVolume.length && aVolume[0].date">{{ '数据日期' }} {{ formatDataDate(aVolume[0].date) }}</span>
      </div>
    </div>
    <div class="chart-container volume-chart-container">
        <v-chart class="chart" :option="volumeOption" autoresize :theme="echartThemeName" v-if="aVolume.length" />
        <div v-else class="empty-state">{{ '暂无成交量数据' }}</div>
      </div>
    </div>

    <div class="market-section">
      <div class="section-header">
        <h3><LucideIcon name="TrendingUp" :size="20" /> {{ '今日资金流向' }}</h3>
        <div class="header-actions">
          <a class="doc-link" href="/docs/market-money-flow" target="_blank" title="查看文档">
            <LucideIcon name="HelpCircle" :size="16" />
          </a>
          <span class="update-tag" :class="{ failed: moneyFlowStatus === 'failed' }" v-if="moneyFlowUpdateTime">
          {{ moneyFlowStatus === 'success' ? '更新于' : '获取失败' + ': ' }}{{ formatUpdateTime(moneyFlowUpdateTime) }}
        </span>
        <span class="date-tag" v-if="moneyFlow && moneyFlow.date">{{ '数据日期' }} {{ formatDataDate(moneyFlow.date) }}</span>
        </div>
      </div>
      <div class="flow-chart-container">
        <v-chart class="chart" :option="moneyFlowOption" autoresize :theme="echartThemeName" v-if="moneyFlow && moneyFlow.date" />
        <div v-else class="empty-state">{{ moneyFlowLoading ? '加载中...' : '暂无数据' }}</div>
      </div>
    </div>

    <div class="market-section">
      <div class="section-header">
        <h3><LucideIcon name="Award" :size="20" /> {{ '实时贵金属' }}</h3>
        <div class="header-actions">
          <a class="doc-link" href="/docs/market-gold" target="_blank" title="查看文档">
            <LucideIcon name="HelpCircle" :size="16" />
          </a>
          <span class="update-tag" :class="{ failed: goldStatus === 'failed' }" v-if="goldUpdateTime">
            {{ goldStatus === 'success' ? '更新于' : '获取失败' + ': ' }}{{ formatUpdateTime(goldUpdateTime) }}
          </span>
          <span class="date-tag" v-if="goldDataTime">{{ '数据时间' }} {{ formatDataDate(goldDataTime) }}</span>
        </div>
      </div>
      <div class="gold-grid" v-if="goldRealtime.length">
        <div v-for="item in goldRealtime" :key="item.name" class="gold-card" :class="{ 'up': item.change >= 0, 'down': item.change < 0, 'clickable': isGoldItem(item) }"             @click="isGoldItem(item) && openGoldHistory(item)" :title="isGoldItem(item) ? '点击查看历史走势' : ''">
          <div class="gold-name">{{ item.name }}<span v-if="isGoldItem(item)" class="chart-hint"><LucideIcon name="TrendingUp" :size="14" /></span></div>
          <div class="gold-price">{{ item.price }} <span class="unit">{{ item.unit }}</span></div>
          <div class="gold-change"><span>{{ item.change >= 0 ? '+' : '' }}{{ item.change }}</span><span class="pct">{{ fmtPercent(item.change_pct) }}</span></div>
        </div>
      </div>
    </div>

    <div class="market-section">
      <div class="section-header">
        <h3><LucideIcon name="Bitcoin" :size="20" /> {{ '加密货币' }}</h3>
        <div class="header-actions">
          <span class="update-tag" :class="{ failed: cryptoStatus === 'failed' }" v-if="cryptoUpdateTime">
            {{ cryptoStatus === 'success' ? '更新于' : '获取失败' + ': ' }}{{ formatUpdateTime(cryptoUpdateTime) }}
          </span>
          <span class="date-tag" v-if="cryptoDataTime">{{ '数据时间' }} {{ formatDataDate(cryptoDataTime) }}</span>
        </div>
      </div>
      <div class="index-grid global-grid" v-if="cryptoData.length">
        <div v-for="item in cryptoData" :key="item.code" class="index-card clickable"
             :class="getUpDnClass(item.changePercent)" @click="navigateToIndex(item)" :title="'点击查看详情'">
          <div class="index-name">{{ item.name }}</div>
          <div class="index-price">${{ formatCryptoPrice(item.price) }}</div>
          <div class="index-change">{{ fmtPercent(item.changePercent) }}</div>
        </div>
      </div>
      <div v-else class="empty-state">{{ cryptoLoading ? '加载中...' : '暂无加密货币数据' }}</div>
    </div>

    <div class="market-section">
      <div class="section-header">
        <h3><LucideIcon name="BellRing" :size="20" /> {{ '市场异动' }}</h3>
        <div class="header-actions">
          <BButton size="small" icon="RefreshCw" :loading="anomaliesLoading" @click="fetchAnomalies" :disabled="anomaliesLoading" />
          <BButton size="small" icon="Settings" @click="goToAnomalySettings" />
        </div>
      </div>
      <div v-if="anomaliesLoading" class="anomaly-loading">{{ '加载中...' }}</div>
      <div v-else-if="anomalies.length === 0" class="anomaly-empty"><LucideIcon name="CheckCircle" :size="16" /> {{ '今日未检测到市场异动' }}</div>
      <div v-else class="anomaly-list">
        <div v-for="(item, i) in anomalies" :key="i" class="anomaly-item" :class="item.type">
          <span class="anomaly-type-badge">{{ item.type === 'index_surge' ? '大涨' : item.type === 'index_plunge' ? '大跌' : '异动' }}</span>
          <span class="anomaly-name">{{ item.name }}</span>
          <span class="anomaly-value" :class="item.type === 'index_surge' ? 'positive' : 'negative'">{{ item.value }}</span>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="goldModal.visible" class="gold-modal-overlay" @click.self="closeGoldHistory">
        <div class="gold-modal">
          <div class="gold-modal-header">
            <h3><LucideIcon name="TrendingUp" :size="20" /> {{ goldModal.name }} — {{ `近${goldDays}日走势` }}</h3>
            <div class="gold-modal-controls">
              <select v-model="goldDays" class="days-select" @change="fetchMetalHistoryForModal">
                <option :value="7">{{ '7天' }}</option>
                <option :value="10">{{ '10天' }}</option>
                <option :value="30">{{ '30天' }}</option>
              </select>
              <BButton circle size="small" @click="closeGoldHistory">×</BButton>
            </div>
          </div>
          <div class="gold-modal-body">
            <v-chart v-if="metalChartOption" class="gold-chart" :option="metalChartOption" autoresize :theme="echartThemeName" />
            <div v-else class="empty-state">{{ '暂无历史数据' }}</div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { BButton, LucideIcon } from '@gofund/ui'
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import VChart from 'vue-echarts'
import { fmtPercent } from '../utils/number'
import { use } from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { LineChart, BarChart } from "echarts/charts"
import { GridComponent, TooltipComponent, TitleComponent, LegendComponent, DataZoomComponent } from "echarts/components"
import { useMarketOverview } from '../composables/useMarketOverview'

use([CanvasRenderer, LineChart, BarChart, GridComponent, TooltipComponent, TitleComponent, LegendComponent, DataZoomComponent])

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
  moneyFlow, moneyFlowOption, moneyFlowStatus, moneyFlowUpdateTime, moneyFlowLoading,
  cryptoData, cryptoStatus, cryptoUpdateTime, cryptoLoading,
  tabs, activeTab, activeTabName, hasCurrentData, latestKlineDate,
  chinaIndicesDate, globalIndicesDate, goldDataTime, cryptoDataTime,
  currentChartOption, getUpDnClass, navigateToIndex, formatDate, formatDataDate,
  anomalies, anomaliesLoading, fetchAnomalies,
} = useMarketOverview(props)

const formatCryptoPrice = (price: number | null) => {
  if (price == null) return '--'
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (price >= 1) return price.toFixed(2)
  return price.toFixed(4)
}
</script>

<style scoped>
@import './MarketOverview.css';
</style>
