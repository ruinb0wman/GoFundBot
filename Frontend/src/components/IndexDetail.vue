<template>
  <div class="index-detail">
    <div v-if="loading" class="loading-state">{{ t('indexDetail.loading') }}</div>
    <div v-else-if="error" class="error-state">{{ error }}</div>
    <template v-else-if="detail">
      <div class="detail-header">
        <div class="header-main">
          <h2>{{ detail.name }}</h2>
          <div class="price-section" :class="priceDir">
            <span class="price">{{ detail.price }}</span>
            <span class="change">{{ detail.change_amt >= 0 ? '+' : '' }}{{ detail.change_amt }}</span>
            <span class="pct">{{ fmtPercent(detail.change_pct) }}</span>
          </div>
        </div>
        <div class="header-meta">
          <span class="code">{{ t('indexDetail.code') }} {{ detail.code }}</span>
          <span class="market">{{ detail.market }}</span>
        </div>
      </div>

      <div class="kline-section">
        <div class="kline-header">
          <div class="period-tabs">
            <span v-for="p in periods" :key="p.key" :class="{ active: activePeriod === p.key }" @click="switchPeriod(p.key)">{{ p.label }}</span>
          </div>
          <div class="range-tabs">
            <span v-for="r in rangeOptions" :key="r.key" :class="{ active: activeRange === r.key }" @click="switchRange(r.key)">{{ r.label }}</span>
          </div>
          <div class="ma-tabs">
            <span v-for="ma in MA_PRESETS" :key="ma.period" :class="{ active: activeMAs.includes(ma.period) }" @click="toggleMA(ma.period)">
              <span class="ma-dot" :style="{ background: ma.color }"></span>{{ ma.label }}
            </span>
          </div>
        </div>
        <div class="kline-chart">
          <v-chart class="chart" :option="klineOption" autoresize :theme="echartThemeName" v-if="klineData.length" />
          <div v-else class="empty-state">{{ t('indexDetail.noKline') }}</div>
        </div>
      </div>

      <div class="stats-section">
        <div class="stat-card"><span class="stat-label">{{ t('indexDetail.open') }}</span><span class="stat-value">{{ detail.open || '--' }}</span></div>
        <div class="stat-card"><span class="stat-label">{{ t('indexDetail.high') }}</span><span class="stat-value">{{ detail.high || '--' }}</span></div>
        <div class="stat-card"><span class="stat-label">{{ t('indexDetail.low') }}</span><span class="stat-value">{{ detail.low || '--' }}</span></div>
        <div class="stat-card"><span class="stat-label">{{ t('indexDetail.prevClose') }}</span><span class="stat-value">{{ detail.prev_close || '--' }}</span></div>
        <div class="stat-card"><span class="stat-label">{{ t('indexDetail.volume') }}</span><span class="stat-value">{{ detail.volume || '--' }}</span></div>
        <div class="stat-card"><span class="stat-label">{{ t('indexDetail.amount') }}</span><span class="stat-value">{{ detail.amount || '--' }}</span></div>
        <div class="stat-card"><span class="stat-label">{{ t('indexDetail.amplitude') }}</span><span class="stat-value">{{ detail.amplitude ? detail.amplitude + '%' : '--' }}</span></div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { marketAPI } from '../services/api'

const { t } = useI18n()
import { MA_PRESETS, calcMA } from '../utils/ma'
import { fmtPercent } from '../utils/number'
import { useEChartsTheme } from '../composables/useEChartsTheme'
import { use } from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { CandlestickChart, BarChart, LineChart } from "echarts/charts"
import { GridComponent, TooltipComponent, DataZoomComponent } from "echarts/components"
import VChart from "vue-echarts"

use([CanvasRenderer, CandlestickChart, BarChart, LineChart, GridComponent, TooltipComponent, DataZoomComponent])

const props = defineProps<{ indexCode: string }>()

const loading = ref(true)
const error = ref('')
const detail = ref<any>(null)
const klineData = ref<any[]>([])
const activePeriod = ref('weekly')
const periods = computed(() => [
  { key: 'daily', label: t('indexDetail.periodDaily') },
  { key: 'weekly', label: t('indexDetail.periodWeekly') },
  { key: 'monthly', label: t('indexDetail.periodMonthly') },
])
const activeRange = ref('3y')
const rangeOptions = computed(() => {
  const all = [
    { key: '6m', label: t('indexDetail.range6m') },
    { key: '1y', label: t('indexDetail.range1y') },
    { key: '3y', label: t('indexDetail.range3y') },
    { key: '5y', label: t('indexDetail.range5y') },
    { key: 'all', label: t('indexDetail.rangeAll') },
  ]
  if (activePeriod.value === 'daily') {
    return all.filter(r => r.key === '6m' || r.key === '1y')
  }
  if (activePeriod.value === 'weekly') {
    return all.filter(r => r.key !== '6m')
  }
  if (activePeriod.value === 'monthly') {
    return all.filter(r => r.key !== '6m' && r.key !== '1y')
  }
  return all
})

