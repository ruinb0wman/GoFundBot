<template>
  <div class="ability-card">
    <div class="card-header">
      <h3><LucideIcon name="BarChart3" :size="20" /> 本基金历史表现</h3>
      <div class="avg-score" v-if="avgScore">
        <span class="score-label">综合</span>
        <span class="score-value" :class="getScoreClass(avgScore)">{{ avgScore }}</span>
      </div>
    </div>
    <div class="card-body">
      <div v-if="hasEvalData" class="eval-content">
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
          </div>
        </div>
      </div>
      <div v-else class="no-data">
        <p>暂无评价数据</p>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from '../composables/useEChartsTheme'

export default {
  name: 'FundAbilityEval',
  props: {
    performanceEvaluation: {
      type: Object,
      default: () => ({})
    }
  },
  setup(props) {
    const radarChartEl = ref(null)
    let radarChart = null

    const { echartThemeName } = useEChartsTheme()

    const cssColor = (name, fallback = '') => {
      const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      return val || fallback
    }
    const hexToRgba = (hex, alpha) => {
      const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16)
      return `rgba(${r},${g},${b},${alpha})`
    }

    const hasEvalData = computed(() => {
      const data = props.performanceEvaluation?.data
      return data && Array.isArray(data) && data.some(v => v !== null)
    })

    const avgScore = computed(() => props.performanceEvaluation?.avr || null)

    const evalItems = computed(() => {
      const categories = props.performanceEvaluation?.categories || []
      const data = props.performanceEvaluation?.data || []
      
      return categories.map((name, index) => ({
        name,
        score: data[index] ?? 0
      }))
    })

    const getScoreClass = (score) => {
      if (score >= 80) return 'excellent'
      if (score >= 60) return 'good'
      if (score >= 40) return 'normal'
      return 'poor'
    }

    const getBarColor = (score) => {
      if (score >= 80) return cssColor('--color-success', '#52c41a')
      if (score >= 60) return cssColor('--color-primary', '#1890ff')
      if (score >= 40) return cssColor('--color-warning', '#faad14')
      return cssColor('--color-danger', '#ff4d4f')
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
            indicator: categories.map(name => ({
              name,
              max: 100
            })),
            radius: '70%',
            axisName: {
              color: cssColor('--chart-axis-label', '#666'),
              fontSize: 10
            },
            splitArea: {
              areaStyle: {
                color: [hexToRgba(cssColor('--color-primary', '#1677ff'), 0.05), hexToRgba(cssColor('--color-primary', '#1677ff'), 0.1)]
              }
            },
            axisLine: {
              lineStyle: {
                color: hexToRgba(cssColor('--color-primary', '#1677ff'), 0.3)
              }
            },
            splitLine: {
              lineStyle: {
                color: hexToRgba(cssColor('--color-primary', '#1677ff'), 0.3)
              }
            }
          },
          series: [{
            type: 'radar',
            data: [{
              value: data,
              name: '能力评分',
              areaStyle: {
                color: hexToRgba(cssColor('--color-primary', '#1677ff'), 0.3)
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

    onMounted(() => {
      nextTick(() => {
        initRadarChart()
      })
    })

    watch(() => props.performanceEvaluation, () => {
      nextTick(() => {
        initRadarChart()
      })
    }, { deep: true })

    watch(echartThemeName, () => {
      if (radarChart) {
        radarChart.dispose()
        radarChart = null
        nextTick(() => initRadarChart())
      }
    })

    return {
      radarChartEl,
      hasEvalData,
      avgScore,
      evalItems,
      getScoreClass,
      getBarColor
    }
  }
}
</script>

<style scoped>
.ability-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.card-header {
  background: var(--bg-gradient);
  padding: 10px 14px;
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
  color: white;
  font-size: 14px;
  font-weight: 600;
}

.avg-score {
  display: flex;
  align-items: center;
  gap: 6px;
}

.score-label {
  font-size: 11px;
  color: rgba(255,255,255,0.8);
}

.score-value {
  font-size: 16px;
  font-weight: bold;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(255,255,255,0.2);
}

.score-value.excellent { color: var(--color-success); }
.score-value.good { color: var(--color-primary); }
.score-value.normal { color: var(--color-warning); }
.score-value.poor { color: var(--color-danger); }

.card-body {
  padding: 10px;
  flex: 1;
  overflow-y: auto;
}

.eval-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.radar-chart {
  width: 100%;
  height: 180px;
  flex-shrink: 0;
}

.eval-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.eval-item {
  padding: 6px 8px;
  background: var(--bg-subtle);
  border-radius: 6px;
}

.eval-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.eval-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
}

.eval-score {
  font-size: 12px;
  font-weight: bold;
}

.eval-score.excellent { color: var(--color-success); }
.eval-score.good { color: var(--color-primary); }
.eval-score.normal { color: var(--color-warning); }
.eval-score.poor { color: var(--color-danger); }

.eval-bar {
  height: 4px;
  background: var(--border-subtle);
  border-radius: 2px;
  overflow: hidden;
}

.eval-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
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
