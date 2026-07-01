<template>
  <div class="fund-manager-card">
    <div class="card-header">
      <h3><LucideIcon name="UserCircle" :size="20" /> {{ t('fund.managerInfo.title') }}</h3>
    </div>
    <div class="card-body">
      <div v-if="hasManagers" class="managers-container">
        <div
          v-for="(manager, index) in managers"
          :key="manager.id || index"
          class="manager-item"
        >
          <!-- 经理基本信息 -->
          <div class="manager-header">
            <div class="manager-basic">
              <div class="manager-name">
                {{ manager.name || t('common.unknown') }}
                <span v-if="manager.star_rating" class="star-rating">
                  <span v-for="i in 5" :key="i" class="star" :class="{ filled: i <= manager.star_rating }"><LucideIcon name="Star" :size="14" :fill="i <= manager.star_rating ? 'currentColor' : 'none'" /></span>
                </span>
              </div>
              <div class="manager-meta">
                <span class="meta-item" v-if="manager.work_experience">
                  <i class="icon"><LucideIcon name="Calendar" :size="14" /></i> {{ t('fund.managerInfo.experience') }} {{ manager.work_experience }}
                </span>
                <span class="meta-item" v-if="manager.managed_fund_size">
                  <i class="icon"><LucideIcon name="Coins" :size="14" /></i> {{ t('fund.managerInfo.managedScale') }} {{ manager.managed_fund_size }}
                </span>
              </div>
            </div>
          </div>

          <!-- 能力评估雷达图 -->
          <div class="manager-ability" v-if="hasAbilityData(manager)">
            <div class="section-title">{{ t('fund.managerInfo.capabilityEval') }}</div>
            <div class="ability-chart-container">
              <div :ref="el => setChartRef(el, index)" class="ability-chart"></div>
            </div>
            <div class="ability-score" v-if="manager.ability_assessment?.average_score">
              {{ t('fund.managerInfo.compositeScore') }}: <strong>{{ manager.ability_assessment.average_score }}</strong>
            </div>
          </div>

          <!-- 任职业绩 -->
          <div class="manager-performance" v-if="hasPerformanceData(manager)">
            <div class="section-title">{{ t('fund.managerInfo.tenurePerf') }}</div>
            <div class="performance-table">
              <table>
                <thead>
                  <tr>
                    <th>{{ t('fund.managerInfo.type') }}</th>
                    <th>{{ t('fund.managerInfo.return') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, idx) in getPerformanceItems(manager)" :key="idx">
                    <td class="serie-name">{{ item.name }}</td>
                    <td :class="getValueClass(item.value)">
                      {{ formatPercent(item.value) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="no-data">
        <p>{{ t('fund.managerInfo.empty') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import { useEChartsTheme } from '../composables/useEChartsTheme'

const { t } = useI18n()

const props = withDefaults(defineProps<{ managers?: any[] }>(), { managers: () => [] })

const cssColor = (name: string, fallback = '') => {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}
const { echartThemeName } = useEChartsTheme()
const chartRefs = ref<Record<number, HTMLElement>>({})
const chartInstances: Record<number, echarts.ECharts> = {}

const managers = computed(() => (props.managers as any[]) || [])
const hasManagers = computed(() => managers.value.length > 0)

const setChartRef = (el: any, index: any) => {
  if (el) {
    chartRefs.value[index] = el
  }
}

const hasAbilityData = (manager: any) => {
  const ability = manager.ability_assessment
  return ability && ability.categories?.length > 0 && ability.scores?.length > 0
}

const hasPerformanceData = (manager: any) => {
  const perf = manager.performance
  if (!perf || !perf.categories?.length) return false
  if (perf.series?.length > 0 && perf.series[0]?.data?.length > 0) return true
  return false
}

const getPerformanceItems = (manager: any) => {
  const perf = manager.performance
  if (!perf || !perf.categories?.length) return []

  const categories = perf.categories
  const series = perf.series

  if (series?.length > 0 && series[0]?.data?.length > 0) {
    const dataArr = series[0].data
    return categories.map((cat: string, idx: number) => {
      const item = dataArr[idx]
      const value = typeof item === 'object' ? (item?.y ?? item?.value ?? null) : item
      return {
        name: cat,
        value: value
      }
    })
  }

  return []
}

const handleImageError = (e: Event) => {
  (e.target as HTMLElement).style.display = 'none'
}

const getValueClass = (val: any) => {
  if (val === null || val === undefined || val === '--') return ''
  const num = parseFloat(val)
  return num > 0 ? 'positive' : num < 0 ? 'negative' : ''
}

const formatPercent = (val: any) => {
  if (val === null || val === undefined || val === '--') return '--'
  const num = parseFloat(val)
  if (isNaN(num)) return '--'
  return (num > 0 ? '+' : '') + num.toFixed(2) + '%'
}

const initRadarChart = (index: number) => {
  const el = chartRefs.value[index]
  const manager = managers.value[index]

  if (!el || !hasAbilityData(manager)) return

  if (chartInstances[index]) {
    chartInstances[index].dispose()
  }

  chartInstances[index] = echarts.init(el, echartThemeName.value)

  const ability = manager.ability_assessment
  const indicators = ability.categories.map((cat: string, i: number) => ({
    name: cat,
    max: 100
  }))

  const option = {
    tooltip: {
      trigger: 'item'
    },
    radar: {
      indicator: indicators,
      shape: 'polygon',
      splitNumber: 4,
      radius: '60%',
      center: ['50%', '50%'],
      axisName: {
        color: cssColor('--chart-axis-label', '#666'),
        fontSize: 11,
        padding: [3, 5]
      },
      splitLine: {
        lineStyle: {
          color: [cssColor('--chart-grid', '#e5e5e5')]
        }
      },
      splitArea: {
        areaStyle: {
          color: [cssColor('--color-primary-bg', '#eef4ff'), cssColor('--color-primary-bg', '#eef4ff')]
        }
      }
    },
    series: [{
      type: 'radar',
      data: [{
        value: ability.scores,
        name: '能力评估',
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

  chartInstances[index].setOption(option)
}

const initAllCharts = () => {
  managers.value.forEach((_: any, index: number) => {
    nextTick(() => {
      initRadarChart(index)
    })
  })
}

onMounted(() => {
  nextTick(() => {
    initAllCharts()
  })
})

watch(() => props.managers, () => {
  nextTick(() => {
    initAllCharts()
  })
}, { deep: true })

watch(echartThemeName, () => {
  Object.values(chartInstances).forEach(c => c.dispose())
  nextTick(() => {
    initAllCharts()
  })
})
</script>

<style scoped>
.fund-manager-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.card-header {
  background: var(--bg-gradient);
  padding: 12px 16px;
  flex-shrink: 0;
}

.card-header h3 {
  margin: 0;
  color: white;
  font-size: 15px;
  font-weight: 600;
}

.card-body {
  padding: 12px;
  flex: 1;
  overflow-y: auto;
}

.managers-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.manager-item {
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 12px;
  background: var(--bg-subtle);
}

.manager-header {
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-default);
}

.manager-basic {
  flex: 1;
  min-width: 0;
}

.manager-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.star-rating {
  font-size: 10px;
}

.star {
  color: var(--border-default);
}

.star.filled {
  color: var(--color-warning);
}

.manager-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.meta-item {
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 2px;
}

.icon {
  font-style: normal;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
  padding-left: 6px;
  border-left: 2px solid var(--color-primary);
}

.manager-ability {
  margin-bottom: 12px;
}

.ability-chart-container {
  display: flex;
  justify-content: center;
}

.ability-chart {
  width: 280px;
  height: 220px;
}

.ability-score {
  text-align: center;
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.ability-score strong {
  color: var(--color-primary);
  font-size: 14px;
}

.manager-performance {
  margin-top: 8px;
}

.performance-table {
  overflow-x: auto;
  font-size: 11px;
}

.performance-table table {
  width: 100%;
  border-collapse: collapse;
}

.performance-table th,
.performance-table td {
  padding: 5px 6px;
  text-align: center;
  border-bottom: 1px solid var(--border-default);
}

.performance-table th {
  background: var(--bg-subtle);
  font-weight: 600;
  color: var(--text-secondary);
}

.performance-table .serie-name {
  text-align: left;
  font-weight: 500;
}

.positive {
  color: var(--color-danger);
}

.negative {
  color: var(--color-success);
}

.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  font-size: 13px;
}
</style>
