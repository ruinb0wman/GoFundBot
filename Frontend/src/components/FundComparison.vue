<template>
  <div class="fund-comparison" :class="{ 'compact-mode': compact }">
    <div class="comparison-header">
      <h2>
        <span class="header-icon"><LucideIcon name="TrendingUp" :size="20" /></span>
        {{ t('fund.compare') }}
        <span class="count-badge" v-if="selectedFunds.length">{{ selectedFunds.length }}/{{ maxFunds }}</span>
      </h2>
      <div class="header-actions" v-if="selectedFunds.length > 0">
        <BButton type="primary" icon="Download" @click="exportComparison">{{ t('fund.compare.export') }}</BButton>
        <BButton @click="clearSelection" :disabled="selectedFunds.length === 0">{{ t('fund.compare.clear') }}</BButton>
      </div>
    </div>

    <div v-if="selectedFunds.length === 0" class="empty-compare-hint">
      <span class="hint-icon"><LucideIcon name="ArrowBigUp" :size="16" /></span>
      <span v-html="t('fund.compare.empty')"></span>
    </div>

    <div class="selection-area" v-if="selectedFunds.length > 0">
      <div class="selection-tags">
        <div
          v-for="fund in selectedFunds"
          :key="fund.code"
          class="fund-tag"
          :style="{ borderColor: fund.color }"
        >
          <span class="tag-color" :style="{ background: fund.color }"></span>
          <span class="tag-name">{{ fund.name }}</span>
          <span class="tag-code">({{ fund.code }})</span>
          <BButton circle size="small" @click="removeFund(fund.code)">×</BButton>
        </div>
        <div v-if="selectedFunds.length < maxFunds" class="add-fund-hint">
          <span>{{ t('fund.compare.maxHint', { count: maxFunds - selectedFunds.length }) }}</span>
        </div>
      </div>
    </div>

    <div class="comparison-content" v-if="selectedFunds.length >= 2 && !compact">
      <div class="chart-section">
        <div class="section-header">
          <h3><LucideIcon name="BarChart3" :size="20" /> {{ t('fund.compare.netWorthChart') }}</h3>
          <div class="time-ranges">
            <div
              v-for="range in timeRanges"
              :key="range.value"
              class="range-item"
              :class="{ active: selectedRange === range.value }"
              @click="setTimeRange(range.value)"
            >
              {{ range.label }}
            </div>
          </div>
        </div>
        <div class="chart-container">
          <div v-if="loading" class="chart-loading">
            <div class="spinner"></div>
            <span>{{ t('fund.compare.loading') }}</span>
          </div>
          <div ref="chartEl" class="chart-el"></div>
        </div>
      </div>

      <div class="data-table-section">
        <h3><LucideIcon name="ClipboardList" :size="20" /> {{ t('fund.compare.multiDim') }}</h3>
        <div class="table-wrapper">
          <table class="comparison-table">
            <thead>
              <tr>
                <th class="sticky-col">{{ t('fund.compare.indicator') }}</th>
                <th v-for="fund in selectedFunds" :key="fund.code">
                  <div class="fund-header">
                    <span class="color-dot" :style="{ background: fund.color }"></span>
                    <span class="fund-name-th">{{ fund.name }}</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr class="section-row">
                <td colspan="100%" class="section-title"><LucideIcon name="TrendingUp" :size="16" /> {{ t('fund.compare.returnRate') }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ t('fund.detail.month3') }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getValueClass(fund.returns?.m3)">
                  {{ formatReturn(fund.returns?.m3) }}
                </td>
              </tr>
              <tr>
                <td class="sticky-col">{{ t('fund.detail.month6') }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getValueClass(fund.returns?.m6)">
                  {{ formatReturn(fund.returns?.m6) }}
                </td>
              </tr>
              <tr>
                <td class="sticky-col">{{ t('fund.detail.year1') }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getValueClass(fund.returns?.y1)">
                  {{ formatReturn(fund.returns?.y1) }}
                </td>
              </tr>
              <tr>
                <td class="sticky-col">{{ t('fund.detail.year3') }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getValueClass(fund.returns?.y3)">
                  {{ formatReturn(fund.returns?.y3) }}
                </td>
              </tr>
              <tr>
                <td class="sticky-col">{{ t('fund.detail.sinceInception') }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getValueClass(fund.returns?.all)">
                  {{ formatReturn(fund.returns?.all) }}
                </td>
              </tr>
              <tr class="section-row">
                <td colspan="100%" class="section-title"><LucideIcon name="Briefcase" :size="16" /> {{ t('fund.compare.fundInfo') }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ t('fund.compare.scale') }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code">{{ fund.scale || '--' }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ t('fund.compare.type') }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code">{{ fund.fundType || '--' }}</td>
              </tr>
              <tr class="section-row">
                <td colspan="100%" class="section-title"><LucideIcon name="TriangleAlert" :size="16" /> {{ t('fund.compare.riskMetrics') }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ t('fund.detail.maxDrawdown1y') }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" class="negative">{{ formatDrawdown(fund.riskMetrics?.max_drawdown_1y) }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ t('fund.detail.maxDrawdown3y') }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" class="negative">{{ formatDrawdown(fund.riskMetrics?.max_drawdown_3y) }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ t('fund.detail.sharpe1y') }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getSharpeClass(fund.riskMetrics?.sharpe_ratio_1y)">{{ formatSharpe(fund.riskMetrics?.sharpe_ratio_1y) }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ t('fund.detail.sharpe3y') }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getSharpeClass(fund.riskMetrics?.sharpe_ratio_3y)">{{ formatSharpe(fund.riskMetrics?.sharpe_ratio_3y) }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ t('fund.detail.volatility1y') }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code">{{ formatVolatility(fund.riskMetrics?.volatility_1y) }}</td>
              </tr>
              <tr class="section-row">
                <td colspan="100%" class="section-title"><LucideIcon name="Star" :size="16" /> {{ t('fund.compare.scoreMetrics') }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ t('fund.compare.compositeScore') }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code"><span class="score-badge" :class="getScoreClass(fund.evaluation?.avgScore)">{{ fund.evaluation?.avgScore ?? '--' }}</span></td>
              </tr>
              <tr><td class="sticky-col">{{ t('fund.compare.stockSelection') }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ getEvalScore(fund, 0) }}</td></tr>
              <tr><td class="sticky-col">{{ t('fund.compare.returnRate') }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ getEvalScore(fund, 1) }}</td></tr>
              <tr><td class="sticky-col">{{ t('fund.compare.riskResist') }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ getEvalScore(fund, 2) }}</td></tr>
              <tr><td class="sticky-col">{{ t('fund.compare.stability') }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ getEvalScore(fund, 3) }}</td></tr>
              <tr><td class="sticky-col">{{ t('fund.compare.timing') }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ getEvalScore(fund, 4) }}</td></tr>
              <tr class="section-row">
                <td colspan="100%" class="section-title"><LucideIcon name="User" :size="16" /> {{ t('fund.compare.fundManager') }}</td>
              </tr>
              <tr><td class="sticky-col">{{ t('fund.compare.fundManager') }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ fund.manager?.name || '--' }}</td></tr>
              <tr><td class="sticky-col">{{ t('fund.compare.managerExp') }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ fund.manager?.experience || '--' }}</td></tr>
              <tr><td class="sticky-col">{{ t('fund.compare.managerScale') }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ fund.manager?.managedSize || '--' }}</td></tr>
              <tr><td class="sticky-col">{{ t('fund.compare.managerScore') }}</td><td v-for="fund in selectedFunds" :key="fund.code"><span v-if="fund.manager?.avgScore" class="score-badge" :class="getScoreClass(fund.manager.avgScore)">{{ fund.manager.avgScore }}</span><span v-else>{{ t('common.unknown') }}</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-else-if="selectedFunds.length === 1" class="single-fund-hint">
      <p><LucideIcon name="ArrowBigLeft" :size="16" /> {{ t('fund.compare.needMore') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import LucideIcon from './LucideIcon.vue'
import BButton from './BButton.vue'
import { useFundComparison } from '../composables/useFundComparison'

const { t } = useI18n()

const props = defineProps({
  compareFunds: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false }
})
const emit = defineEmits(['remove-fund', 'clear-funds'])

const {
  chartEl, selectedRange, loading, maxFunds, timeRanges, selectedFunds,
  setTimeRange, removeFund, clearSelection, exportComparison,
  getValueClass, getSharpClass, getScoreClass, getSharpeClass,
  formatReturn, formatDrawdown, formatSharpe, formatVolatility, getEvalScore
} = useFundComparison(props, emit)
</script>

<style scoped>
@import './FundComparison.css';
</style>
