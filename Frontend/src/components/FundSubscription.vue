<template>
  <div class="subscription-card">
    <div class="card-header">
      <h3><LucideIcon name="Coins" :size="20" /> {{ '申购赎回情况' }}</h3>
    </div>
    <div class="card-body">
      <div v-if="hasRedemptionData" class="subscription-content">
        <div ref="chartEl" class="subscription-chart"></div>
        <div class="subscription-table">
          <table>
            <thead>
              <tr>
                <th>{{ '日期' }}</th>
                <th>{{ '期间申购(亿)' }}</th>
                <th>{{ '期间赎回(亿)' }}</th>
                <th>{{ '净申购(亿)' }}</th>
                <th>{{ '总份额(亿)' }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in tableData" :key="index">
                <td>{{ item.date }}</td>
                <td class="buy">{{ item.buy }}</td>
                <td class="sell">{{ item.sell }}</td>
                <td :class="parseFloat(item.netBuy) >= 0 ? 'positive' : 'negative'">{{ item.netBuy }}</td>
                <td>{{ item.total }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-else class="no-data">
        <p>{{ '暂无申购赎回数据' }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from '../composables/useEChartsTheme'

import type { SubscriptionRedemption } from '../types'

const props = withDefaults(defineProps<{
  subscriptionRedemption?: SubscriptionRedemption
}>(), {
  subscriptionRedemption: () => ({}),
})

function cssColor(name: string, fallback = ''): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

const { echartThemeName } = useEChartsTheme()
const chartEl = ref<HTMLElement | null>(null)
let chartInstance: echarts.ECharts | null = null

const hasRedemptionData = computed(() => {
  const series = props.subscriptionRedemption?.series
  return series && Array.isArray(series) && series.length > 0
})

const tableData = computed(() => {
  const categories = props.subscriptionRedemption?.categories || []
  const series = props.subscriptionRedemption?.series || []
  const buyData = series.find(s => s.name === '期间申购')?.data || []
  const sellData = series.find(s => s.name === '期间赎回')?.data || []
  const totalData = series.find(s => s.name === '总份额')?.data || []
  return categories.map((date: string, index: number) => {
    const buy = buyData[index] ?? 0
    const sell = sellData[index] ?? 0
    return {
      date,
      buy: buy.toFixed(2),
      sell: sell.toFixed(2),
      netBuy: (buy - sell).toFixed(2),
      total: (totalData[index] ?? 0).toFixed(2),
    }
  })
})

function initChart(): void {
  if (!chartEl.value || !hasRedemptionData.value) return
  if (chartInstance) chartInstance.dispose()
  chartInstance = echarts.init(chartEl.value, echartThemeName.value)
  const categories = props.subscriptionRedemption?.categories || []
  const series = props.subscriptionRedemption?.series || []
  const buyData = series.find(s => s.name === '期间申购')?.data || []
  const sellData = series.find(s => s.name === '期间赎回')?.data || []
  const totalData = series.find(s => s.name === '总份额')?.data || []
  const option = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['期间申购', '期间赎回', '总份额'], bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: '3%', right: '4%', bottom: '12%', top: '13%', containLabel: true },
    xAxis: { type: 'category', data: categories, axisLabel: { fontSize: 11 } },
    yAxis: [
      { type: 'value', name: '申购/赎回(亿)', position: 'left', axisLabel: { fontSize: 10 } },
      { type: 'value', name: '总份额(亿)', position: 'right', axisLabel: { fontSize: 10 } },
    ],
    series: [
      { name: '期间申购', type: 'bar', data: buyData, itemStyle: { color: cssColor('--color-danger', '#ff4d4f') }, barWidth: '20%' },
      { name: '期间赎回', type: 'bar', data: sellData, itemStyle: { color: cssColor('--color-success', '#52c41a') }, barWidth: '20%' },
      { name: '总份额', type: 'line', yAxisIndex: 1, data: totalData, itemStyle: { color: cssColor('--color-primary', '#1890ff') }, lineStyle: { width: 2 }, symbol: 'circle', symbolSize: 6 },
    ],
  }
  chartInstance.setOption(option)
}

onMounted(() => { nextTick(() => initChart()) })
watch(() => props.subscriptionRedemption, () => { nextTick(() => initChart()) }, { deep: true })
watch(echartThemeName, () => { nextTick(() => initChart()) })
</script>

<style scoped>
.subscription-card { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.card-header { background: var(--bg-gradient); padding: 10px 16px; flex-shrink: 0; }
.card-header h3 { margin: 0; color: white; font-size: 15px; font-weight: 600; }
.card-body { padding: 12px; flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.subscription-content { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.subscription-chart { width: 100%; height: 220px; flex-shrink: 0; }
.subscription-table { flex: 1; overflow: auto; }
.subscription-table table { width: 100%; border-collapse: collapse; font-size: 12px; }
.subscription-table th, .subscription-table td { padding: 8px 12px; text-align: center; border-bottom: 1px solid var(--border-default); }
.subscription-table th { background: var(--bg-subtle); font-weight: 600; color: var(--text-primary); }
.subscription-table .buy { color: var(--color-danger); }
.subscription-table .sell { color: var(--color-success); }
.subscription-table .positive { color: var(--color-danger); font-weight: 600; }
.subscription-table .negative { color: var(--color-success); font-weight: 600; }
.no-data { display: flex; align-items: center; justify-content: center; height: 200px; color: var(--text-tertiary); }
</style>
