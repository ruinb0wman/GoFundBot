<template>
  <div class="fund-scale-card">
    <div class="card-header">
      <h3>📈 基金规模变动</h3>
    </div>
    <div class="card-body">
      <div v-if="hasData" class="scale-content">
        <div ref="chartEl" class="scale-chart"></div>
        <div class="scale-table">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>规模(亿元)</th>
                <th>环比变化</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in tableData" :key="index">
                <td>{{ categories[index] }}</td>
                <td class="scale-value">{{ item.y }}</td>
                <td class="mom-value" :class="getMomClass(item.mom)">
                  {{ item.mom }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-else class="no-data">
        <p>暂无规模变动数据</p>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from '../composables/useEChartsTheme'

export default {
  name: 'FundScaleChange',
  props: {
    fluctuationScale: {
      type: Object,
      default: () => ({})
    }
  },
  setup(props) {
    const chartEl = ref(null)
    let chartInstance = null

    const { echartThemeName } = useEChartsTheme()

    const cssColor = (name, fallback = '') => {
      const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      return val || fallback
    }
    const hexToRgba = (hex, alpha) => {
      const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16)
      return `rgba(${r},${g},${b},${alpha})`
    }

    const categories = computed(() => props.fluctuationScale?.categories || [])
    const tableData = computed(() => props.fluctuationScale?.series || [])
    const hasData = computed(() => categories.value.length > 0 && tableData.value.length > 0)

    const getMomClass = (mom) => {
      if (!mom || mom === '--') return ''
      const value = parseFloat(mom)
      return value > 0 ? 'positive' : value < 0 ? 'negative' : ''
    }

    const initChart = () => {
      if (!chartEl.value || !hasData.value) return

      if (chartInstance) {
        chartInstance.dispose()
      }

      chartInstance = echarts.init(chartEl.value, echartThemeName.value)

      const scaleData = tableData.value.map(item => item.y)

      const option = {
        tooltip: {
          trigger: 'axis',
          formatter: (params) => {
            const index = params[0].dataIndex
            const mom = tableData.value[index]?.mom || '--'
            return `
              <div style="font-weight: bold; margin-bottom: 8px;">${params[0].axisValue}</div>
              <div>规模: <strong>${params[0].value}亿元</strong></div>
              <div>环比: <strong>${mom}</strong></div>
            `
          }
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '15%',
          top: '18%',
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
          name: '规模(亿元)',
          axisLabel: {
            formatter: '{value}'
          }
        },
        series: [{
          name: '基金规模',
          type: 'bar',
          data: scaleData,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: cssColor('--color-primary', '#1677ff') },
              { offset: 1, color: cssColor('--color-primary-hover', '#0958d9') }
            ])
          },
          label: {
            show: true,
            position: 'top',
            formatter: '{c}亿'
          }
        }]
      }

      chartInstance.setOption(option)
    }

    onMounted(() => {
      nextTick(() => {
        initChart()
      })
    })

    watch(() => props.fluctuationScale, () => {
      nextTick(() => {
        initChart()
      })
    }, { deep: true })

    watch(echartThemeName, () => {
      if (chartInstance) {
        chartInstance.dispose()
        chartInstance = null
        nextTick(() => initChart())
      }
    })

    return {
      chartEl,
      categories,
      tableData,
      hasData,
      getMomClass
    }
  }
}
</script>

<style scoped>
.fund-scale-card {
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
}

.card-header h3 {
  margin: 0;
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

.scale-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.scale-chart {
  width: 100%;
  height: 240px;
  flex-shrink: 0;
}

.scale-table {
  flex: 1;
  overflow: auto;
  font-size: 12px;
}

.scale-table table {
  width: 100%;
  border-collapse: collapse;
}

.scale-table th,
.scale-table td {
  padding: 6px 8px;
  text-align: center;
  border-bottom: 1px solid var(--border-default);
}

.scale-table th {
  background: var(--bg-subtle);
  font-weight: 600;
  color: var(--text-primary);
  position: sticky;
  top: 0;
}

.scale-value {
  font-weight: 600;
  color: var(--text-primary);
}

.mom-value {
  font-weight: 500;
}

.mom-value.positive {
  color: var(--color-danger);
}

.mom-value.negative {
  color: var(--color-success);
}

.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
}
</style>
