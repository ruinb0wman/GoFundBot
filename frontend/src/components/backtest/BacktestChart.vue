<template>
  <div class="chart-section">
    <div ref="chartEl" class="chart-container"></div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import Decimal from 'decimal.js'
import { useEChartsTheme } from '../../composables/useEChartsTheme'
import type { PortfolioBacktestResult } from '@gofund/core/backtest/backtestTypes'

const props = defineProps<{ result: PortfolioBacktestResult }>()

const { echartThemeName } = useEChartsTheme()
const chartEl = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null

function cssColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function render() {
  if (!chartEl.value) return
  chart?.dispose()
  chart = echarts.init(chartEl.value, echartThemeName.value)

  const timeline = props.result.timeline
  const dates = timeline.map((record) => record.date)
  const primary = cssColor('--color-primary', '#1677ff')
  const tertiary = cssColor('--text-tertiary', '#9ca3af')

  chart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params: Array<{ axisValue: string; marker: string; seriesName: string; value: number }>) => {
        const head = `<div style="font-weight:bold;margin-bottom:4px">${params[0]?.axisValue ?? ''}</div>`
        return head + params
          .map((param) => `<div>${param.marker} ${param.seriesName}: ${new Decimal(param.value).toFixed(2)}</div>`)
          .join('')
      },
    },
    legend: { data: ['累计投入', '组合市值'], top: 8 },
    grid: { left: '3%', right: '4%', bottom: 40, top: 48, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: dates, axisLabel: { formatter: (value: string) => value.slice(5) } },
    yAxis: {
      type: 'value',
      name: '金额（元）',
      axisLabel: { formatter: (value: number) => new Decimal(value).div(10000).toFixed(1) + '万' },
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100, height: 18, bottom: 8 },
    ],
    series: [
      {
        name: '累计投入',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: timeline.map((record) => record.invested),
        lineStyle: { color: tertiary, width: 2 },
        itemStyle: { color: tertiary },
      },
      {
        name: '组合市值',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: timeline.map((record) => record.value),
        lineStyle: { color: primary, width: 2 },
        itemStyle: { color: primary },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: hexToRgba(primary, 0.3) },
            { offset: 1, color: hexToRgba(primary, 0.04) },
          ]),
        },
      },
    ],
  })
}

const handleResize = () => chart?.resize()

onMounted(() => {
  render()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chart?.dispose()
  chart = null
})

watch(
  () => props.result,
  () => nextTick(render),
)
watch(echartThemeName, () => render())
</script>

<style scoped>
.chart-container {
  width: 100%;
  height: 320px;
}
</style>
