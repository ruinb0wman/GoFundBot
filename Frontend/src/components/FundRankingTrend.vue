<template>
  <div class="fund-ranking-card">
    <div class="card-header" :class="{ 'header-expanded': isExpanded }">
      <h3><LucideIcon name="Trophy" :size="20" /> 同类排名走势</h3>
      <div class="time-ranges">
        <span
          v-for="range in timeRanges"
          :key="range.value"
          class="range-btn"
          :class="{ active: selectedRange === range.value }"
          @click="setTimeRange(range.value)"
        >{{ range.label }}</span>
      </div>
    </div>
    <div class="card-body">
      <div v-if="hasRankingData" class="ranking-content">
        <div ref="rankingChartEl" class="ranking-chart"></div>
        <div class="ranking-table">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>排名</th>
                <th>同类总数</th>
                <th>击败同类</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in recentRankings" :key="index">
                <td>{{ item.dateFormatted }}</td>
                <td class="rank-value">{{ item.rank }}/{{ item.total_funds }}</td>
                <td>{{ item.total_funds }}</td>
                <td :class="getPercentClass((1 - item.rank / item.total_funds) * 100)">
                  {{ ((1 - item.rank / item.total_funds) * 100).toFixed(2) }}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-else class="no-data">
        <p>暂无同类排名数据</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from '../composables/useEChartsTheme'

const props = defineProps({
  rateInSimilarType: { type: Array, default: () => [] },
  rateInSimilarPercent: { type: Array, default: () => [] },
  isExpanded: { type: Boolean, default: false }
})

const rankingChartEl = ref<HTMLElement | null>(null)
let rankingChartInstance: echarts.ECharts | null = null
const selectedRange = ref('1y')

const { echartThemeName } = useEChartsTheme()

const cssColor = (name: string, fallback = '') => {
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return val || fallback
}
const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

const timeRanges = [
  { label: '近1年', value: '1y' },
  { label: '近3年', value: '3y' },
  { label: '近5年', value: '5y' },
  { label: '全部', value: 'all' }
]

const hasRankingData = computed(() =>
  props.rateInSimilarType && props.rateInSimilarType.length > 0
)

const combinedData = computed(() => {
  if (!hasRankingData.value) return []

  const percentMap = new Map()
  props.rateInSimilarPercent?.forEach((item: any) => {
    if (item.date !== undefined) {
      percentMap.set(item.date, item.position_percentage)
    } else if (Array.isArray(item)) {
      percentMap.set(item[0], item[1])
    }
  })

  const merged = props.rateInSimilarType.map((item: any) => {
    if (item.date !== undefined) {
      const timestamp = new Date(item.date).getTime()
      return {
        x: timestamp,
        rank: item.rank,
        total_funds: item.total_funds,
        dateFormatted: item.date,
        percent: percentMap.get(item.date) || 0
      }
    }
    return {
      x: item.x,
      rank: item.y,
      total_funds: item.sc,
      dateFormatted: formatDate(item.x),
      percent: percentMap.get(item.x) || 0
    }
  })

  return merged.slice().sort((a: any, b: any) => a.x - b.x)
})

const filteredData = computed(() => {
  if (!combinedData.value.length) return []

  const now = new Date()
  let startDate = new Date(0)

  if (selectedRange.value === '1y') {
    startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
  } else if (selectedRange.value === '3y') {
    startDate = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate())
  } else if (selectedRange.value === '5y') {
    startDate = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate())
  }

  return combinedData.value.filter((item: any) => item.x >= startDate.getTime())
})

const recentRankings = computed(() => {
  return filteredData.value.slice(-5).reverse()
})

const setTimeRange = (range: string) => {
  selectedRange.value = range
  nextTick(() => {
    initRankingChart()
  })
}

const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

const getPercentClass = (defeatPercent: number) => {
  if (defeatPercent >= 80) return 'excellent'
  if (defeatPercent >= 50) return 'good'
  return 'normal'
}

