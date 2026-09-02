<template>
  <div class="evaluation-card">
    <div class="card-header">
      <h3><LucideIcon name="BarChart3" :size="20" /> {{ '基金综合评价' }}</h3>
      <div class="avg-score" v-if="avgScore">
        <span class="score-label">{{ '综合评分' }}</span>
        <span class="score-value" :class="getScoreClass(avgScore)">{{ avgScore }}</span>
      </div>
    </div>
    <div class="card-body">
      <div v-if="hasEvalData || hasRedemptionData" class="evaluation-content">
        <!-- 雷达图 + 指标详情 -->
        <div v-if="hasEvalData" class="eval-section">
          <div class="section-title">{{ '能力评估' }}</div>
          <div class="eval-grid">
            <div ref="radarChartEl" class="radar-chart"></div>
            <div class="eval-details">
              <div
                v-for="(item, index) in evalItems"
                :key="index"
                class="eval-item"
              >
                <div class="eval-item-header">
                  <span class="eval-name">{{ item.name }}</span>
                  <span class="eval-score" :class="getScoreClass(item.score)">{{ item.score }}</span>
                </div>
                <div class="eval-bar">
                  <div class="eval-bar-fill" :style="{ width: item.score + '%', background: getBarColor(item.score) }"></div>
                </div>
                <div class="eval-desc" v-html="item.desc"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 申购赎回情况 -->
        <div v-if="hasRedemptionData" class="redemption-section">
          <div class="section-title">{{ '申购赎回情况' }}</div>
          <div ref="redemptionChartEl" class="redemption-chart"></div>
          <div class="redemption-table">
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
                <tr v-for="(item, index) in redemptionTableData" :key="index">
                  <td>{{ item.date }}</td>
                  <td class="buy">{{ item.buy }}</td>
                  <td class="sell">{{ item.sell }}</td>
                  <td :class="item.netBuy >= 0 ? 'positive' : 'negative'">{{ item.netBuy }}</td>
                  <td>{{ item.total }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div v-else class="no-data">
        <p>{{ '暂无评价数据' }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from '../composables/useEChartsTheme'

const props = withDefaults(defineProps<{ fundEvaluation?: Record<string, any>; performanceEvaluation?: Record<string, any>; subscriptionRedemption?: Record<string, any> }>(), { fundEvaluation: () => ({}), performanceEvaluation: () => ({}), subscriptionRedemption: () => ({}) })

const cssColor = (name: string, fallback = '') => {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}
const { echartThemeName } = useEChartsTheme()
const radarChartEl = ref<HTMLElement | null>(null)
const redemptionChartEl = ref<HTMLElement | null>(null)
let radarChart: echarts.ECharts | null = null
let redemptionChart: echarts.ECharts | null = null

const hasEvalData = computed(() => {
  const data = props.performanceEvaluation?.data
  return data && Array.isArray(data) && data.some((v: any) => v !== null)
})

const hasRedemptionData = computed(() => {
  const series = props.subscriptionRedemption?.series
  return series && Array.isArray(series) && series.length > 0
})

const avgScore = computed(() => props.performanceEvaluation?.avr || null)

const evalItems = computed(() => {
  const categories = props.performanceEvaluation?.categories || []
  const data = props.performanceEvaluation?.data || []
  const dsc = props.performanceEvaluation?.dsc || []

  return categories.map((name: string, index: number) => ({
    name,
    score: data[index] ?? 0,
    desc: dsc[index] || ''
  }))
})

const redemptionTableData = computed(() => {
  const categories = props.subscriptionRedemption?.categories || []
  const series = props.subscriptionRedemption?.series || []

  const buyData = series.find((s: any) => s.name === '期间申购')?.data || []
  const sellData = series.find((s: any) => s.name === '期间赎回')?.data || []
  const totalData = series.find((s: any) => s.name === '总份额')?.data || []

  return categories.map((date: string, index: number) => {
    const buy = buyData[index] ?? 0
    const sell = sellData[index] ?? 0
    return {
      date,
      buy: buy.toFixed(2),
      sell: sell.toFixed(2),
      netBuy: (buy - sell).toFixed(2),
      total: (totalData[index] ?? 0).toFixed(2)
    }
  })
})

const getScoreClass = (score: number) => {
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 40) return 'normal'
  return 'poor'
}

const getBarColor = (score: number) => {
  if (score >= 80) return 'linear-gradient(90deg, var(--color-success) 0%, var(--color-success) 100%)'
  if (score >= 60) return 'linear-gradient(90deg, var(--color-primary) 0%, var(--color-primary) 100%)'
  if (score >= 40) return 'linear-gradient(90deg, var(--color-warning) 0%, var(--color-warning) 100%)'
  return 'linear-gradient(90deg, var(--color-danger) 0%, var(--color-danger) 100%)'
}

const initRadarChart = () => {
  if (!radarChartEl.value || !hasEvalData.value) return

  if (radarChart) radarChart.dispose()
  radarChart = echarts.init(radarChartEl.value, echartThemeName.value)

  const categories = props.performanceEvaluation?.categories || []
  const data = props.performanceEvaluation?.data || []

  const option = {
    tooltip: {
      trigger: 'item'
    },
    radar: {
      indicator: categories.map((name: string) => ({
        name,
        max: 100
      })),
      radius: '65%',
      axisName: {
        color: cssColor('--chart-axis-label', '#666'),
        fontSize: 11
      },
      splitArea: {
        areaStyle: {
          color: [cssColor('--color-primary-bg', '#eef4ff'), cssColor('--color-primary-bg', '#eef4ff')]
        }
      },
      axisLine: {
        lineStyle: {
          color: cssColor('--chart-grid', 'rgba(22, 119, 255, 0.3)')
        }
      },
      splitLine: {
        lineStyle: {
          color: cssColor('--border-subtle', 'rgba(22, 119, 255, 0.3)')
        }
      }
    },
    series: [{
      type: 'radar',
      data: [{
        value: data,
        name: '能力评分',
        areaStyle: {
          color: cssColor('--color-primary-bg', 'rgba(22, 119, 255, 0.3)')
        },
        lineStyle: {
          color: cssColor('--color-primary', '#1677ff'),
          width: 2
        },
        itemStyle: {
          color: cssColor('--color-primary', '#1677ff')
        }
      }]
    }]
  }

  radarChart.setOption(option)
}

const initRedemptionChart = () => {
  if (!redemptionChartEl.value || !hasRedemptionData.value) return

  if (redemptionChart) redemptionChart.dispose()
  redemptionChart = echarts.init(redemptionChartEl.value, echartThemeName.value)

  const categories = props.subscriptionRedemption?.categories || []
  const series = props.subscriptionRedemption?.series || []

  const buyData = series.find((s: any) => s.name === '期间申购')?.data || []
  const sellData = series.find((s: any) => s.name === '期间赎回')?.data || []
  const totalData = series.find((s: any) => s.name === '总份额')?.data || []

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow'
      }
    },
    legend: {
      data: ['期间申购', '期间赎回', '总份额'],
      bottom: 0,
      textStyle: {
        fontSize: 11
      }
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '15%',
      top: '10%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: {
        fontSize: 10,
        rotate: 30
      }
    },
    yAxis: [
      {
        type: 'value',
        name: '申购/赎回(亿)',
        position: 'left',
        axisLabel: {
          fontSize: 10
        }
      },
      {
        type: 'value',
        name: '总份额(亿)',
        position: 'right',
        axisLabel: {
          fontSize: 10
        }
      }
    ],
    series: [
      {
        name: '期间申购',
        type: 'bar',
        data: buyData,
        itemStyle: {
          color: cssColor('--color-success', '#52c41a')
        },
        barWidth: '25%'
      },
      {
        name: '期间赎回',
        type: 'bar',
        data: sellData,
        itemStyle: {
          color: cssColor('--color-danger', '#ff4d4f')
        },
        barWidth: '25%'
      },
      {
        name: '总份额',
        type: 'line',
        yAxisIndex: 1,
        data: totalData,
        itemStyle: {
          color: cssColor('--color-primary', '#1890ff')
        },
        lineStyle: {
          width: 2
        },
        symbol: 'circle',
        symbolSize: 6
      }
    ]
  }

  redemptionChart.setOption(option)
}

