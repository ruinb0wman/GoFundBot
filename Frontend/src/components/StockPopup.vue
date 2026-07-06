<template>
  <div class="stock-popup">
    <div v-if="loading" class="stock-loading">
      <div class="loading-spinner"></div>
      <p>{{ t('stockPopup.loading') }}</p>
    </div>

    <div v-else-if="error" class="stock-error">
      <span class="error-icon"><LucideIcon name="TriangleAlert" :size="16" /></span>
      <p>{{ error }}</p>
    </div>

    <div v-else-if="stockData" class="stock-content">
      <div class="stock-header">
        <div class="stock-title">
          <h2>{{ stockData.name }}</h2>
          <span class="stock-code">{{ stockData.code }}</span>
          <span v-if="stockData.exchange" class="stock-exchange">{{ exchangeLabel }}</span>
        </div>
      </div>

      <div class="stock-price-section">
        <div class="current-price" :class="changeClass">{{ formatPrice(stockData.price) }}</div>
        <div class="price-change">
          <span class="change-value" :class="changeClass">{{ formatChange(stockData.change) }}</span>
          <span class="change-percent" :class="changeClass">{{ formatPercent(stockData.changePercent) }}</span>
        </div>
      </div>

      <div class="stock-detail-grid">
        <div class="detail-item"><span class="detail-label">{{ t('stockPopup.open') }}</span><span class="detail-value">{{ formatPrice(stockData.open) }}</span></div>
        <div class="detail-item"><span class="detail-label">{{ t('stockPopup.prevClose') }}</span><span class="detail-value">{{ formatPrice(stockData.prevClose) }}</span></div>
        <div class="detail-item"><span class="detail-label">{{ t('stockPopup.high') }}</span><span class="detail-value high">{{ formatPrice(stockData.high) }}</span></div>
        <div class="detail-item"><span class="detail-label">{{ t('stockPopup.low') }}</span><span class="detail-value low">{{ formatPrice(stockData.low) }}</span></div>
      </div>

      <div class="stock-section">
        <h4 class="section-title">{{ t('stockPopup.tradeData') }}</h4>
        <div class="stock-detail-grid">
          <div class="detail-item"><span class="detail-label">{{ t('stockPopup.volume') }}</span><span class="detail-value">{{ formatVolume(stockData.volume) }}</span></div>
          <div class="detail-item"><span class="detail-label">{{ t('stockPopup.amount') }}</span><span class="detail-value">{{ formatAmount(stockData.amount) }}</span></div>
          <div class="detail-item"><span class="detail-label">{{ t('stockPopup.turnover') }}</span><span class="detail-value">{{ formatPercent(stockData.turnoverRate) }}</span></div>
          <div class="detail-item"><span class="detail-label">{{ t('stockPopup.amplitude') }}</span><span class="detail-value">{{ formatPercent(stockData.amplitude) }}</span></div>
        </div>
      </div>

      <div class="stock-section">
        <h4 class="section-title">{{ t('stockPopup.valuationMetrics') }}</h4>
        <div class="stock-detail-grid">
          <div class="detail-item"><span class="detail-label">{{ t('stockPopup.peDynamic') }}</span><span class="detail-value">{{ formatPE(stockData.pe) }}</span></div>
          <div class="detail-item"><span class="detail-label">{{ t('stockPopup.totalMarketValue') }}</span><span class="detail-value">{{ formatMarketCap(stockData.marketCap) }}</span></div>
        </div>
      </div>

      <div class="stock-section chart-section">
        <div class="chart-header">
          <h4 class="section-title">{{ t('stockPopup.chart') }}</h4>
          <div class="chart-period-tabs">
            <BButton v-for="range in klinePeriods" :key="range.value" plain size="small" :class="{ active: klineSelectedRange === range.value }" @click="setKlineRange(range.value)">{{ range.label }}</BButton>
          </div>
        </div>
        <div class="chart-loading" v-if="klineLoading"><div class="loading-spinner"></div><span>{{ t('stockPopup.loadingKline') }}</span></div>
        <div class="chart-error" v-else-if="klineError"><span>{{ klineError }}</span></div>
        <div class="chart-wrapper" v-else-if="filteredKlineData.length > 0">
          <div ref="klineChartEl" class="kline-chart"></div>
          <div class="chart-summary" v-if="klineSummary">
            <div class="summary-item"><span class="summary-label">{{ t('stockPopup.rangeChange') }}</span><span class="summary-value" :class="klineSummary.changePercent >= 0 ? 'up' : 'down'">{{ klineSummary.changePercent >= 0 ? '+' : '' }}{{ fmtNumber(klineSummary.changePercent, 2) }}%</span></div>
            <div class="summary-item"><span class="summary-label">{{ t('stockPopup.startPrice') }}</span><span class="summary-value">{{ fmtNumber(klineSummary.startPrice, 2) }}</span></div>
            <div class="summary-item"><span class="summary-label">{{ t('stockPopup.latestPrice') }}</span><span class="summary-value">{{ fmtNumber(klineSummary.endPrice, 2) }}</span></div>
            <div class="summary-item"><span class="summary-label">{{ t('stockPopup.high') }}</span><span class="summary-value high">{{ fmtNumber(klineSummary.high, 2) }}</span></div>
            <div class="summary-item"><span class="summary-label">{{ t('stockPopup.low') }}</span><span class="summary-value low">{{ fmtNumber(klineSummary.low, 2) }}</span></div>
          </div>
        </div>
        <div class="chart-empty" v-else-if="!klineLoading && !klineError"><span>{{ t('stockPopup.emptyHistory') }}</span></div>
      </div>
    </div>

    <div v-else class="stock-empty"><p>{{ t('stockPopup.emptyQuote') }}</p></div>
  </div>
</template>

<script setup lang="ts">
import BButton from './BButton.vue'
import { useI18n } from 'vue-i18n'
import LucideIcon from './LucideIcon.vue'
import { useStockPopup } from '../composables/useStockPopup'
import { fmtNumber } from '../utils/number'

const { t } = useI18n()

const props = defineProps({
  stockData: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' }
})

const {
  klineChartEl, klineLoading, klineError, klinePeriods, klineSelectedRange,
  filteredKlineData, klineSummary, setKlineRange, changeClass, exchangeLabel,
  formatPrice, formatChange, formatPercent, formatVolume, formatAmount,
  formatPE, formatMarketCap
} = useStockPopup(props)
</script>

<style scoped>
@import './StockPopup.css';
</style>
