<template>
  <div class="fund-manager-card">
    <div class="card-header">
      <h3>👨‍💼 基金经理能力评估</h3>
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
                {{ manager.name || '未知' }}
                <span v-if="manager.star_rating" class="star-rating">
                  <span v-for="i in 5" :key="i" class="star" :class="{ filled: i <= manager.star_rating }">★</span>
                </span>
              </div>
              <div class="manager-meta">
                <span class="meta-item" v-if="manager.work_experience">
                  <i class="icon">📅</i> 从业 {{ manager.work_experience }}
                </span>
                <span class="meta-item" v-if="manager.managed_fund_size">
                  <i class="icon">💰</i> 管理规模 {{ manager.managed_fund_size }}
                </span>
              </div>
            </div>
          </div>

          <!-- 能力评估雷达图 -->
          <div class="manager-ability" v-if="hasAbilityData(manager)">
            <div class="section-title">能力评估</div>
            <div class="ability-chart-container">
              <div :ref="el => setChartRef(el, index)" class="ability-chart"></div>
            </div>
            <div class="ability-score" v-if="manager.ability_assessment?.average_score">
              综合评分: <strong>{{ manager.ability_assessment.average_score }}</strong>
            </div>
          </div>

          <!-- 任职业绩 -->
          <div class="manager-performance" v-if="hasPerformanceData(manager)">
            <div class="section-title">任职业绩</div>
            <div class="performance-table">
              <table>
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>收益</th>
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
        <p>暂无基金经理信息</p>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from '../composables/useEChartsTheme'

export default {
  name: 'FundManagerInfo',
  props: {
    fundManagers: {
      type: Array,
      default: () => []
    }
  },
  setup(props) {
    const cssColor = (name, fallback = '') => {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
    }
    const { echartThemeName } = useEChartsTheme()
    const chartRefs = ref({})
    const chartInstances = {}

    const managers = computed(() => props.fundManagers || [])
    const hasManagers = computed(() => managers.value.length > 0)

    const setChartRef = (el, index) => {
      if (el) {
        chartRefs.value[index] = el
      }
    }

    const hasAbilityData = (manager) => {
      const ability = manager.ability_assessment
      return ability && ability.categories?.length > 0 && ability.scores?.length > 0
    }

    const hasPerformanceData = (manager) => {
      const perf = manager.performance
      // 检查 series 和 categories 是否存在
      if (!perf || !perf.categories?.length) return false
      // series 可能是数组，且里面的 data 也是数组
      if (perf.series?.length > 0 && perf.series[0]?.data?.length > 0) return true
      return false
    }

    // 获取业绩数据项
    const getPerformanceItems = (manager) => {
      const perf = manager.performance
      if (!perf || !perf.categories?.length) return []
      
      const categories = perf.categories
      const series = perf.series
      
      // series[0].data 是一个对象数组 [{y: value, name: null, color: xxx}]
      if (series?.length > 0 && series[0]?.data?.length > 0) {
        const dataArr = series[0].data
        return categories.map((cat, idx) => {
          const item = dataArr[idx]
          // item 可能是对象 {y: value} 或直接是数值
          const value = typeof item === 'object' ? (item?.y ?? item?.value ?? null) : item
          return {
            name: cat,
            value: value
          }
        })
      }
      
      return []
    }

    const handleImageError = (e) => {
      e.target.style.display = 'none'
    }

    const getValueClass = (val) => {
      if (val === null || val === undefined || val === '--') return ''
      const num = parseFloat(val)
      return num > 0 ? 'positive' : num < 0 ? 'negative' : ''
    }

    const formatPercent = (val) => {
      if (val === null || val === undefined || val === '--') return '--'
      const num = parseFloat(val)
      if (isNaN(num)) return '--'
      return (num > 0 ? '+' : '') + num.toFixed(2) + '%'
    }

    const initRadarChart = (index) => {
      const el = chartRefs.value[index]
      const manager = managers.value[index]
      
      if (!el || !hasAbilityData(manager)) return

      if (chartInstances[index]) {
        chartInstances[index].dispose()
      }

      chartInstances[index] = echarts.init(el, echartThemeName.value)

      const ability = manager.ability_assessment
      const indicators = ability.categories.map((cat, i) => ({
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
      managers.value.forEach((_, index) => {
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

    watch(() => props.fundManagers, () => {
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

    return {
      managers,
      hasManagers,
      setChartRef,
      hasAbilityData,
      hasPerformanceData,
      getPerformanceItems,
      getValueClass,
      formatPercent
    }
  }
}
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
