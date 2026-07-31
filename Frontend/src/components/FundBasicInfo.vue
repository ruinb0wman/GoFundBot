<template>
  <div v-if="fundInfo" class="fund-basic-info">
    <div class="info-header">
      <div class="header-left-group">
        <div class="title-row">
          <h2>{{ fundInfo.name || '未知' }}</h2>
          <span class="fund-code">{{ fundCode }}</span>
          <BButton
            text
            :class="{ 'in-watchlist': isInWatchlist }"
            @click="toggleWatchlist"
            :disabled="watchlistLoading"
            :title="isInWatchlist ? '移除' : '添加自选'"
          >
            <template #icon>
              <LucideIcon name="Star" :size="16" :fill="isInWatchlist ? 'currentColor' : 'none'" />
            </template>
            <span class="btn-text">{{ isInWatchlist ? '已自选' : '自选' }}</span>
          </BButton>
          <span
            v-if="fundIndustryTag"
            class="industry-tag"
            :title="industryTagTitle"
          >
            行业 {{ fundIndustryTag.name }}
          </span>
        </div>

        <div v-if="riskMetrics" class="risk-metrics-inline">
          <div class="risk-item">
            <span class="risk-label">{{ '夏普比率(1年)' }}</span>
            <span class="risk-value" :class="getSharpeClass(riskMetrics.sharpe_ratio_1y)">
              {{ fmtNumber(riskMetrics.sharpe_ratio_1y, 2) }}
            </span>
          </div>
          <div class="risk-item">
            <span class="risk-label">{{ '最大回撤(1年)' }}</span>
            <span class="risk-value negative">
              {{ riskMetrics.max_drawdown_1y != null ? '-' + fmtNumber(riskMetrics.max_drawdown_1y, 2) + '%' : '--' }}
            </span>
          </div>
          <div class="risk-item">
            <span class="risk-label">{{ '年化波动率' }}</span>
            <span class="risk-value">
              {{ riskMetrics.volatility_1y != null ? fmtNumber(riskMetrics.volatility_1y, 2) + '%' : '--' }}
            </span>
          </div>
        </div>
      </div>

      <div class="header-middle-group">
        <BButton type="primary" size="small" icon="Sparkles" @click="$emit('trigger-ai-analysis')">
          <span class="btn-text">{{ 'AI 智能分析' }}</span>
        </BButton>
      </div>

      <div class="header-right">
        <div class="change-box">
          <div class="label">{{ isEstimateFresh ? '估算涨幅' : '涨跌幅' }}</div>
          <div class="value" :class="getChangeClass(isEstimateFresh ? fundInfo.gszzl : fundInfo.actualChange)">
            {{ displayChange }}
          </div>
          <div v-if="!isEstimateFresh && fundInfo.jzrq" class="date">{{ formatDate(fundInfo.jzrq) }}</div>
        </div>

        <div class="net-worth-box">
          <div class="label">{{ '单位净值' }}{{ isEstimateFresh ? '（最新）' : '' }}</div>
          <div class="value">{{ fundInfo.dwjz || '--' }}</div>
          <div class="date">{{ formatDate(fundInfo.jzrq) }}</div>
        </div>

        <div v-if="isEstimateFresh" class="estimate-box">
          <div class="label">{{ '估算净值' }}</div>
          <div class="value" :class="getChangeClass(fundInfo.gszzl)">
            {{ fundInfo.gsz || '--' }}
          </div>
          <div class="time">{{ formatTime(fundInfo.gztime) }}</div>
        </div>
      </div>
    </div>

    <div class="info-metrics">
      <div class="metric-item">
        <div class="metric-label">{{ '近1月' }}</div>
        <div class="metric-value" :class="getChangeClass(fundInfo.syl_1y)">
          {{ fundInfo.syl_1y ? (fundInfo.syl_1y > 0 ? '+' : '') + fundInfo.syl_1y + '%' : '--' }}
        </div>
      </div>
      <div class="metric-item">
        <div class="metric-label">{{ '近3月' }}</div>
        <div class="metric-value" :class="getChangeClass(fundInfo.syl_3y)">
          {{ fundInfo.syl_3y ? (fundInfo.syl_3y > 0 ? '+' : '') + fundInfo.syl_3y + '%' : '--' }}
        </div>
      </div>
      <div class="metric-item">
        <div class="metric-label">{{ '近6月' }}</div>
        <div class="metric-value" :class="getChangeClass(fundInfo.syl_6y)">
          {{ fundInfo.syl_6y ? (fundInfo.syl_6y > 0 ? '+' : '') + fundInfo.syl_6y + '%' : '--' }}
        </div>
      </div>
      <div class="metric-item">
        <div class="metric-label">{{ '近1年' }}</div>
        <div class="metric-value" :class="getChangeClass(fundInfo.syl_1n)">
          {{ fundInfo.syl_1n ? (fundInfo.syl_1n > 0 ? '+' : '') + fundInfo.syl_1n + '%' : '--' }}
        </div>
      </div>
      <div class="metric-item">
        <div class="metric-label">{{ '现费率' }}</div>
        <div class="metric-value rate">{{ formatRate(fundInfo.fund_rate) }}</div>
      </div>
      <div class="metric-item">
        <div class="metric-label">{{ '最小申购' }}</div>
        <div class="metric-value">{{ formatMinSubscription(fundInfo.fund_minsg) }}</div>
      </div>
    </div>

    <div v-if="loading" class="loading">{{ '加载中...' }}</div>
  </div>
