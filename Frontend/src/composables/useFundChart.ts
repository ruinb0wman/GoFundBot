// @ts-nocheck
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from './useEChartsTheme'

export function useFundChart(props) {
  const chartEl = ref(null)
  const activeTab = ref('performance')
  const selectedRange = ref('1y')
  let chartInstance = null

  const { echartThemeName } = useEChartsTheme()

  const cssColor = (name, fallback = '') => {
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return val || fallback
  }
  const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }

  const timeRanges = [
    { label: '近3月', value: '3m' },
    { label: '近6月', value: '6m' },
    { label: '近1年', value: '1y' },
    { label: '近3年', value: '3y' },
    { label: '全部', value: 'all' }
  ]

  const setTimeRange = (range) => {
    selectedRange.value = range
    updateChart()
  }

  const switchTab = (tab) => {
    activeTab.value = tab
    nextTick(() => {
      if (chartInstance) {
        chartInstance.dispose()
        chartInstance = null
      }
      initChart()
    })
  }

  const getColor = (val) => {
    if (!val) return ''
    return val >= 0 ? 'text-red' : 'text-green'
  }

  const fundChange = ref('0.00')
  const maxDrawdownInfo = ref({ val: '0.00', days: 0 })
  const comparisonInfo = ref([])

  const filterByDate = (data, range) => {
    if (!data || data.length === 0) return []
    const now = new Date()
    let startDate = new Date(0)

    const nowTs = now.getTime()
    if (range === '3m') {
      const d = new Date(nowTs)
      d.setMonth(d.getMonth() - 3)
      startDate = d
    } else if (range === '6m') {
      const d = new Date(nowTs)
      d.setMonth(d.getMonth() - 6)
      startDate = d
    } else if (range === '1y') {
      const d = new Date(nowTs)
      d.setFullYear(d.getFullYear() - 1)
      startDate = d
    } else if (range === '3y') {
      const d = new Date(nowTs)
      d.setFullYear(d.getFullYear() - 3)
      startDate = d
    }

    const startTs = startDate.getTime()

    if (data.length > 0 && data[0] && data[0].date !== undefined && typeof data[0].date === 'string') {
      return data
        .map(item => {
          const ts = new Date(item.date).getTime()
          if (isNaN(ts)) return null
          return [ts, item.value]
        })
        .filter(item => item !== null && item[0] >= startTs)
    }
    return data.filter(item => {
      if (!item || item.length < 2) return false
      const ts = item[0]
      if (typeof ts !== 'number' || isNaN(ts)) return false
      return ts >= startTs
    })
  }

  const processData = () => {
    const rawData = (props.netWorthTrend || [])
      .filter(item => item && typeof item.x === 'number' && !isNaN(item.x) && typeof item.y === 'number' && !isNaN(item.y))
      .map(item => [item.x, item.y])
    const filtered = filterByDate(rawData, selectedRange.value).slice().sort((a, b) => a[0] - b[0])

    if (filtered.length === 0) return { chartData: [], drawdownInfo: null, useRawValues: false }

    const startVal = filtered[0][1]
    const endVal = filtered[filtered.length - 1][1]
    fundChange.value = startVal !== 0 ? ((endVal - startVal) / startVal * 100).toFixed(2) : '0.00'

    const toPercent = (val) => startVal !== 0 ? parseFloat(((val - startVal) / startVal * 100).toFixed(4)) : 0
    const percentTrend = filtered.map(item => [item[0], toPercent(item[1])])

    const pctValues = percentTrend.map(p => p[1])
    const pctRange = Math.max(...pctValues) - Math.min(...pctValues)
    const useRawValues = pctRange < 0.0001

    const chartData = useRawValues
      ? filtered.map(item => [item[0], item[1]])
      : percentTrend

    let curMaxdd = 0
    let globalPeakIndex = 0
    let globalValleyIndex = 0

    let runningPeakValue = -Infinity
    let runningPeakIndex = 0

    for (let i = 0; i < filtered.length; i++) {
      const val = filtered[i][1]
      if (val > runningPeakValue) {
        runningPeakValue = val
        runningPeakIndex = i
      }

      const dd = (runningPeakValue - val) / runningPeakValue
      if (dd > curMaxdd) {
        curMaxdd = dd
        globalPeakIndex = runningPeakIndex
        globalValleyIndex = i
      }
    }

    let recoveryIndex = -1
    const peakValRaw = filtered[globalPeakIndex][1]

    for (let i = globalPeakIndex + 1; i < filtered.length; i++) {
      if (filtered[i][1] >= peakValRaw) {
        recoveryIndex = i
        break
      }
    }

    const peakDate = filtered[globalPeakIndex][0]
    const valleyDate = filtered[globalValleyIndex][0]
    const recoveryDate = recoveryIndex !== -1 ? filtered[recoveryIndex][0] : null

    const days = recoveryDate ? Math.ceil((recoveryDate - peakDate) / (1000 * 3600 * 24)) : null

    const ddInfo = {
      val: (curMaxdd * 100).toFixed(2),
      peakDate,
      valleyDate,
      recoveryDate,
      days,
      peakValue: toPercent(peakValRaw),
      valleyValue: toPercent(filtered[globalValleyIndex][1]),
      recoveryValue: recoveryIndex !== -1 ? toPercent(filtered[recoveryIndex][1]) : null
    }

    maxDrawdownInfo.value = ddInfo

    return {
      chartData,
      drawdownInfo: ddInfo,
      useRawValues
    }
  }

  const initChart = () => {
    if (!chartEl.value) return
    if (!chartInstance) {
      chartInstance = echarts.init(chartEl.value, echartThemeName.value)
    }
    updateChart()
  }

  const updateChart = () => {
    if (!chartInstance) return

    chartInstance.clear()

    const option = {
      grid: { left: '3%', right: '5%', bottom: '10%', top: '15%', containLabel: true },
      tooltip: {
        trigger: 'axis',
        formatter: function (params) {
          let res = '<div>' + echarts.format.formatTime('yyyy-MM-dd', params[0].value[0]) + '</div>'
          params.forEach(item => {
            let val = item.value[1]
            res += `<div>${item.marker} ${item.seriesName}: ${val}${activeTab.value === 'comparison' ? '%' : ''}</div>`
          })
          return res
        }
      },
      xAxis: { type: 'time', boundaryGap: false, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: {
        type: 'value',
        scale: true,
        min: function (value) {
          return value.min - Math.max((value.max - value.min) * 0.15, 0.05)
        },
        max: function (value) {
          return value.max + Math.max((value.max - value.min) * 0.15, 0.05)
        },
        splitLine: { lineStyle: { type: 'dashed' } },
        axisLabel: { formatter: '{value}%' }
      },
      series: []
    }

    if (activeTab.value === 'performance') {
      const { chartData, useRawValues } = processData()
      const unit = useRawValues ? '' : '%'
      option.series.push({
        name: '本基金',
        type: 'line',
        data: chartData,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color: cssColor('--color-primary', '#1677ff') },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: hexToRgba(cssColor('--color-primary', '#1677ff'), 0.2) },
            { offset: 1, color: hexToRgba(cssColor('--color-primary', '#1677ff'), 0) }
          ])
        }
      })

      option.yAxis.axisLabel.formatter = useRawValues ? '{value}' : '{value}%'

      option.tooltip.formatter = function (params) {
        let res = '<div>' + echarts.format.formatTime('yyyy-MM-dd', params[0].value[0]) + '</div>'
        params.forEach(item => {
          res += `<div>${item.marker} ${item.seriesName}: ${item.value[1]}${unit}</div>`
        })
        return res
      }
    } else if (activeTab.value === 'comparison') {
      const comparisonData = props.grandTotal || []

      if (comparisonData.length > 0) {
        const colors = [
          cssColor('--chart-1', '#1677ff'),
          cssColor('--chart-2', '#52c41a'),
          cssColor('--chart-3', '#faad14'),
          cssColor('--chart-4', '#ff4d4f'),
          cssColor('--chart-5', '#73c0de')
        ]

        comparisonInfo.value = comparisonData.map((item, index) => ({
          name: item.name,
          color: colors[index % colors.length]
        }))

        const series = comparisonData.map((item, index) => {
          const rawData = item.data || []
          const filteredData = filterByDate(rawData, selectedRange.value)

          return {
            name: item.name,
            type: 'line',
            data: filteredData,
            smooth: true,
            symbol: 'none',
            lineStyle: {
              width: item.name.includes('本基金') ? 3 : 1.5
            },
            itemStyle: {
              color: colors[index % colors.length]
            },
            z: item.name.includes('本基金') ? 3 : 2
          }
        })

        option.series = series
        option.legend = { show: false }

        option.tooltip.formatter = function (params) {
          let res = '<div>' + echarts.format.formatTime('yyyy-MM-dd', params[0].value[0]) + '</div>'
          params.forEach(item => {
            res += `<div>
              <span style="display:inline-block;margin-right:5px;border-radius:50%;width:10px;height:10px;background-color:${item.color};"></span>
              ${item.seriesName}: ${item.value[1]}%
            </div>`
          })
          return res
        }
      }
    } else if (activeTab.value === 'drawdown') {
      const { chartData, drawdownInfo } = processData()

      if (chartData.length > 0) {
        const seriesData = {
          name: '本基金',
          type: 'line',
          data: chartData,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: cssColor('--color-primary', '#1677ff') },
          markArea: {
            itemStyle: { color: hexToRgba(cssColor('--color-danger-bg', '#fff1f0'), 0.6) },
            data: []
          },
          markPoint: {
            symbol: 'circle',
            symbolSize: 8,
            label: {
              show: true,
              color: cssColor('--text-inverse', '#fff'),
              padding: [4, 8],
              borderRadius: 4
            },
            data: []
          }
        }

        if (drawdownInfo && drawdownInfo.peakDate) {
          const endDate = drawdownInfo.recoveryDate || chartData[chartData.length - 1][0]

          seriesData.markArea.data.push([
            { xAxis: drawdownInfo.peakDate },
            { xAxis: endDate }
          ])

          const points = []
          points.push({
            coord: [drawdownInfo.peakDate, drawdownInfo.peakValue],
            itemStyle: { color: cssColor('--color-warning', '#faad14') },
            label: { show: false }
          })

          points.push({
            coord: [drawdownInfo.valleyDate, drawdownInfo.valleyValue],
            itemStyle: { color: cssColor('--color-success', '#52c41a') },
            label: {
              offset: [0, 15],
              formatter: `最大回撤${drawdownInfo.val}%`,
              backgroundColor: hexToRgba(cssColor('--color-success', '#52c41a'), 0.7),
              position: 'top'
            }
          })

          if (drawdownInfo.recoveryDate) {
            points.push({
              coord: [drawdownInfo.recoveryDate, drawdownInfo.recoveryValue],
              itemStyle: { color: cssColor('--color-danger', '#ff4d4f') },
              label: {
                offset: [0, -15],
                formatter: `${drawdownInfo.days}天修复`,
                backgroundColor: hexToRgba(cssColor('--color-danger', '#ff4d4f'), 0.7),
                position: 'bottom'
              }
            })
          }

          seriesData.markPoint.data = points
        }
        option.series.push(seriesData)
      }
    }

    chartInstance.setOption(option, true)
    chartInstance.resize()
  }

  const handleResize = () => { chartInstance?.resize() }

  onMounted(() => {
    initChart()
    window.addEventListener('resize', handleResize)
  })

  onUnmounted(() => {
    if (chartInstance) {
      chartInstance.dispose()
    }
    window.removeEventListener('resize', handleResize)
  })

  watch([() => props.netWorthTrend, () => props.grandTotal], () => {
    nextTick(() => updateChart())
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
    timeRanges,
    selectedRange,
    setTimeRange,
    activeTab,
    switchTab,
    fundChange,
    maxDrawdownInfo,
    comparisonInfo,
    getColor
  }
}
