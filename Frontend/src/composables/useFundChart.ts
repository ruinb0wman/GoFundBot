// @ts-nocheck
import Decimal from 'decimal.js'
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from './useEChartsTheme'
import { MA_PRESETS, calcMA } from '../utils/ma'
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
    { label: '成立来', value: 'all' }
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
  const activeMAs = ref([5, 20])
  const toggleMA = (period: number) => {
    if (activeMAs.value.includes(period)) {
      activeMAs.value = activeMAs.value.filter(p => p !== period)
    } else {
      activeMAs.value = [...activeMAs.value, period]
    }
    nextTick(() => updateChart())
  }
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

    if (filtered.length === 0) {
      console.warn('[FundChart] No data after filter', { rawDataLength: rawData.length, selectedRange: selectedRange.value })
      return { chartData: [], drawdownInfo: null, useRawValues: false }
    }

    const startVal = filtered[0][1]
    const endVal = filtered[filtered.length - 1][1]
    const s = new Decimal(startVal)
    fundChange.value = s.isZero() ? '0.00' : new Decimal(endVal).minus(startVal).div(s).mul(100).toFixed(2)

    const toPercent = (val) => s.isZero() ? 0 : new Decimal(val).minus(startVal).div(s).mul(100).toNumber()
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

      const dd = new Decimal(runningPeakValue).minus(val).div(runningPeakValue).toNumber()
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
      val: new Decimal(curMaxdd).mul(100).toFixed(2),
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
      useRawValues,
      rawValues: filtered.map(item => item[1]),
      timestamps: filtered.map(item => item[0]),
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
      const { chartData, useRawValues, rawValues, timestamps } = processData()
      const unit = useRawValues ? '' : '%'

      // Build trade marker lookup
      const tradeByDate = {}
      for (const t of (props.trades || [])) {
        if (t.tradeDate) tradeByDate[t.tradeDate] = t
      }

      const upColor = cssColor('--color-danger', '#ff4d4f')
      const downColor = cssColor('--color-success', '#52c41a')
      const bgCard = cssColor('--bg-card', '#fff')
      const splitColor = cssColor('--border-subtle', '#f0f0f0')
      const textColor = cssColor('--text-tertiary', '#999')

      const scatterData = []
      if (chartData.length > 0) {
        for (const point of chartData) {
          const dateKey = echarts.format.formatTime('yyyy-MM-dd', point[0])
          const t = tradeByDate[dateKey]
          if (t) {
            scatterData.push({
              value: [point[0], point[1]],
              tradeType: t.type,
              tradeAmount: t.amount || 0,
              tradeNav: t.nav,
              tradeDate: t.tradeDate,
              tradeShare: t.share || 0,
            })
          }
        }
      }

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

      if (scatterData.length > 0) {
        option.series.push({
          name: '买卖点',
          type: 'scatter',
          data: scatterData,
          symbol: (_v, params) => params.data?.tradeType === 'sell' ? 'diamond' : 'circle',
          symbolSize: 10,
          itemStyle: {
            color: (p) => p.data?.tradeType === 'buy' ? downColor : upColor,
            borderColor: bgCard,
            borderWidth: 2,
          },
          z: 3,
        })
      }
      // MA lines
      if (activeMAs.value.length > 0 && rawValues?.length > 0) {
        const sv = rawValues[0] || 1
        for (const period of activeMAs.value) {
          const maVals = calcMA(period, rawValues)
          const config = MA_PRESETS.find(m => m.period === period)
          const data = timestamps.map((ts, i) => [
            ts, maVals[i] === null ? null : useRawValues ? maVals[i] : (maVals[i] - sv) / sv * 100
          ])
          option.series.push({
            name: `MA${period}`, type: 'line', data, smooth: true, symbol: 'none',
            lineStyle: { width: 1, color: config?.color || '#999' }, z: 2,
          })
        }
      }
      option.yAxis.axisLabel.formatter = useRawValues ? '{value}' : '{value}%'
      option.tooltip.formatter = function (params) {
        if (!params?.length) return ''
        const date = echarts.format.formatTime('yyyy-MM-dd', params[0].value[0])
        let html = `<div style="font-weight:600;margin-bottom:4px">${date}</div>`
        for (const p of params) {
          if (p.seriesName === '本基金') {
            const val = p.value[1]
            html += `<div>${p.marker} 净值: ${val}${unit}</div>`
          } else if (p.seriesName?.startsWith('MA') && p.value?.[1] !== null) {
            html += `<div>${p.marker} ${p.seriesName}: ${(+p.value[1]).toFixed(2)}${unit}</div>`
          }
        }
        const t = tradeByDate[date]
        if (t) {
          const label = t.type === 'buy' ? '买入' : '卖出'
          const color = t.type === 'buy' ? downColor : upColor
          const amt = t.type === 'buy'
            ? `¥${(t.amount || 0).toFixed(2)}`
            : `${(t.share || 0).toFixed(2)}份`
          html += `<div style="margin-top:6px;padding-top:4px;border-top:1px solid ${splitColor}">`
          html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:4px"></span>`
          html += `<span style="font-weight:700;color:${color}">${label}</span> ${amt}</div>`
          if (t.tradeNav) {
            html += `<div style="font-size:11px;color:${textColor}">净值 ${(t.tradeNav || 0).toFixed(4)}</div>`
          }
        }
        return html
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
    chartEl, timeRanges, selectedRange, setTimeRange,
    activeTab, switchTab, fundChange, maxDrawdownInfo,
    comparisonInfo, getColor, activeMAs, toggleMA,
  }
}
