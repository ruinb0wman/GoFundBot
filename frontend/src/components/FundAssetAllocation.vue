<template>
  <div class="asset-allocation-card">
    <div class="card-header">
      <h3><LucideIcon name="BarChart3" :size="20" /> {{ '资产配置' }}</h3>
    </div>
    <div class="card-body">
      <div v-if="hasData" class="allocation-content">
        <div class="chart-container">
          <div v-if="hasLeverage" class="leverage-badge"><LucideIcon name="TriangleAlert" :size="14" /> {{ '该基金存在杠杆' }}</div>
          <div ref="chartEl" class="allocation-chart"></div>
        </div>
        <div class="legend-info">
          <div v-for="(serie, index) in displaySeries" :key="index" class="legend-item">
            <span class="legend-dot" :style="{ background: getBarColor(serie.name, getBarIndex(serie.name)) }"></span>
            <span class="legend-name">{{ serie.name }}</span>
            <span class="legend-value">{{ formatValue(serie.data[serie.data.length - 1], serie.name) }}</span>
          </div>
        </div>
      </div>
      <div v-else class="no-data">
        <p>{{ '暂无资产配置数据' }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from '../composables/useEChartsTheme'

const props = withDefaults(defineProps<{ assetAllocation?: Record<string, any> }>(), { assetAllocation: () => ({}) })

const cssColor = (name: string, fallback = '') => {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}
const { echartThemeName } = useEChartsTheme()
const chartEl = ref<HTMLElement | null>(null)
let chartInstance: echarts.ECharts | null = null

const getColors = () => [
  cssColor('--chart-1', '#1677ff'),
  cssColor('--chart-2', '#52c41a'),
  cssColor('--chart-3', '#faad14'),
  cssColor('--chart-4', '#ff4d4f'),
  cssColor('--chart-5', '#73c0de'),
  cssColor('--chart-6', '#3ba272'),
  cssColor('--chart-7', '#fc8452'),
  cssColor('--chart-8', '#9a60b4'),
  cssColor('--chart-9', '#ea7ccc')
]
const getOtherColor = () => cssColor('--chart-10', '#bfbfbf')

const cleanName = (name: string) => {
  if (!name) return name
  return name.replace(/占净比$/, '')
}

const processedAllocation = computed(() => {
  const rawSeries = props.assetAllocation?.series || []
  const cats = props.assetAllocation?.categories || []

  if (!cats.length || !rawSeries.length) {
    return { categories: [], series: [], hasLeverage: false, hasOther: false }
  }

  const cleanedSeries = rawSeries.map((s: any) => ({
    ...s,
    name: cleanName(s.name),
    data: [...(s.data || [])]
  }))

  const pctSeries = cleanedSeries.filter((s: any) => s.name !== '净资产')
  const netAssetIdx = cleanedSeries.findIndex((s: any) => s.name === '净资产')

  const numPeriods = cats.length
  const otherData: number[] = []
  let hasLeverage = false

  for (let i = 0; i < numPeriods; i++) {
    let sum = 0
    for (const serie of pctSeries) {
      sum += parseFloat(serie.data[i]) || 0
    }

    if (sum > 100.01) {
      hasLeverage = true
      otherData.push(0)
    } else if (sum < 99.99) {
      otherData.push(parseFloat((100 - sum).toFixed(2)))
    } else {
      otherData.push(0)
    }
  }

  const hasOther = otherData.some(v => v > 0)

  if (hasOther) {
    const otherSeries = {
      name: '其他',
      type: null,
      data: otherData,
      yAxis: 0
    }
    if (netAssetIdx >= 0) {
      cleanedSeries.splice(netAssetIdx, 0, otherSeries)
    } else {
      cleanedSeries.push(otherSeries)
    }
  }

  return { categories: cats, series: cleanedSeries, hasLeverage, hasOther }
})

const categories = computed(() => processedAllocation.value.categories)
const series = computed(() => processedAllocation.value.series)
const hasData = computed(() => categories.value.length > 0 && series.value.length > 0)
const hasLeverage = computed(() => processedAllocation.value.hasLeverage)

const getBarColor = (name: string, _index: number) => {
  if (name === '其他') return getOtherColor()
  const nonOtherBarNames = series.value
    .filter((s: any) => s.name !== '净资产' && s.name !== '其他')
    .map((s: any) => s.name)
  const nonOtherIdx = nonOtherBarNames.indexOf(name)
  const cols = getColors()
  return nonOtherIdx >= 0 ? cols[nonOtherIdx % cols.length] : cols[0]
}

const getBarIndex = (name: string) => {
  const barNames = series.value.filter((s: any) => s.name !== '净资产').map((s: any) => s.name)
  return barNames.indexOf(name)
}

const formatValue = (value: any, name: string) => {
  if (value === null || value === undefined) return '--'
  if (name === '净资产') {
    return value + '亿'
  }
  return value + '%'
}

const initChart = () => {
  if (!chartEl.value || !hasData.value) return

  if (chartInstance) {
    chartInstance.dispose()
  }

  chartInstance = echarts.init(chartEl.value, echartThemeName.value)

  const barSeries = series.value
    .filter((s: any) => s.name !== '净资产')
    .map((serie: any, index: number) => ({
      name: serie.name,
      type: 'bar',
      stack: 'total',
      data: serie.data,
      itemStyle: {
        color: getBarColor(serie.name, index)
      },
      label: {
        show: true,
        position: 'inside',
        formatter: (p: any) => p.value > 5 ? p.value + '%' : ''
      }
    }))

  const netAssetSerie = series.value.find((s: any) => s.name === '净资产')
  const lineSeries = netAssetSerie ? [{
    name: '净资产',
    type: 'line',
    yAxisIndex: 1,
    data: netAssetSerie.data,
    itemStyle: {
      color: cssColor('--chart-4', '#ee6666')
    },
    lineStyle: {
      width: 3
    },
    symbol: 'circle',
    symbolSize: 8
  }] : []

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow'
      },
      formatter: (params: any) => {
        let result = `<div style="font-weight: bold; margin-bottom: 8px;">${params[0].axisValue}</div>`
        params.forEach((param: any) => {
          const unit = param.seriesName === '净资产' ? '亿' : '%'
          result += `<div style="margin: 4px 0;">
            <span style="display:inline-block;margin-right:5px;border-radius:50%;width:10px;height:10px;background-color:${param.color};"></span>
            ${param.seriesName}: <strong>${param.value}${unit}</strong>
          </div>`
        })
        return result
      }
    },
    legend: {
      data: series.value.map((s: any) => s.name),
      bottom: 0,
      type: 'scroll'
    },
    grid: {
      left: '3%',
      right: '5%',
      bottom: '10%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: categories.value,
      boundaryGap: true
    },
    yAxis: [
      {
        type: 'value',
        axisLabel: { formatter: '{value}%' },
        splitLine: { show: true }
      },
      {
        type: 'value',
        name: '净资产(亿)',
        position: 'right',
        axisLabel: { formatter: '{value}' },
        splitLine: { show: false }
      }
    ],
    series: [...barSeries, ...lineSeries]
  }

  chartInstance.setOption(option)
}

const handleResize = () => { chartInstance?.resize() }

onMounted(() => {
  nextTick(() => {
    initChart()
  })
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
  window.removeEventListener('resize', handleResize)
})

watch(() => props.assetAllocation, () => {
  nextTick(() => {
    initChart()
  })
}, { deep: true })

watch(echartThemeName, () => {
  nextTick(() => {
    initChart()
  })
})

const displaySeries = computed(() => series.value.filter((s: any) => s.name !== '净资产'))
</script>

<style scoped>
.asset-allocation-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.card-header {
  background: var(--bg-gradient);
  color: white;
  padding: 12px 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.chart-container {
  position: relative;
  flex: 1;
  min-height: 200px;
}

.leverage-badge {
  position: absolute;
  top: 4px;
  left: 8px;
  z-index: 10;
  padding: 4px 10px;
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning);
  border-radius: 4px;
  color: var(--color-warning);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}

.card-body {
  padding: 12px;
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.allocation-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.allocation-chart {
  width: 100%;
  height: 100%;
  min-height: 200px;
}

.legend-info {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  padding: 8px 0;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.legend-name {
  color: var(--text-secondary);
}

.legend-value {
  font-weight: 600;
  color: var(--text-primary);
}

.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
}
</style>