const activeMAs = ref<number[]>([5, 20])
const toggleMA = (period: number) => {
  if (activeMAs.value.includes(period)) {
    activeMAs.value = activeMAs.value.filter(p => p !== period)
  } else {
    activeMAs.value = [...activeMAs.value, period]
  }
}

const { echartThemeName } = useEChartsTheme()

const priceDir = computed(() => {
  if (!detail.value) return ''
  const pct = detail.value.change_pct
  if (pct > 0) return 'up'
  if (pct < 0) return 'down'
  return ''
})

const cssVar = (name: string, fallback = '') =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

const hexToRgba = (hex: string, alpha: number) => {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

const klineOption = computed(() => {
  echartThemeName.value
  const data = klineData.value
  if (!data.length) return {}

  const dates = data.map((i: any) => (i.date || i.time || '').slice(5))
  const ohlc = data.map((i: any) => [i.open, i.close, i.low, i.high])
  const volumes = data.map((i: any) => parseFloat(i.volume || 0))

  const upColor = cssVar('--color-danger', '#ff4d4f')
  const downColor = cssVar('--color-success', '#52c41a')

  return {
    grid: [
      { left: 50, right: 20, top: 10, bottom: 80, height: '55%' },
      { left: 50, right: 20, top: '72%', bottom: 10, height: '20%' }
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      borderWidth: 1,
      formatter: (params: any) => {
        const idx = params[0].dataIndex
        const d = data[idx]
        const isUp = d.close >= d.open
        const color = isUp ? upColor : downColor
        let html = `<div style="margin-bottom:4px;font-weight:bold">${d.date || d.time}</div>
          <div>开盘: <b>${d.open}</b></div>
          <div>收盘: <b style="color:${color}">${d.close}</b></div>
          <div>最高: <b>${d.high}</b></div>
          <div>最低: <b>${d.low}</b></div>
          <div>成交量: ${d.volume || 0}</div>`
        for (const p of params) {
          if (p.seriesName?.startsWith('MA') && p.value !== undefined && p.value !== '-' && p.value !== null) {
            html += `<div>${p.marker} ${p.seriesName}: <b>${p.value}</b></div>`
          }
        }
        return html
      }
    },
    xAxis: [
      {
        type: 'category',
        data: dates,
        gridIndex: 0,
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false }
      },
      {
        type: 'category',
        data: dates,
        gridIndex: 1,
        axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 },
        axisLine: { lineStyle: { color: cssVar('--border-default', '#e5e7eb') } },
        axisTick: { show: false }
      }
    ],
    yAxis: [
      {
        type: 'value',
        scale: true,
        gridIndex: 0,
        splitLine: { lineStyle: { type: 'dashed', color: cssVar('--border-subtle', '#f0f0f0') } },
        axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 }
      },
      {
        type: 'value',
        gridIndex: 1,
        splitLine: { show: false },
        axisLabel: { show: false }
      }
    ],
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        start: 0,
        end: 100,
        zoomOnMouseWheel: 'ctrl',
        moveOnMouseWheel: true,
        moveOnMouseMove: true,
      },
      { type: 'slider', xAxisIndex: [0, 1], start: 0, end: 100, bottom: 0, height: 20 }
    ],
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        data: ohlc,
        itemStyle: {
          color: upColor,
          color0: downColor,
          borderColor: upColor,
          borderColor0: downColor
        },
        xAxisIndex: 0,
        yAxisIndex: 0
      },
      ...activeMAs.value.map(period => {
        const config = MA_PRESETS.find(m => m.period === period)
        const maValues = calcMA(period, data.map((i: any) => parseFloat(i.close)))
        return {
          name: `MA${period}`,
          type: 'line',
          data: maValues.map(v => v === null ? '-' : v),
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 1, color: config?.color || '#999' },
          xAxisIndex: 0,
          yAxisIndex: 0
        }
      }),
      {
        name: '成交量',
        type: 'bar',
        data: volumes.map((v: number, i: number) => ({
          value: v,
          itemStyle: {
            color: data[i].close >= data[i].open ? hexToRgba(upColor, 0.5) : hexToRgba(downColor, 0.5)
          }
        })),
        xAxisIndex: 1,
        yAxisIndex: 1
      }
    ]
  }
})