const initRankingChart = () => {
  if (!rankingChartEl.value || !hasRankingData.value) return

  if (rankingChartInstance) {
    rankingChartInstance.dispose()
  }

  rankingChartInstance = echarts.init(rankingChartEl.value, echartThemeName.value)

  const percentData = filteredData.value.map((item: any) => [item.x, item.percent])

  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const dataIndex = params[0].dataIndex
        const item = filteredData.value[dataIndex]
        const defeated = ((1 - item.rank / item.total_funds) * 100).toFixed(2);
        return `
          <div style="font-weight: bold; margin-bottom: 8px;">${item.dateFormatted}</div>
          <div>排名: <strong>${item.rank}/${item.total_funds}</strong></div>
          <div>击败同类: <strong>${defeated}%</strong></div>
        `
      }
    },
    grid: {
      left: '11%',
      right: '13%',
      bottom: '12%',
      top: '4%',
      containLabel: false
    },
    xAxis: {
      type: 'time',
      boundaryGap: false
    },
    yAxis: {
      type: 'value',
      inverse: true,
      axisLabel: {
        formatter: '{value}%'
      },
      min: 0,
      max: 100
    },
    visualMap: {
      show: false,
      dimension: 1,
      pieces: [
        { lte: 10, color: cssColor('--color-success', '#52c41a') },
        { gt: 10, lte: 25, color: cssColor('--chart-2', '#91cc75') },
        { gt: 25, lte: 50, color: cssColor('--chart-3', '#fac858') },
        { gt: 50, color: cssColor('--color-danger', '#ff4d4f') }
      ]
    },
    series: [{
      name: '同类排名',
      type: 'line',
      data: percentData,
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: {
        width: 3
      },
      areaStyle: {
        opacity: 0.3
      },
      markLine: {
        silent: true,
        symbol: 'none',
        data: [
          { yAxis: 10, label: { formatter: '后10%' }, lineStyle: { color: cssColor('--color-success', '#52c41a'), type: 'dashed' } },
          { yAxis: 25, label: { formatter: '后25%' }, lineStyle: { color: cssColor('--chart-2', '#91cc75'), type: 'dashed' } },
          { yAxis: 50, label: { formatter: '中位数' }, lineStyle: { color: cssColor('--chart-3', '#fac858'), type: 'dashed' } }
        ]
      }
    }]
  }

  rankingChartInstance.setOption(option)
}

const handleResize = () => { rankingChartInstance?.resize() }

onMounted(() => {
  nextTick(() => {
    initRankingChart()
  })
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  if (rankingChartInstance) {
    rankingChartInstance.dispose()
    rankingChartInstance = null
  }
  window.removeEventListener('resize', handleResize)
})

watch(() => [props.rateInSimilarType, props.rateInSimilarPercent], () => {
  nextTick(() => {
    initRankingChart()
  })
}, { deep: true })

watch(echartThemeName, () => {
  if (rankingChartInstance) {
    rankingChartInstance.dispose()
    rankingChartInstance = null
    nextTick(() => initRankingChart())
  }
})
</script>

<style scoped>
.fund-ranking-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.card-header {
  background: var(--bg-gradient);
  color: white;
  padding: 10px 16px;
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.header-expanded {
  padding-right: 50px;
}

.time-ranges {
  display: flex;
  gap: 4px;
}

.range-btn {
  padding: 3px 8px;
  font-size: 11px;
  border-radius: 10px;
  cursor: pointer;
  background: rgba(255,255,255,0.2);
  transition: all 0.2s;
}

.range-btn:hover {
  background: rgba(255,255,255,0.3);
}

.range-btn.active {
  background: white;
  color: var(--color-primary);
  font-weight: 600;
}

.card-body {
  padding: 12px;
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ranking-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
}

.ranking-chart {
  width: 100%;
  height: 220px;
  flex-shrink: 0;
}

.ranking-table {
  flex: 1;
  overflow: auto;
  font-size: 12px;
}

.ranking-table table {
  width: 100%;
  border-collapse: collapse;
}

.ranking-table th,
.ranking-table td {
  padding: 6px 8px;
  text-align: center;
  border-bottom: 1px solid var(--border-default);
}

.ranking-table th {
  background: var(--bg-subtle);
  font-weight: 600;
  color: var(--text-primary);
}

.rank-value {
  font-weight: 600;
  color: var(--text-primary);
}

.excellent {
  color: var(--color-danger);
  font-weight: 600;
}

.good {
  color: var(--color-danger);
  font-weight: 500;
}

.normal {
  color: var(--text-secondary);
}

.no-data {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-tertiary);
}

.no-data p {
  font-size: 16px;
}
</style>
