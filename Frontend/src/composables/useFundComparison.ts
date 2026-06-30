// @ts-nocheck
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from './useEChartsTheme'
import { fundAPI } from '../services/api'
import { exportToCSV } from '../utils/exportUtils'

export function useFundComparison(props: any, emit: any) {
  const chartEl = ref<HTMLElement | null>(null)
  const { echartThemeName } = useEChartsTheme()
  const cssColor = (name: string, fallback = '') =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  const selectedRange = ref('1y')
  const loading = ref(false)
  const maxFunds = 5
  let chartInstance: echarts.ECharts | null = null

  const colors = [
    cssColor('--chart-1', '#1677ff'), cssColor('--chart-2', '#52c41a'),
    cssColor('--chart-3', '#faad14'), cssColor('--chart-4', '#ff4d4f'),
    cssColor('--chart-5', '#73c0de'), cssColor('--chart-6', '#3ba272'),
    cssColor('--chart-7', '#fc8452'), cssColor('--chart-8', '#9a60b4')
  ]

  const timeRanges = [
    { label: '近3月', value: '3m' }, { label: '近6月', value: '6m' },
    { label: '近1年', value: '1y' }, { label: '近3年', value: '3y' },
    { label: '成立来', value: 'all' }
  ]

  const selectedFunds: any = ref([])

  const fetchFundCompareData = async (fundCode: string) => {
    try {
      const response = await fundAPI.getFundCompareData(fundCode)
      return response.data
    } catch (error) {
      console.error(`获取基金 ${fundCode} 对比数据失败:`, error)
      return null
    }
  }

  const normalizeData = (data: any[]) => {
    if (!data || data.length === 0) return []
    return data.map((item: any) => ({
      x: new Date(item.date).getTime(),
      y: item.net_worth
    })).filter(item => !isNaN(item.x) && item.y !== null && item.y !== undefined)
  }

  const calculateReturns = (trendData: any[]) => {
    if (!trendData || trendData.length === 0) return {}
    const sortedData = [...trendData].sort((a: any, b: any) => a.x - b.x)
    const latestValue = sortedData[sortedData.length - 1].y
    const now = Date.now()

    const getReturnForPeriod = (months: any) => {
      let targetTime
      if (months === 'all') {
        targetTime = sortedData[0].x
      } else {
        const date = new Date(now)
        date.setMonth(date.getMonth() - months)
        targetTime = date.getTime()
      }
      let closest = sortedData[0]
      for (const item of sortedData) {
        if (item.x >= targetTime) { closest = item; break }
      }
      if (closest.y === 0) return null
      return ((latestValue - closest.y) / closest.y * 100).toFixed(2)
    }

    return {
      m3: getReturnForPeriod(3), m6: getReturnForPeriod(6),
      y1: getReturnForPeriod(12), y3: getReturnForPeriod(36),
      all: getReturnForPeriod('all')
    }
  }

  const loadFundData = async (fund: any) => {
    const data = await fetchFundCompareData(fund.code)
    if (!data) return fund
    if (data.net_worth_trend && data.net_worth_trend.length > 0) {
      fund.trendData = normalizeData(data.net_worth_trend)
      fund.returns = calculateReturns(fund.trendData)
    }
    const basicInfo = data.basic_info || {}
    fund.fundType = basicInfo.fund_type || '--'
    const scaleData = data.scale_fluctuation || {}
    if (scaleData.series && scaleData.series.length > 0) {
      const latestItem = scaleData.series[scaleData.series.length - 1]
      fund.scale = latestItem && latestItem.y !== undefined && latestItem.y !== null
        ? latestItem.y.toFixed(2) + '亿' : '--'
    }
    fund.riskMetrics = data.risk_metrics || {}
    fund.dataSource = data.data_source || 'unknown'
    fund.cacheTime = data.cache_time
    const evalData = data.performance_evaluation || {}
    fund.evaluation = {
      avgScore: evalData.avr || null,
      data: evalData.data || [],
      categories: evalData.categories || []
    }
    const managers = data.fund_managers || []
    if (managers.length > 0) {
      const manager = managers[0]
      fund.manager = {
        name: manager.name || '--',
        experience: manager.work_experience || '--',
        managedSize: manager.managed_fund_size || '--',
        avgScore: manager.ability_assessment?.average_score || null
      }
    }
    return fund
  }

  const filterByDate = (data: any[], range: string) => {
    if (!data || data.length === 0) return []
    const now = new Date()
    let startDate = new Date(0)
    if (range === '3m') { startDate = new Date(now.getTime()); startDate.setMonth(startDate.getMonth() - 3) }
    else if (range === '6m') { startDate = new Date(now.getTime()); startDate.setMonth(startDate.getMonth() - 6) }
    else if (range === '1y') { startDate = new Date(now.getTime()); startDate.setFullYear(startDate.getFullYear() - 1) }
    else if (range === '3y') { startDate = new Date(now.getTime()); startDate.setFullYear(startDate.getFullYear() - 3) }
    return data.filter(item => item.x >= startDate.getTime())
  }

  const toPercentChange = (data: any[]) => {
    if (!data || data.length === 0) return []
    const sortedData = [...data].sort((a: any, b: any) => a.x - b.x)
    const startVal = sortedData[0].y
    if (startVal === 0) return []
    return sortedData.map(item => [
      item.x, parseFloat(((item.y - startVal) / startVal * 100).toFixed(2))
    ])
  }

  const initChart = () => {
    if (!chartEl.value) return
    const rect = chartEl.value.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      setTimeout(initChart, 100)
      return
    }
    if (chartInstance) chartInstance.dispose()
    chartInstance = echarts.init(chartEl.value, echartThemeName.value)
    updateChart()
  }

  const updateChart = () => {
    if (!chartInstance || selectedFunds.value.length < 2) return
    const series: any[] = []
    selectedFunds.value.forEach((fund: any) => {
      if (!fund.trendData || fund.trendData.length === 0) return
      const filteredData = filterByDate(fund.trendData, selectedRange.value)
      const percentData = toPercentChange(filteredData)
      if (percentData.length > 0) {
        series.push({
          name: fund.name, type: 'line', data: percentData,
          smooth: true, symbol: 'none',
          lineStyle: { width: 2, color: fund.color },
          itemStyle: { color: fund.color }
        })
      }
    })
    if (series.length === 0) return
    const dangerColor = cssColor('--color-danger', '#ff4d4f')
    const successColor = cssColor('--color-success', '#52c41a')
    const option = {
      tooltip: {
        trigger: 'axis',
        formatter: function (params: any) {
          let res = '<div style="font-weight:bold;margin-bottom:5px;">' +
            echarts.format.formatTime('yyyy-MM-dd', params[0].value[0]) + '</div>'
          params.forEach((item: any) => {
            const val = item.value[1]
            const color = val >= 0 ? dangerColor : successColor
            res += `<div style="display:flex;align-items:center;margin:3px 0;">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${item.color};margin-right:8px;"></span>
              <span style="flex:1;">${item.seriesName}</span>
              <span style="font-weight:bold;color:${color};margin-left:10px;">${val >= 0 ? '+' : ''}${val}%</span>
            </div>`
          })
          return res
        }
      },
      legend: {
        show: true, top: 5,
        data: selectedFunds.value.map((f: any) => f.name),
        textStyle: { fontSize: 12 }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: 40, containLabel: true },
      xAxis: {
        type: 'time', boundaryGap: false,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { formatter: '{MM}-{dd}' }
      },
      yAxis: {
        type: 'value', scale: true,
        splitLine: { lineStyle: { type: 'dashed' } },
        axisLabel: { formatter: '{value}%' }
      },
      series: series
    }
    chartInstance.setOption(option, true)
  }

  const setTimeRange = (range: string) => { selectedRange.value = range; updateChart() }
  const removeFund = (fundCode: string) => { emit('remove-fund', fundCode) }
  const clearSelection = () => { emit('clear-funds') }

  const exportComparison = () => {
    const funds: any[] = selectedFunds.value
    const rows = [
      { key: '近3月收益', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.returns?.m3 ? formatReturn(f.returns.m3) : '--'])) },
      { key: '近6月收益', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.returns?.m6 ? formatReturn(f.returns.m6) : '--'])) },
      { key: '近1年收益', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.returns?.y1 ? formatReturn(f.returns.y1) : '--'])) },
      { key: '近3年收益', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.returns?.y3 ? formatReturn(f.returns.y3) : '--'])) },
      { key: '成立以来收益', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.returns?.all ? formatReturn(f.returns.all) : '--'])) },
      { key: '基金规模', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.scale || '--'])) },
      { key: '基金类型', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.fundType || '--'])) },
      { key: '最大回撤(近1年)', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.riskMetrics?.max_drawdown_1y ? formatDrawdown(f.riskMetrics.max_drawdown_1y) : '--'])) },
      { key: '最大回撤(近3年)', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.riskMetrics?.max_drawdown_3y ? formatDrawdown(f.riskMetrics.max_drawdown_3y) : '--'])) },
      { key: '夏普比率(近1年)', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.riskMetrics?.sharpe_ratio_1y ? formatSharpe(f.riskMetrics.sharpe_ratio_1y) : '--'])) },
      { key: '夏普比率(近3年)', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.riskMetrics?.sharpe_ratio_3y ? formatSharpe(f.riskMetrics.sharpe_ratio_3y) : '--'])) },
      { key: '年化波动率(近1年)', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.riskMetrics?.volatility_1y ? formatVolatility(f.riskMetrics.volatility_1y) : '--'])) },
      { key: '综合评分', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.evaluation?.avgScore != null ? String(f.evaluation.avgScore) : '--'])) },
      { key: '选证能力', ...Object.fromEntries(funds.map(f => [f.code || f.name, getEvalScore(f, 0)])) },
      { key: '收益率评分', ...Object.fromEntries(funds.map(f => [f.code || f.name, getEvalScore(f, 1)])) },
      { key: '抗风险评分', ...Object.fromEntries(funds.map(f => [f.code || f.name, getEvalScore(f, 2)])) },
      { key: '稳定性评分', ...Object.fromEntries(funds.map(f => [f.code || f.name, getEvalScore(f, 3)])) },
      { key: '择时能力评分', ...Object.fromEntries(funds.map(f => [f.code || f.name, getEvalScore(f, 4)])) },
      { key: '基金经理', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.manager?.name || '--'])) },
      { key: '从业经验', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.manager?.experience || '--'])) },
      { key: '管理规模', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.manager?.managedSize || '--'])) },
      { key: '经理评分', ...Object.fromEntries(funds.map(f => [f.code || f.name, f.manager?.avgScore != null ? String(f.manager.avgScore) : '--'])) },
    ]
    const columns = [
      { key: 'key', label: '指标' },
      ...funds.map((f: any) => ({ key: f.code || f.name, label: `${f.name} (${f.code})` })),
    ]
    exportToCSV(rows, columns, `基金对比_${new Date().toISOString().slice(0, 10)}`)
  }

  const getValueClass = (value: any) => {
    if (value === null || value === undefined || value === '--') return ''
    const num = parseFloat(value)
    if (num > 0) return 'positive'
    if (num < 0) return 'negative'
    return ''
  }

  const getSharpClass = (value: any) => {
    if (value === null || value === undefined) return ''
    const num = parseFloat(value)
    if (num >= 1) return 'positive'
    if (num < 0) return 'negative'
    return ''
  }

  const getScoreClass = (score: any) => {
    if (!score) return ''
    if (score >= 80) return 'score-high'
    if (score >= 60) return 'score-mid'
    return 'score-low'
  }

  const formatReturn = (value: any) => {
    if (value === null || value === undefined) return '--'
    const num = parseFloat(value)
    return (num >= 0 ? '+' : '') + value + '%'
  }

  const formatDrawdown = (value: any) => {
    if (value === null || value === undefined) return '--'
    return '-' + value.toFixed(2) + '%'
  }

  const formatSharpe = (value: any) => {
    if (value === null || value === undefined) return '--'
    return value.toFixed(2)
  }

  const formatVolatility = (value: any) => {
    if (value === null || value === undefined) return '--'
    return value.toFixed(2) + '%'
  }

  const getSharpeClass = (value: any) => {
    if (value === null || value === undefined) return ''
    if (value >= 1) return 'positive'
    if (value >= 0) return ''
    return 'negative'
  }

  const getEvalScore = (fund: any, index: number) => {
    if (!fund.evaluation?.data || !fund.evaluation.data[index]) return '--'
    return fund.evaluation.data[index].toFixed(1)
  }

  watch(() => props.compareFunds, async (newFunds: any) => {
    if (!newFunds || newFunds.length === 0) {
      selectedFunds.value = []
      return
    }
    loading.value = true
    const updatedFunds = []
    for (let i = 0; i < newFunds.length; i++) {
      const fund = newFunds[i]
      const existing = selectedFunds.value.find((f: any) => f.code === fund.code)
      if (existing) {
        existing.color = colors[i % colors.length]
        updatedFunds.push(existing)
      } else {
        const newFund: any = {
          code: fund.code, name: fund.name, color: colors[i % colors.length],
          trendData: null, returns: {}, evaluation: {}, manager: null,
          scale: '--', fundType: '--', riskMetrics: {},
          dataSource: null, cacheTime: null
        }
        await loadFundData(newFund)
        updatedFunds.push(newFund)
      }
    }
    selectedFunds.value = updatedFunds
    loading.value = false
    await nextTick()
    if (selectedFunds.value.length >= 2) setTimeout(() => initChart(), 50)
  }, { immediate: true, deep: true })

  watch(selectedRange, () => updateChart())

  watch(echartThemeName, () => {
    if (chartInstance) { chartInstance.dispose(); chartInstance = null }
    if (selectedFunds.value.length >= 2) setTimeout(() => initChart(), 50)
  })

  const handleResize = () => { chartInstance?.resize() }

  onMounted(() => { window.addEventListener('resize', handleResize) })

  onUnmounted(() => {
    if (chartInstance) chartInstance.dispose()
    window.removeEventListener('resize', handleResize)
  })

  return {
    chartEl, selectedRange, loading, maxFunds, timeRanges, selectedFunds,
    setTimeRange, removeFund, clearSelection, exportComparison,
    getValueClass, getSharpClass, getScoreClass, getSharpeClass,
    formatReturn, formatDrawdown, formatSharpe, formatVolatility,
    getEvalScore
  }
}
