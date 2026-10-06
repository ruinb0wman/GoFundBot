import Decimal from 'decimal.js'
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from './useEChartsTheme'
import { backtestPortfolio } from '../services/backtest/runPortfolioBacktest'
import {
  isPortfolioResult,
  type PortfolioBacktestResult,
  type PortfolioSpec,
  type RebalanceFrequency,
} from '../services/backtest/backtestTypes'
import { returnClass as getReturnClass } from '../utils/number'

export interface AssetRow {
  id: number
  kind: 'fund' | 'cash'
  code: string
  name: string
  weight: number
  /** Percent, cash legs only. */
  annualRate: number
}

const DAY_MS = 86_400_000

/** Shared by `useFundBacktest`; duplicated here to keep this composable standalone. */
function cssColor(name: string, fallback = ''): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function hexToRgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

export function usePortfolioBacktest() {
  const { echartThemeName } = useEChartsTheme()
  const chartEl = ref<HTMLElement | null>(null)
  const result = ref<PortfolioBacktestResult | null>(null)
  const loading = ref(false)
  const error = ref('')
  let chart: echarts.ECharts | null = null
  let nextId = 1

  const today = new Date().toISOString().split('T')[0]
  const threeYearsAgo = new Date(Date.now() - 3 * 365 * DAY_MS).toISOString().split('T')[0]

  /** 25/25/25/25 starting point: the permanent-portfolio shape this page was built for. */
  const assets = ref<AssetRow[]>([
    { id: nextId++, kind: 'fund', code: '510300', name: '沪深300ETF', weight: 25, annualRate: 0 },
    { id: nextId++, kind: 'fund', code: '511010', name: '国债ETF', weight: 25, annualRate: 0 },
    { id: nextId++, kind: 'fund', code: '518880', name: '黄金ETF', weight: 25, annualRate: 0 },
    { id: nextId++, kind: 'cash', code: '', name: '现金', weight: 25, annualRate: 2 },
  ])

  const params = ref({
    initialAmount: 100000,
    contributionAmount: 10000,
    contributionPeriod: 'yearly' as RebalanceFrequency,
    rebalanceFrequency: 'yearly' as RebalanceFrequency,
    /** Percent; null = calendar-only rebalancing. */
    rebalanceThreshold: null as number | null,
    /** Percent — the UI unit, converted to a fraction before the engine. */
    feeRate: 0.15,
    startDate: threeYearsAgo,
    endDate: today,
  })

  const totalWeight = computed(() => assets.value.reduce((sum, asset) => sum + (Number(asset.weight) || 0), 0))
  const normalizedWeights = computed(() =>
    assets.value.map((asset) => (totalWeight.value > 0 ? (Number(asset.weight) / totalWeight.value) * 100 : 0)),
  )
  const nodesWithoutWeight = computed(() => assets.value.some((asset) => !(Number(asset.weight) > 0)))
  const weightWarning = computed(() => (nodesWithoutWeight.value ? '每个资产权重需大于 0' : ''))

  function addFund(fund: Record<string, unknown>) {
    const code = String(fund.CODE ?? fund.fund_code ?? fund.code ?? '').trim()
    if (!code) return
    if (assets.value.some((asset) => asset.kind === 'fund' && asset.code === code)) return
    assets.value.push({
      id: nextId++,
      kind: 'fund',
      code,
      name: String(fund.NAME ?? fund.fund_name ?? fund.name ?? ''),
      weight: 25,
      annualRate: 0,
    })
  }

  function addCash() {
    assets.value.push({ id: nextId++, kind: 'cash', code: '', name: '现金', weight: 25, annualRate: 2 })
  }

  function removeAsset(id: number) {
    assets.value = assets.value.filter((asset) => asset.id !== id)
  }

  function specFromParams(): PortfolioSpec {
    return {
      assets: assets.value.map((asset) =>
        asset.kind === 'cash'
          ? { kind: 'cash' as const, name: asset.name, annualRate: (Number(asset.annualRate) || 0) / 100, weight: Number(asset.weight) }
          : { kind: 'fund' as const, fundCode: asset.code, name: asset.name, weight: Number(asset.weight) },
      ),
      initialAmount: Number(params.value.initialAmount) || 0,
      contribution:
        Number(params.value.contributionAmount) > 0
          ? { amount: Number(params.value.contributionAmount), period: params.value.contributionPeriod }
          : null,
      rebalance: {
        frequency: params.value.rebalanceFrequency,
        threshold: params.value.rebalanceThreshold != null ? params.value.rebalanceThreshold / 100 : null,
      },
      feeRate: (Number(params.value.feeRate) || 0) / 100,
    }
  }

  async function run() {
    if (assets.value.length < 2) {
      error.value = '至少添加 2 个资产（基金或现金）才能回测组合'
      return
    }
    if (assets.value.some((asset) => asset.kind === 'fund' && !asset.code.trim())) {
      error.value = '请填写所有基金资产代码'
      return
    }
    if (!(totalWeight.value > 0)) {
      error.value = '资产权重之和需大于 0'
      return
    }
    loading.value = true
    error.value = ''
    result.value = null
    try {
      const spec = specFromParams()
      const outcome = await backtestPortfolio({
        ...spec,
        startDate: params.value.startDate,
        endDate: params.value.endDate,
      })
      if (isPortfolioResult(outcome)) {
        result.value = outcome
        await nextTick()
        renderChart()
      } else {
        error.value = outcome.error
      }
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : '组合回测失败，请稍后重试'
    } finally {
      loading.value = false
    }
  }

  function renderChart() {
    if (!chartEl.value || !result.value) return
    chart?.dispose()
    chart = echarts.init(chartEl.value, echartThemeName.value)
    const timeline = result.value.timeline
    const primary = cssColor('--color-primary', '#1677ff')
    const tertiary = cssColor('--text-tertiary', '#9ca3af')
    const dates = timeline.map((record) => record.date)
    chart.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: { data: ['累计投入', '组合市值'], top: 8 },
      grid: { left: '3%', right: '4%', bottom: 40, top: 48, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: dates, axisLabel: { formatter: (value: string) => value.slice(5) } },
      yAxis: {
        type: 'value',
        name: '金额（元）',
        axisLabel: { formatter: (value: number) => new Decimal(value).div(10000).toFixed(1) + '万' },
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        { type: 'slider', start: 0, end: 100, height: 18, bottom: 8 },
      ],
      series: [
        {
          name: '累计投入',
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: timeline.map((record) => record.invested),
          lineStyle: { color: tertiary, width: 2 },
          itemStyle: { color: tertiary },
        },
        {
          name: '组合市值',
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: timeline.map((record) => record.value),
          lineStyle: { color: primary, width: 2 },
          itemStyle: { color: primary },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: hexToRgba(primary, 0.3) },
              { offset: 1, color: hexToRgba(primary, 0.04) },
            ]),
          },
        },
      ],
    })
  }

  const formatMoney = (value: unknown) => (value === null || value === undefined ? '0.00' : new Decimal(value as number).toFixed(2))
  const formatReturn = (value: unknown) => {
    if (value === null || value === undefined) return '0.00'
    const num = Number(value)
    return (num >= 0 ? '+' : '') + new Decimal(num).toFixed(2)
  }

  const handleResize = () => chart?.resize()

  function init() {
    window.addEventListener('resize', handleResize)
  }

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    chart?.dispose()
    chart = null
  })

  watch(echartThemeName, () => {
    if (result.value) {
      chart?.dispose()
      chart = null
      nextTick(() => renderChart())
    }
  })

  return {
    chartEl,
    result,
    loading,
    error,
    assets,
    params,
    totalWeight,
    normalizedWeights,
    weightWarning,
    today,
    addFund,
    addCash,
    removeAsset,
    run,
    init,
    formatMoney,
    formatReturn,
    getReturnClass,
  }
}
