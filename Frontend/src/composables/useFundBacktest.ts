import Decimal from 'decimal.js'
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from './useEChartsTheme'
import { backtestAPI, fundAPI } from '../services/api'
import { returnClass as getReturnClass } from '../utils/number'

export function useFundBacktest(props: { fundCode: string }) {
  const chartEl = ref<HTMLElement | null>(null)
  const { echartThemeName } = useEChartsTheme()
  const cssColor = (name: string, fallback = '') => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  const hexToRgba = (hex: string, a: number) => { const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return `rgba(${r},${g},${b},${a})` }

  const loading = ref(false)
  const error = ref('')
  const result: any = ref(null)

  const currentFundCode = ref(props.fundCode || '')
  const currentFundName = ref('')
  const minStartDate = ref('')

  const strategyResult: any = ref(null)
  const strategyLoading = ref(false)

  const suggestStrategy = async () => {
    if (!currentFundCode.value) return
    strategyLoading.value = true
    strategyResult.value = null
    try {
      const response = await backtestAPI.strategySuggest({ fund_code: currentFundCode.value })
      strategyResult.value = response.data
    } catch (err: any) {
      error.value = '策略推荐失败: ' + (err.response?.data?.error || err.message)
    } finally {
      strategyLoading.value = false
    }
  }

  const applyStrategyParams = () => {
    if (!strategyResult.value) return
    const key = strategyResult.value.recommended.key
    if (key === 'monthly') params.value.investmentType = 'monthly'
    else if (key === 'weekly') params.value.investmentType = 'weekly'
    else params.value.investmentType = key
  }

  watch(() => props.fundCode, (val) => {
    if (val) {
      currentFundCode.value = val
      fetchFundInfo(val)
    }
  })

  const fetchFundInfo = async (code: string) => {
    try {
      const response = await fundAPI.getFundTrend(code)
      if (response.data && response.data.net_worth_trend && response.data.net_worth_trend.length > 0) {
        const firstDate = response.data.net_worth_trend[0].date
        minStartDate.value = firstDate.split(' ')[0]
        if (params.value.startDate < minStartDate.value) {
          params.value.startDate = minStartDate.value
        }
      }
    } catch (err) {
      console.error('获取基金信息失败:', err)
    }
  }

  const handleFundSelected = (fund: any) => {
    const code = fund.CODE || fund.fund_code || fund.code
    currentFundCode.value = code
    currentFundName.value = fund.NAME || fund.fund_name || fund.name
    result.value = null
    error.value = ''
    fetchFundInfo(code)
  }

  const changeFund = () => {
    currentFundCode.value = ''
    currentFundName.value = ''
    result.value = null
    error.value = ''
  }

  const showDetail = ref(false)
  const chartType = ref('value')
  const currentPage = ref(1)
  const pageSize = 50

  let chartInstance: echarts.ECharts | null = null

  const today = new Date().toISOString().split('T')[0]

  const params: any = ref({
    investmentType: 'monthly',
    investmentDay: 1 as number | null,
    amount: 1000,
    initialAmount: 0,
    feeRate: 0.15,
    takeProfitRate: null as number | null,
    stopLossRate: null as number | null,
    startDate: new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: today,
    dividendMode: 'reinvest',
    takeProfitAction: 'cash'
  })

  watch(() => params.value.investmentType, (newType) => {
    if (newType === 'monthly') {
      params.value.investmentDay = 1
    } else if (newType === 'weekly') {
      params.value.investmentDay = 0
    } else {
      params.value.investmentDay = null
    }
  })

  const paginatedTimeline = computed(() => {
    if (!result.value || !result.value.timeline) return []
    const start = (currentPage.value - 1) * pageSize
    const end = start + pageSize
    return result.value.timeline.slice(start, end)
  })

  const totalPages = computed(() => {
    if (!result.value || !result.value.timeline) return 0
    return Math.ceil(result.value.timeline.length / pageSize)
  })

  const runBacktest = async () => {
    if (!params.value.startDate || !params.value.endDate) {
      error.value = '请选择开始和结束日期'
      return
    }

    if (params.value.investmentType === 'lump_sum') {
      if (params.value.amount <= 0 && params.value.initialAmount <= 0) {
        error.value = '请输入投资金额或初始资金'
        return
      }
    } else if (params.value.amount < 100) {
      error.value = '每期定投金额不能小于100元'
      return
    }

    loading.value = true
    error.value = ''
    result.value = null
    currentPage.value = 1

    try {
      const response = await backtestAPI.fixedInvestment({
        fund_code: currentFundCode.value,
        start_date: params.value.startDate,
        end_date: params.value.endDate,
        investment_type: params.value.investmentType,
        investment_day: params.value.investmentDay,
        amount: params.value.amount,
        initial_amount: params.value.initialAmount,
        fee_rate: params.value.feeRate,
        take_profit_rate: params.value.takeProfitRate,
        stop_loss_rate: params.value.stopLossRate,
        dividend_mode: params.value.dividendMode,
        take_profit_action: params.value.takeProfitAction
      })

      if (response.data && response.data.summary) {
        result.value = response.data
        await nextTick()
        initChart()
      } else if (response.data.error) {
        error.value = response.data.error
      } else {
        error.value = '回测失败：返回数据格式异常'
      }
    } catch (err: any) {
      console.error('回测错误:', err)
      error.value = err.response?.data?.error || err.response?.data?.message || '回测失败，请稍后重试'
    } finally {
      loading.value = false
    }
  }

  const resetParams = () => {
    params.value = {
      investmentType: 'monthly',
      investmentDay: 1,
      amount: 1000,
      initialAmount: 0,
      feeRate: 0.15,
      takeProfitRate: null,
      stopLossRate: null,
      startDate: new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: today,
      dividendMode: 'reinvest',
      takeProfitAction: 'cash'
    }
    result.value = null
    error.value = ''
    currentPage.value = 1
  }

  const formatMoney = (value: any) => {
    if (value === null || value === undefined) return '0.00'
    return new Decimal(value).toFixed(2)
  }

  const formatReturn = (value: any) => {
    if (value === null || value === undefined) return '0.00'
    const num = Number(value)
    return (num >= 0 ? '+' : '') + new Decimal(num).toFixed(2)
  }

  const initChart = () => {
    if (!chartEl.value || !result.value) return
    if (chartInstance) {
      chartInstance.dispose()
    }
    chartInstance = echarts.init(chartEl.value, echartThemeName.value)
    updateChart()
  }

  const updateChart = () => {
    if (!chartInstance || !result.value) return

    const timeline = result.value.timeline
    const dates = timeline.map((item: any) => item.date)
    const primaryColor = cssColor('--color-primary', '#1677ff')
    const dangerColor = cssColor('--color-danger', '#ff4d4f')
    const warningColor = cssColor('--color-warning', '#faad14')
    const tertiaryColor = cssColor('--text-tertiary', '#9ca3af')

    let series: any[] = []
    let yAxisName = ''

    if (chartType.value === 'value') {
      yAxisName = '金额（元）'
      series = [
        {
          name: '累计投入',
          type: 'line',
          data: timeline.map((item: any) => item.invested),
          smooth: true,
          lineStyle: { color: tertiaryColor, width: 2 },
          itemStyle: { color: tertiaryColor }
        },
        {
          name: '市值',
          type: 'line',
          data: timeline.map((item: any) => item.value),
          smooth: true,
          lineStyle: { color: primaryColor, width: 2 },
          itemStyle: { color: primaryColor },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: hexToRgba(primaryColor, 0.3) },
              { offset: 1, color: hexToRgba(primaryColor, 0.05) }
            ])
          }
        }
      ]
    } else {
      yAxisName = '收益率（%）'
      series = [
        {
          name: '收益率',
          type: 'line',
          data: timeline.map((item: any) => item.return_rate),
          smooth: true,
          lineStyle: { color: dangerColor, width: 2 },
          itemStyle: { color: dangerColor },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: hexToRgba(dangerColor, 0.3) },
              { offset: 1, color: hexToRgba(dangerColor, 0.05) }
            ])
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: warningColor, type: 'dashed' },
            data: [{ yAxis: 0 }],
            label: { show: false }
          }
        }
      ]
    }

    const option = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: any) => {
          let html = `<div style="font-weight: bold; margin-bottom: 5px;">${params[0].axisValue}</div>`
          params.forEach((param: any) => {
            const value = chartType.value === 'value'
              ? formatMoney(param.value)
              : param.value + '%'
            html += `<div>${param.marker} ${param.seriesName}: ${value}</div>`
          })
          return html
        }
      },
      legend: {
        data: series.map(s => s.name),
        top: 10
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: 50, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: dates,
        axisLabel: {
          formatter: (value: string) => value.substring(5)
        }
      },
      yAxis: {
        type: 'value',
        name: yAxisName,
        axisLabel: {
          formatter: chartType.value === 'value'
            ? (value: number) => new Decimal(value).div(1000).toFixed(1) + 'k'
            : '{value}%'
        }
      },
      series: series,
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        { start: 0, end: 100, height: 20, bottom: 10 }
      ]
    }

    chartInstance.setOption(option, true)
  }

  watch(chartType, () => {
    updateChart()
  })

  watch(result, (newVal) => {
    if (newVal) {
      showDetail.value = false
    }
  })

  watch(echartThemeName, () => {
    if (chartInstance) {
      chartInstance.dispose()
      chartInstance = null
    }
    if (result.value) {
      nextTick(() => initChart())
    }
  })

  const handleResize = () => {
    if (chartInstance) {
      chartInstance.resize()
    }
  }

  onMounted(() => {
    window.addEventListener('resize', handleResize)
  })

  onUnmounted(() => {
    if (chartInstance) {
      chartInstance.dispose()
      chartInstance = null
    }
    window.removeEventListener('resize', handleResize)
  })

  return {
    chartEl,
    loading,
    error,
    result,
    currentFundCode,
    currentFundName,
    minStartDate,
    strategyResult,
    strategyLoading,
    showDetail,
    chartType,
    currentPage,
    params,
    today,
    paginatedTimeline,
    totalPages,
    handleFundSelected,
    changeFund,
    runBacktest,
    resetParams,
    suggestStrategy,
    applyStrategyParams,
    formatMoney,
    formatReturn,
    getReturnClass
  }
}