onMounted(() => {
  nextTick(() => {
    initRadarChart()
    initRedemptionChart()
  })
})

watch([() => props.performanceEvaluation, () => props.subscriptionRedemption], () => {
  nextTick(() => {
    initRadarChart()
    initRedemptionChart()
  })
}, { deep: true })

watch(echartThemeName, () => {
  nextTick(() => {
    initRadarChart()
    initRedemptionChart()
  })
})
</script>

<style scoped>
.evaluation-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.card-header {
  background: var(--bg-gradient);
  padding: 10px 16px;
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
  color: white;
  font-size: 15px;
  font-weight: 600;
}

.avg-score {
  display: flex;
  align-items: center;
  gap: 8px;
}

.score-label {
  font-size: 12px;
  color: rgba(255,255,255,0.8);
}

.score-value {
  font-size: 18px;
  font-weight: bold;
  padding: 2px 10px;
  border-radius: 12px;
  background: rgba(255,255,255,0.2);
}

.score-value.excellent { color: var(--color-success); background: var(--color-success-bg); }
.score-value.good { color: var(--color-primary); background: var(--color-primary-bg); }
.score-value.normal { color: var(--color-warning); background: var(--color-warning-bg); }
.score-value.poor { color: var(--color-danger); background: var(--color-danger-bg); }

.card-body {
  padding: 12px;
  flex: 1;
  overflow-y: auto;
}

.evaluation-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
  padding-left: 8px;
  border-left: 3px solid var(--color-primary);
}

.eval-section .eval-grid {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 16px;
}

.radar-chart {
  width: 200px;
  height: 180px;
}

.eval-details {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.eval-item {
  padding: 8px;
  background: var(--bg-subtle);
  border-radius: 8px;
}

.eval-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.eval-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.eval-score {
  font-size: 14px;
  font-weight: bold;
}

.eval-score.excellent { color: var(--color-success); }
.eval-score.good { color: var(--color-primary); }
.eval-score.normal { color: var(--color-warning); }
.eval-score.poor { color: var(--color-danger); }

.eval-bar {
  height: 6px;
  background: var(--border-default);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 4px;
}

.eval-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.eval-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.4;
}

.redemption-section .redemption-chart {
  width: 100%;
  height: 200px;
}

.redemption-table {
  margin-top: 12px;
  overflow-x: auto;
}

.redemption-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.redemption-table th,
.redemption-table td {
  padding: 8px 10px;
  text-align: center;
  border-bottom: 1px solid var(--border-default);
}

.redemption-table th {
  background: var(--bg-subtle);
  font-weight: 600;
  color: var(--text-primary);
}

.redemption-table .buy { color: var(--color-success); }
.redemption-table .sell { color: var(--color-danger); }
.redemption-table .positive { color: var(--color-success); font-weight: 600; }
.redemption-table .negative { color: var(--color-danger); font-weight: 600; }

.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-tertiary);
}

@media (max-width: 600px) {
  .eval-section .eval-grid {
    grid-template-columns: 1fr;
  }

  .radar-chart {
    width: 100%;
    height: 200px;
  }
}
</style>
