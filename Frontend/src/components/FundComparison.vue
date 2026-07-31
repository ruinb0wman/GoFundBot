<template>
  <div class="fund-comparison" :class="{ 'compact-mode': compact }">
    <div class="comparison-header">
      <h2>
        <span class="header-icon"><LucideIcon name="TrendingUp" :size="20" /></span>
        {{ '基金对比' }}
        <span class="count-badge" v-if="selectedFunds.length">{{ selectedFunds.length }}/{{ maxFunds }}</span>
      </h2>
      <div class="header-actions" v-if="selectedFunds.length > 0">
        <BButton type="primary" icon="Download" @click="exportComparison">{{ '导出 CSV' }}</BButton>
        <BButton @click="clearSelection" :disabled="selectedFunds.length === 0">{{ '清空' }}</BButton>
      </div>
    </div>

    <div v-if="selectedFunds.length === 0" class="empty-compare-hint">
      <span class="hint-icon"><LucideIcon name="ArrowBigUp" :size="16" /></span>
      <span v-html="'点击自选基金的 + 按钮添加对比'"></span>
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
          <span>{{ `还可添加${maxFunds - selectedFunds.length}只` }}</span>
        </div>
      </div>
    </div>

    <div class="comparison-content" v-if="selectedFunds.length >= 2 && !compact">
      <div class="chart-section">
        <div class="section-header">
          <h3><LucideIcon name="BarChart3" :size="20" /> {{ '净值走势对比' }}</h3>
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
            <span>{{ '加载数据中...' }}</span>
          </div>
          <div ref="chartEl" class="chart-el"></div>
        </div>
      </div>

      <div class="data-table-section">
        <h3><LucideIcon name="ClipboardList" :size="20" /> {{ '多维度对比' }}</h3>
        <div class="table-wrapper">
          <table class="comparison-table">
            <thead>
              <tr>
                <th class="sticky-col">{{ '指标' }}</th>
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
                <td colspan="100%" class="section-title"><LucideIcon name="TrendingUp" :size="16" /> {{ '收益率' }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ '近3月' }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getValueClass(fund.returns?.m3)">
                  {{ formatReturn(fund.returns?.m3) }}
                </td>
              </tr>
              <tr>
                <td class="sticky-col">{{ '近6月' }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getValueClass(fund.returns?.m6)">
                  {{ formatReturn(fund.returns?.m6) }}
                </td>
              </tr>
              <tr>
                <td class="sticky-col">{{ '近1年' }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getValueClass(fund.returns?.y1)">
                  {{ formatReturn(fund.returns?.y1) }}
                </td>
              </tr>
              <tr>
                <td class="sticky-col">{{ '近3年' }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getValueClass(fund.returns?.y3)">
                  {{ formatReturn(fund.returns?.y3) }}
                </td>
              </tr>
              <tr>
                <td class="sticky-col">{{ '成立来' }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getValueClass(fund.returns?.all)">
                  {{ formatReturn(fund.returns?.all) }}
                </td>
              </tr>
              <tr class="section-row">
                <td colspan="100%" class="section-title"><LucideIcon name="Briefcase" :size="16" /> {{ '基金信息' }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ '基金规模' }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code">{{ fund.scale || '--' }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ '基金类型' }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code">{{ fund.fundType || '--' }}</td>
              </tr>
              <tr class="section-row">
                <td colspan="100%" class="section-title"><LucideIcon name="TriangleAlert" :size="16" /> {{ '风险指标' }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ '最大回撤(1年)' }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" class="negative">{{ formatDrawdown(fund.riskMetrics?.max_drawdown_1y) }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ '最大回撤(近3年)' }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" class="negative">{{ formatDrawdown(fund.riskMetrics?.max_drawdown_3y) }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ '夏普比率(1年)' }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getSharpeClass(fund.riskMetrics?.sharpe_ratio_1y)">{{ formatSharpe(fund.riskMetrics?.sharpe_ratio_1y) }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ '夏普比率(近3年)' }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code" :class="getSharpeClass(fund.riskMetrics?.sharpe_ratio_3y)">{{ formatSharpe(fund.riskMetrics?.sharpe_ratio_3y) }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ '年化波动率' }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code">{{ formatVolatility(fund.riskMetrics?.volatility_1y) }}</td>
              </tr>
              <tr class="section-row">
                <td colspan="100%" class="section-title"><LucideIcon name="Star" :size="16" /> {{ '评分指标' }}</td>
              </tr>
              <tr>
                <td class="sticky-col">{{ '综合评分' }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code"><span class="score-badge" :class="getScoreClass(fund.evaluation?.avgScore)">{{ fund.evaluation?.avgScore ?? '--' }}</span></td>
              </tr>
              <tr><td class="sticky-col">{{ '选证能力' }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ getEvalScore(fund, 0) }}</td></tr>
              <tr><td class="sticky-col">{{ '收益率' }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ getEvalScore(fund, 1) }}</td></tr>
              <tr><td class="sticky-col">{{ '抗风险' }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ getEvalScore(fund, 2) }}</td></tr>
              <tr><td class="sticky-col">{{ '稳定性' }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ getEvalScore(fund, 3) }}</td></tr>
              <tr><td class="sticky-col">{{ '择时能力' }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ getEvalScore(fund, 4) }}</td></tr>
              <tr class="section-row">
                <td colspan="100%" class="section-title"><LucideIcon name="User" :size="16" /> {{ '基金经理' }}</td>
              </tr>
              <tr><td class="sticky-col">{{ '基金经理' }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ fund.manager?.name || '--' }}</td></tr>
              <tr><td class="sticky-col">{{ '从业经验' }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ fund.manager?.experience || '--' }}</td></tr>
              <tr><td class="sticky-col">{{ '管理规模' }}</td><td v-for="fund in selectedFunds" :key="fund.code">{{ fund.manager?.managedSize || '--' }}</td></tr>
              <tr><td class="sticky-col">{{ '经理评分' }}</td><td v-for="fund in selectedFunds" :key="fund.code"><span v-if="fund.manager?.avgScore" class="score-badge" :class="getScoreClass(fund.manager.avgScore)">{{ fund.manager.avgScore }}</span><span v-else>{{ '未知' }}</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-else-if="selectedFunds.length === 1" class="single-fund-hint">
      <p><LucideIcon name="ArrowBigLeft" :size="16" /> {{ '请再选择至少1只基金进行对比' }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import LucideIcon from './LucideIcon.vue'
import BButton from './BButton.vue'
import { useFundComparison } from '../composables/useFundComparison'

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