</template>

<script setup lang="ts">
import BButton from './BButton.vue'
import { ref, computed, watch } from 'vue'
import { fundAPI } from '../services/api'
import { useFundStore } from '../stores/fundStore'
import { useWatchlistStore } from '../stores/watchlistStore'
import { fmtNumber } from '../utils/number'
import Decimal from 'decimal.js'

const props = withDefaults(defineProps<{
  fundCode: string
  fundData?: Record<string, any> | null
  riskMetrics?: Record<string, any> | null
}>(), {
  fundData: null,
  riskMetrics: null,
})

defineEmits<{
  'trigger-ai-analysis': []
}>()

const fundInfo = ref<Record<string, any> | null>(null)
const loading = ref(false)
const isInWatchlist = ref(false)
const watchlistLoading = ref(false)

const isEstimateFresh = computed(() => {
  if (!fundInfo.value) return false
  const estimate = parseFloat(fundInfo.value.gsz)
  if (isNaN(estimate) || estimate <= 0) return false
  if (!fundInfo.value.gztime || !fundInfo.value.jzrq) return false
  const extractNorm = (v: unknown) => {
    const s = String(v)
    const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
    return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : ''
  }
  const estDate = extractNorm(fundInfo.value.gztime)
  const navDate = extractNorm(fundInfo.value.jzrq)
  return !!estDate && !!navDate && estDate > navDate
})

const displayChange = computed(() => {
  const value = isEstimateFresh.value ? fundInfo.value?.gszzl : fundInfo.value?.actualChange
  if (value === null || value === undefined || value === '') return '--'
  const num = parseFloat(value)
  if (isNaN(num)) return '--'
  return (num > 0 ? '+' : '') + new Decimal(num).toFixed(2) + '%'
})

const fundIndustryTag = computed(() => {
  return fundInfo.value?.fund_industry_tag || fundInfo.value?.portfolio?.industry_tag || null
})

const industryTagTitle = computed(() => {
  const tag = fundIndustryTag.value
  if (!tag) return ''
  const basisMap: Record<string, string> = {
    fund_type: '按基金类型识别',
    fund_name_topic: '按基金名称主题识别',
    broad_index_name: '按宽基指数名称识别',
    index_topic: '按指数或ETF主题识别',
    holding_count: '按重仓股行业数量识别',
    holding_weight: '按重仓股行业权重识别',
    market_region: '按投资市场识别',
    mixed: '未识别到明确行业或市场主题',
  }
  if (tag.basis === 'mixed') return basisMap.mixed
  const evidence = tag.ratio > 0 ? `重仓占比 ${tag.ratio}% / 重仓股 ${tag.count || 0} 只` : `重仓股 ${tag.count || 0} 只`
  return `${basisMap[tag.basis] || '按基金信息识别'}：${tag.name}（${evidence}）`
})