const fetchDetail = async () => {
  try {
    const res = await marketAPI.getIndexDetail(props.indexCode)
    if (res.data.success) {
      detail.value = res.data.data
    } else {
      error.value = res.data.error || '获取指数详情失败'
    }
  } catch (e: any) {
    error.value = '获取指数详情失败: ' + (e.response?.data?.error?.message || e.response?.data?.message || e.message)
  }
}

const computeStartDate = (range: string) => {
  if (range === 'all') return ''
  const d = new Date()
  if (range === '6m') {
    d.setMonth(d.getMonth() - 6)
  } else {
    const years: Record<string, number> = { '1y': 1, '3y': 3, '5y': 5 }
    d.setFullYear(d.getFullYear() - (years[range] || 1))
  }
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

const fetchKline = async () => {
  try {
    const params: Record<string, any> = { period: activePeriod.value }
    const startDate = computeStartDate(activeRange.value)
    if (startDate) params.startDate = startDate
    const res = await marketAPI.getIndexKline(props.indexCode, params)
    if (res.data.success) {
      klineData.value = res.data.data || []
    } else {
      klineData.value = []
    }
  } catch (e) {
    klineData.value = []
  }
}

const switchPeriod = (key: string) => {
  activePeriod.value = key
  const rangeMap: Record<string, string> = { daily: '1y', weekly: '3y', monthly: '5y' }
  activeRange.value = rangeMap[key] || '1y'
  fetchKline()
}

const switchRange = (key: string) => {
  activeRange.value = key
  fetchKline()
}

const loadAll = async () => {
  loading.value = true
  error.value = ''
  await Promise.all([fetchDetail(), fetchKline()])
  loading.value = false
}

watch(() => props.indexCode, () => { loadAll() })

onMounted(() => { loadAll() })
</script>

<style scoped>
.index-detail {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow-md);
}

.loading-state, .error-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-tertiary);
  font-size: 1.1em;
}

.error-state {
  color: var(--color-danger);
}

.detail-header {
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.header-main h2 {
  margin: 0 0 8px 0;
  font-size: 1.5em;
  color: var(--text-primary);
}

.price-section {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.price-section .price {
  font-size: 2em;
  font-weight: 700;
}

.price-section .change {
  font-size: 1.1em;
  font-weight: 500;
}

.price-section .pct {
  font-size: 1em;
  font-weight: 500;
}

.price-section.up { color: var(--color-danger); }
.price-section.down { color: var(--color-success); }

.header-meta {
  margin-top: 8px;
  display: flex;
  gap: 16px;
  font-size: 0.85em;
  color: var(--text-tertiary);
}

.kline-section {
  margin-bottom: 24px;
}

.kline-header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.period-tabs,
.range-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-subtle);
  padding: 3px;
  border-radius: var(--radius-sm);
}

.period-tabs span,
.range-tabs span {
  padding: 6px 16px;
  border-radius: 4px;
  font-size: 0.9em;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.period-tabs span:hover,
.range-tabs span:hover {
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.period-tabs span.active {
  color: var(--color-primary);
  font-weight: 600;
  background: var(--color-primary-bg);
}

.range-tabs span.active {
  color: var(--color-primary);
  font-weight: 600;
  background: var(--color-primary-bg);
}

.ma-tabs {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
  align-items: center;
}

.ma-tabs span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.85em;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}
.ma-tabs span:hover {
  color: var(--color-primary);
  background: var(--color-primary-bg);
}
.ma-tabs span.active {
  color: var(--color-primary);
  font-weight: 600;
  background: var(--color-primary-bg);
}
.ma-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.kline-chart {
  height: 440px;
}

.chart {
  height: 100%;
  width: 100%;
}

.empty-state {
  text-align: center;
  padding: 80px 20px;
  color: var(--text-tertiary);
  font-size: 1em;
}

.stats-section {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
}

.stat-card {
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}
.stat-label {
  display: block;
  font-size: 0.8em;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}
.stat-value {
  font-size: 1.05em;
  font-weight: 600;
  color: var(--text-primary);
}
</style>
