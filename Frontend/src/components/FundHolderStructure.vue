<template>
  <div class="holder-structure-card">
    <div class="card-header">
      <h3><LucideIcon name="Users" :size="20" /> 持有人结构</h3>
    </div>
    <div class="card-body">
      <div v-if="hasData" class="holder-content">
        <div class="chart-container">
          <div ref="chartEl" class="holder-chart"></div>
        </div>
        <div class="holder-table">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th v-for="serie in series" :key="serie.name">
                  <span class="legend-dot" :style="{ background: getColor(serie.name) }"></span>
                  {{ formatLegendName(serie.name) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(date, dateIndex) in categories" :key="dateIndex">
                <td class="date-cell">{{ date }}</td>
                <td v-for="serie in series" :key="serie.name" class="value-cell">
                  {{ formatValue(serie.data[dateIndex]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-else class="no-data">
        <p>暂无持有人结构数据</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from '../composables/useEChartsTheme'

const props = withDefaults(defineProps<{
  holderStructure?: Record<string, any>
}>(), {
  holderStructure: () => ({}),
})

const cssColor = (name: string, fallback = ''): string => {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}
const { echartThemeName } = useEChartsTheme()
const chartEl = ref<HTMLElement | null>(null)
let chartInstance: echarts.ECharts | null = null

const categories = computed(() => (props.holderStructure?.categories || []) as string[])
const series = computed(() => (props.holderStructure?.series || []) as Array<{ name: string; data: number[] }>)
const hasData = computed(() => categories.value.length > 0 && series.value.length > 0)

function getColor(name: string): string {
  const colors: Record<string, string> = {
    '机构持有比例': cssColor('--chart-1', '#1677ff'),
    '个人持有比例': cssColor('--chart-4', '#ee6666'),
    '内部持有比例': cssColor('--chart-2', '#52c41a'),
    '机构持有': cssColor('--chart-1', '#1677ff'),
    '个人持有': cssColor('--chart-4', '#ee6666'),
    '内部持有': cssColor('--chart-2', '#52c41a'),
  }
  return colors[name] || cssColor('--chart-1', '#1677ff')
}

function formatLegendName(name: string): string {
  if (!name) return ''
  return name.replace(/比例/g, '')
}

function formatValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  return value.toFixed(2) + '%'
}

function initChart(): void {
  if (!chartEl.value || !hasData.value) return
  if (chartInstance) chartInstance.dispose()
  chartInstance = echarts.init(chartEl.value, echartThemeName.value)

      // 准备堆叠柱状图数据
      const seriesData = series.value.map(serie => ({
        name: formatLegendName(serie.name),
        type: 'bar',
        stack: 'total',
        barWidth: '50%',
        data: serie.data,
        itemStyle: {
          color: getColor(serie.name)
        },
        label: {
          show: true,
          position: 'inside',
          formatter: (params: any) => params.value > 10 ? params.value.toFixed(1) + '%' : ''
        }
      }))

      const option = {
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'shadow'
          },
          formatter: (params: any[]) => {
            let result = `<div style="font-weight: bold; margin-bottom: 8px;">${params[0].axisValue}</div>`
            params.forEach((param: any) => {
              result += `<div style="margin: 4px 0;">
                <span style="display:inline-block;margin-right:5px;border-radius:50%;width:10px;height:10px;background-color:${param.color};"></span>
                ${param.seriesName}: <strong>${param.value?.toFixed(2) || '--'}%</strong>
              </div>`
            })
            return result
          }
        },
        legend: {
          data: series.value.map(s => formatLegendName(s.name)),
          bottom: 0
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '15%',
          top: '15%',
          containLabel: true
        },
        xAxis: {
          type: 'category',
          data: categories.value,
          axisLabel: {
            rotate: 30
          }
        },
        yAxis: {
          type: 'value',
          name: '占比(%)',
          max: 100,
          axisLabel: {
            formatter: '{value}%'
          }
        },
        series: seriesData
      }

      chartInstance.setOption(option)
    }

    onMounted(() => {
      nextTick(() => {
        initChart()
      })
    })

    watch(() => props.holderStructure, () => {
      nextTick(() => {
        initChart()
      })
    }, { deep: true })

    watch(echartThemeName, () => {
      nextTick(() => {
        initChart()
      })
    })
</script>

<style scoped>
.holder-structure-card {
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
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.holder-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.chart-container {
  flex-shrink: 0;
}

.holder-chart {
  width: 100%;
  height: 240px;
}

.holder-table {
  flex: 1;
  overflow: auto;
  font-size: 12px;
}

.holder-table table {
  width: 100%;
  border-collapse: collapse;
}

.holder-table th,
.holder-table td {
  padding: 6px 8px;
  text-align: center;
  border-bottom: 1px solid var(--border-default);
}

.holder-table th {
  background: var(--bg-subtle);
  font-weight: 600;
  color: var(--text-secondary);
  position: sticky;
  top: 0;
}

.holder-table th .legend-dot {
  display: inline-block;
  width: 8px;
  height: 10px;
  border-radius: 50%;
  margin-right: 6px;
}

.date-cell {
  font-weight: 500;
  color: var(--text-primary);
}

.value-cell {
  color: var(--text-secondary);
}

.no-data {
  text-align: center;
  padding: 40px;
  color: var(--text-tertiary);
}

@media (max-width: 768px) {
  .holder-chart {
    height: 250px;
  }

  .holder-table th,
  .holder-table td {
    padding: 8px 12px;
    font-size: 13px;
  }
}
</style>