watch(() => props.fundData, (newData) => {
  if (newData) processFundData(newData)
}, { immediate: true })

watch(() => props.fundCode, (newCode) => {
  if (newCode && !props.fundData) fetchFundInfo()
  if (newCode) checkWatchlistStatus()
}, { immediate: true })

async function checkWatchlistStatus(): Promise<void> {
  try {
    const store = useWatchlistStore()
    isInWatchlist.value = await store.checkInWatchlist(props.fundCode)
  } catch (error) {
    console.error('检查自选状态失败:', error)
    isInWatchlist.value = false
  }
}

async function toggleWatchlist(): Promise<void> {
  if (watchlistLoading.value || !props.fundCode) return
  watchlistLoading.value = true
  const store = useWatchlistStore()
  try {
    if (isInWatchlist.value) {
      await store.removeFund(props.fundCode)
      isInWatchlist.value = false
    } else {
      const fundName = fundInfo.value?.name || fundInfo.value?.fund_name || props.fundCode
      const fundType = fundInfo.value?.fund_type || ''
      await store.addFund(props.fundCode, fundName, fundType)
      isInWatchlist.value = true
    }
  } catch (error: any) {
    console.error('操作自选失败:', error)
    if (error.response?.status === 409) isInWatchlist.value = true
  } finally {
    watchlistLoading.value = false
  }
}

function processFundData(data: Record<string, any>): void {
  const realtime = data.realtime_estimate || {}
  let actualChange: number | null = null
  const trend = data.net_worth_trend || []
  if (trend.length >= 2) {
    const latest = parseFloat(trend[trend.length - 1]?.net_worth)
    const previous = parseFloat(trend[trend.length - 2]?.net_worth)
    if (latest > 0 && previous > 0) actualChange = new Decimal(latest).minus(previous).div(previous).mul(100).toNumber()
  }
  const extractDate = (value: unknown): string => {
    const s = String(value || '')
    const matched = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
    if (matched) return `${matched[1]}-${String(matched[2]).padStart(2, '0')}-${String(matched[3]).padStart(2, '0')}`
    return ''
  }
  const estimateDate = extractDate(realtime.estimate_time)
  const trendLatest = Array.isArray(data.net_worth_trend) && data.net_worth_trend.length ? data.net_worth_trend[data.net_worth_trend.length - 1] : null
  const trendLatestDate = extractDate(trendLatest?.date)
  const realtimeNavDate = extractDate(realtime.net_worth_date)
  const useTrendOfficial = trendLatest && trendLatest.net_worth !== undefined && trendLatest.net_worth !== null && trendLatestDate && (!realtimeNavDate || trendLatestDate >= realtimeNavDate)
  const officialNavValue = useTrendOfficial ? trendLatest.net_worth : realtime.net_worth
  const officialNavDate = useTrendOfficial ? trendLatest.date : realtime.net_worth_date
  const navDate = extractDate(officialNavDate)
  const estimateNav = parseFloat(realtime.estimate_value)
  const officialNav = parseFloat(officialNavValue)
  let estimateChange = realtime.estimate_change
  if (estimateDate && navDate && estimateDate > navDate && estimateNav > 0 && officialNav > 0) {
    estimateChange = new Decimal(estimateNav).minus(officialNav).div(officialNav).mul(100).toNumber()
  }
  fundInfo.value = {
    ...data,
    ...data.basic_info,
    name: data.basic_info?.fund_name || realtime.name,
    fund_rate: data.basic_info?.current_rate,
    fund_Rate: data.basic_info?.current_rate,
    fund_minsg: data.basic_info?.min_subscription_amount,
    fund_min_subscription: data.basic_info?.min_subscription_amount,
    syl_1y: data.performance?.['1_month_return'],
    syl_3y: data.performance?.['3_month_return'],
    syl_6y: data.performance?.['6_month_return'],
    syl_1n: data.performance?.['1_year_return'],
    dwjz: officialNavValue,
    jzrq: officialNavDate,
    gsz: realtime.estimate_value,
    gszzl: estimateChange,
    gztime: realtime.estimate_time,
    actualChange: actualChange,
  }
}

