import Decimal from 'decimal.js'
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from './useEChartsTheme'
import { fundAPI } from '../services/api'
import { fetchNavHistory, backtestFund, clipNavHistory } from '../services/backtest/runBacktestForFund'
import { compareStrategies } from '../services/backtest/strategyCompare'
import { describeSpec, sampleTimeline } from '../services/backtest/timelineSample'
import { normalizeSpec } from '../services/backtest/strategyRules'
import { isBacktestResult, type DcaRule, type NavPoint } from '../services/backtest/backtestTypes'
import { latestBacktestRun, saveBacktestRun } from '../db/backtestRuns'
import type { BacktestRunRecord } from '../db'
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

  /** NAV fetched once per fund and reused by both the backtest and the strategy comparison. */
  const navCache = ref<NavPoint[] | null>(null)

  const loadNav = async (): Promise<NavPoint[]> => {
    if (!navCache.value) navCache.value = await fetchNavHistory(currentFundCode.value)
    return navCache.value
  }

  /** UI units are percent (0.15 = 0.15%); the engine takes fractions (0.0015). */
  const specFromParams = () => ({
    amount: params.value.amount,
    initialAmount: params.value.initialAmount,
    feeRate: (params.value.feeRate ?? 0) / 100,
    takeProfitRate: params.value.takeProfitRate ? params.value.takeProfitRate / 100 : null,
    stopLossRate: params.value.stopLossRate ? params.value.stopLossRate / 100 : null,
    rule: ruleFromParams(),
  })

  const ruleFromParams = (): DcaRule => {
    if (params.value.rule === 'value_averaging') {
      return { type: 'value_averaging', targetGrowth: (params.value.targetGrowth ?? 0) / 100 }
    }
    if (params.value.rule === 'ma_deviation') {
      return { type: 'ma_deviation', window: params.value.maWindow ?? 250, factor: (params.value.maFactor ?? 50) / 100 }
    }
    return { type: 'fixed' }
  }

  /** Last persisted run for the current fund (Dexie) — shown as a hint with a 载入参数 action. */
  const lastRun = ref<BacktestRunRecord | undefined>(undefined)

  const lastRunLabel = computed(() => {
    if (!lastRun.value) return ''
    return new Date(lastRun.value.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  })

  const loadLastRun = async (code: string) => {
    try {
      return await latestBacktestRun(code)
    } catch {
      return undefined
    }
  }

  /** Restore the UI parameters of the last run (fractions → percent). */
  const applyLastRun = () => {
    const spec = lastRun.value?.spec
    if (!spec) return
    params.value.investmentType = spec.period ?? 'monthly'
    params.value.amount = spec.amount ?? 1000
    params.value.initialAmount = spec.initialAmount ?? 0
    params.value.feeRate = (spec.feeRate ?? 0.0015) * 100
    params.value.takeProfitRate = spec.takeProfitRate ? spec.takeProfitRate * 100 : null
    params.value.stopLossRate = spec.stopLossRate ? spec.stopLossRate * 100 : null
    params.value.investmentDay = spec.day ?? (spec.period === 'weekly' ? 0 : 1)
    const rule = spec.rule ?? { type: 'fixed' }
    params.value.rule = rule.type
    if (rule.type === 'value_averaging') params.value.targetGrowth = rule.targetGrowth * 100
    if (rule.type === 'ma_deviation') {
      params.value.maWindow = rule.window
      params.value.maFactor = rule.factor * 100
    }
  }

  const suggestStrategy = async () => {
    if (!currentFundCode.value) return
    strategyLoading.value = true
    strategyResult.value = null
    try {
      const range = { startDate: params.value.startDate, endDate: params.value.endDate }
      const nav = clipNavHistory(await loadNav(), range)
      const comparison = compareStrategies(
        nav,
        { ...specFromParams(), day: dayParam() },
        { range: `${range.startDate} ~ ${range.endDate}` },
      )
      if ('error' in comparison) error.value = '策略推荐失败: ' + comparison.error
      else strategyResult.value = comparison
    } catch (err: any) {
      error.value = '策略推荐失败: ' + (err?.message || String(err))
    } finally {
      strategyLoading.value = false
    }
  }

  const applyStrategyParams = () => {
    if (!strategyResult.value) return
    const key = strategyResult.value.recommended.key
    if (key === 'monthly' || key === 'weekly' || key === 'lump_sum') {
      params.value.investmentType = key
      params.value.rule = 'fixed'
    } else if (key === 'value_averaging') {
      params.value.investmentType = 'monthly'
      params.value.rule = 'value_averaging'
    } else if (key === 'ma_deviation') {
      params.value.investmentType = 'monthly'
      params.value.rule = 'ma_deviation'
    }
  }

  watch(() => props.fundCode, (val) => {
    if (val) {
      currentFundCode.value = val
      fetchFundInfo(val)
    }
  })

  const fetchFundInfo = async (code: string) => {
    navCache.value = null
    lastRun.value = await loadLastRun(code)
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
    rule: 'fixed',
    targetGrowth: 0,
    maWindow: 250,
    maFactor: 50,
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

  /** Investment day is only meaningful for monthly/weekly. */
  const dayParam = (): number | null => {
    const type = params.value.investmentType
    if (type === 'monthly' || type === 'weekly') return params.value.investmentDay ?? null
    return null
  }

  watch(() => params.value.investmentType, (newType) => {
    // Only reset the day when it cannot apply to the new period, so a day restored by
    // applyLastRun() (or picked by the user) survives switching monthly ⇄ weekly.
    const day = params.value.investmentDay
    if (newType === 'monthly') {
      if (day == null || day < 1 || day > 28) params.value.investmentDay = 1
    } else if (newType === 'weekly') {
      if (day == null || day < 0 || day > 4) params.value.investmentDay = 0
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
      const spec = { period: params.value.investmentType, day: dayParam(), ...specFromParams() }
      const outcome = await backtestFund(currentFundCode.value, {
        ...spec,
        startDate: params.value.startDate,
        endDate: params.value.endDate,
        navHistory: await loadNav(),
      })

      if (isBacktestResult(outcome)) {
        result.value = outcome
        await nextTick()
        initChart()
        await persistRun(spec, outcome)
      } else {
        error.value = outcome.error
      }
    } catch (err: any) {
      console.error('回测错误:', err)
      error.value = err?.message || '回测失败，请稍后重试'
    } finally {
      loading.value = false
    }
  }

  /** Persist the run (sampled timeline only) so it can be restored after a reload. */
  const persistRun = async (spec: any, outcome: any) => {
    try {
      await saveBacktestRun({
        fundCode: currentFundCode.value,
        spec,
        specLabel: describeSpec(normalizeSpec(spec)),
        summary: outcome.summary,
        checkpoints: sampleTimeline(outcome.timeline),
      })
      lastRun.value = await loadLastRun(currentFundCode.value)
    } catch (err) {
      console.warn('回测记录保存失败:', err)
    }
  }

  const resetParams = () => {
    params.value = {
      investmentType: 'monthly',
      investmentDay: 1,
      rule: 'fixed',
      targetGrowth: 0,
      maWindow: 250,
      maFactor: 50,
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

  /** One-line explanation of the selected DCA rule, shown under the rule selector. */
  const ruleHint = computed(() => {
    if (params.value.rule === 'value_averaging') {
      return '按目标市值补足差额：跌得多买得多，涨上去则少买或不买'
    }
    if (params.value.rule === 'ma_deviation') {
      return `净值低于 ${params.value.maWindow} 日均线时最多加码 ${params.value.maFactor}%，高于时最多减码同比例`
    }
    return ''
  })

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
    ruleHint,
    lastRun,
    lastRunLabel,
    applyLastRun,
    formatMoney,
    formatReturn,
    getReturnClass
  }
}