async function fetchFundInfo(): Promise<void> {
  loading.value = true
  try {
    const fundStore = useFundStore()
    const data = await fundStore.fetchFund(props.fundCode)
    processFundData(data)
  } catch (error) {
    console.error('获取基金信息失败:', error)
    fundInfo.value = null
  } finally {
    loading.value = false
  }
}

function getChangeClass(value: unknown): string {
  if (!value) return ''
  return parseFloat(String(value)) > 0 ? 'positive' : parseFloat(String(value)) < 0 ? 'negative' : ''
}

function getSharpeClass(value: unknown): string {
  if (!value) return ''
  const num = parseFloat(String(value))
  if (num >= 1) return 'positive'
  if (num >= 0) return ''
  return 'negative'
}

function formatDate(dateStr: unknown): string { return dateStr ? String(dateStr) : '--' }
function formatTime(timeStr: unknown): string { return timeStr ? String(timeStr) : '--' }

function formatRate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '--'
  const num = parseFloat(String(value))
  return isNaN(num) ? '--' : new Decimal(num).toFixed(2) + '%'
}

function formatMinSubscription(value: unknown): string {
  if (value === null || value === undefined || value === '') return '--'
  return String(value) + '元'
}
</script>

<style scoped>
.fund-basic-info {
  background: var(--bg-gradient);
  padding: 24px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  margin-bottom: 24px;
  color: var(--text-inverse);
}
[data-theme="dark"] .fund-basic-info { color: #ffffff; }
.info-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid rgba(255, 255, 255, 0.2); }
.header-left-group { display: flex; flex-direction: column; justify-content: space-between; gap: 12px; }
.title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.title-row h2 { margin: 0; font-size: 24px; font-weight: 600; }
.fund-code { background: rgba(255, 255, 255, 0.25); padding: 6px 12px; border-radius: 6px; font-size: 14px; font-weight: 500; }
.industry-tag { display: inline-flex; align-items: center; max-width: 160px; padding: 6px 12px; border-radius: 20px; background: rgba(255, 255, 255, 0.18); border: 1px solid rgba(255, 255, 255, 0.35); color: #fff; font-size: 13px; font-weight: 600; line-height: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; backdrop-filter: blur(10px); }
.btn-text { font-weight: 500; }
.header-middle-group { flex: 1; display: flex; justify-content: center; align-items: center; }
.header-right { display: flex; gap: 32px; align-items: flex-start; }
.change-box, .net-worth-box, .estimate-box { text-align: right; display: flex; flex-direction: column; }
.change-box .label, .net-worth-box .label, .estimate-box .label { font-size: 12px; opacity: 0.9; margin-bottom: 4px; }
.change-box .value, .net-worth-box .value, .estimate-box .value { font-size: 28px; font-weight: 700; line-height: 1.2; }
.change-box .date, .net-worth-box .date, .estimate-box .time { font-size: 11px; opacity: 0.8; margin-top: 4px; }
.risk-metrics-inline { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 4px; }
.risk-item { display: flex; align-items: center; gap: 8px; }
.risk-label { font-size: 12px; opacity: 0.85; }
.risk-value { font-size: 14px; font-weight: 600; padding: 2px 8px; background: rgba(255, 255, 255, 0.15); border-radius: 4px; }
.risk-value.positive { color: #ffd700; background: rgba(255, 215, 0, 0.2); }
.risk-value.negative { color: var(--color-success); background: rgba(46, 213, 115, 0.2); }
.info-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 16px; }
.metric-item { background: rgba(255, 255, 255, 0.15); padding: 12px; border-radius: 8px; text-align: center; backdrop-filter: blur(10px); }
.metric-label { font-size: 12px; opacity: 0.9; margin-bottom: 8px; }
.metric-value { font-size: 20px; font-weight: 700; }
.metric-value.rate { color: #ffd700; }
.positive { color: var(--color-danger); }
.negative { color: var(--color-success); }
.loading { text-align: center; padding: 20px; opacity: 0.8; }
</style>
