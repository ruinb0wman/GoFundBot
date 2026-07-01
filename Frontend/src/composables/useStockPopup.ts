// @ts-nocheck
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from './useEChartsTheme'
import { marketAPI } from '../services/api'
import { translate } from '../locales/index'

export function useStockPopup(props: any) {
  const { echartThemeName } = useEChartsTheme()
  const cssColor = (name: string, fallback = '') =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  const hexToRgba = (hex: string, a: number) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${a})`
  }

  const klineChartEl = ref<HTMLElement | null>(null)
  const klineData = ref<any[]>([])
  const klineLoading = ref(false)
  const klineError = ref('')
  const klineSelectedRange = ref('1y')
  let klineChartInstance: echarts.ECharts | null = null

  const klinePeriods = [
    { label: translate('fund.detail.month1'), value: '1m' }, { label: translate('fund.detail.month3'), value: '3m' },
    { label: translate('fund.detail.month6'), value: '6m' }, { label: translate('fund.detail.year1'), value: '1y' },
    { label: translate('fund.detail.sinceInception'), value: 'all' }
  ]

  const filteredKlineData = computed(() => {
    if (!klineData.value || klineData.value.length === 0) return []
    if (klineSelectedRange.value === 'all') return [...klineData.value].sort((a: any, b: any) => a.timestamp - b.timestamp)
    const now = new Date()
    let cutoff = new Date()
    const rangeMap: Record<string, number> = { '1m': -1, '3m': -3, '6m': -6, '1y': -12 }
    const months = rangeMap[klineSelectedRange.value] || -12
    cutoff.setMonth(now.getMonth() + months)
    const cutoffTs = cutoff.getTime()
    return klineData.value.filter((item: any) => item.timestamp >= cutoffTs).sort((a: any, b: any) => a.timestamp - b.timestamp)
  })

  const klineSummary = computed(() => {
    const data = filteredKlineData.value
    if (data.length === 0) return null
    const closes = data.map((d: any) => d.close).filter((v: any) => v != null)
    if (closes.length === 0) return null
    const startPrice = closes[0]
    const endPrice = closes[closes.length - 1]
    const changePercent = startPrice !== 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0
    const high = Math.max(...closes)
    const low = Math.min(...closes)
    return { startPrice, endPrice, changePercent, high, low }
  })

  const fetchKlineData = async (code: string) => {
    if (!code) return
    klineLoading.value = true
    klineError.value = ''
    klineData.value = []
    try {
      const response = await marketAPI.getStockKline(code, {
        period: 'daily', adjust: 'qfq',
        endDate: new Date().toISOString().slice(0, 10).replace(/-/g, '')
      })
      if (response.data?.success && Array.isArray(response.data?.data)) {
        klineData.value = response.data.data.map((item: any) => ({
          ...item,
          timestamp: parseKlineDate(item.date),
          open: parseFloat(item.open) || null, close: parseFloat(item.close) || null,
          high: parseFloat(item.high) || null, low: parseFloat(item.low) || null,
          volume: parseFloat(item.volume) || null, amount: parseFloat(item.amount) || null,
          changePercent: parseFloat(item.changePercent) || null
        }))
      } else {
        klineError.value = response.data?.error || '获取走势数据失败'
      }
    } catch (err: any) {
      console.error('获取K线数据失败:', err)
      klineError.value = err.response?.data?.error || '网络请求失败，请稍后重试'
    } finally {
      klineLoading.value = false
    }
  }

  const parseKlineDate = (dateStr: string) => {
    if (!dateStr) return 0
    const s = String(dateStr)
    if (s.includes('-')) return new Date(s).getTime()
    if (s.length === 8) {
      const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8)
      return new Date(`${y}-${m}-${d}`).getTime()
    }
    return new Date(s).getTime()
  }

  const setKlineRange = (range: string) => {
    klineSelectedRange.value = range
    nextTick(() => renderKlineChart())
  }

  const getTrendColor = (data: any[]) => {
    const dangerColor = cssColor('--color-danger', '#ff4d4f')
    const successColor = cssColor('--color-success', '#52c41a')
    const primaryColor = cssColor('--color-primary', '#1677ff')
    if (data.length < 2) return { line: primaryColor, area: [hexToRgba(primaryColor, 0.2), hexToRgba(primaryColor, 0.0)] }
    const firstClose = data[0].close, lastClose = data[data.length - 1].close
    const isUp = lastClose >= firstClose
    return {
      line: isUp ? dangerColor : successColor,
      area: isUp
        ? [hexToRgba(dangerColor, 0.2), hexToRgba(dangerColor, 0.0)]
        : [hexToRgba(successColor, 0.2), hexToRgba(successColor, 0.0)]
    }
  }

  const renderKlineChart = () => {
    const data = filteredKlineData.value
    if (!klineChartEl.value || data.length === 0) {
      if (klineChartInstance) { klineChartInstance.dispose(); klineChartInstance = null }
      return
    }
    if (!klineChartInstance) klineChartInstance = echarts.init(klineChartEl.value, echartThemeName.value)

    const colors = getTrendColor(data)
    const closeSeries = data.map((item: any) => [item.timestamp, item.close])
    const ohlcMap: Record<number, any> = {}
    data.forEach((item: any) => { ohlcMap[item.timestamp] = item })

    const gridColor = cssColor('--chart-grid', '#e5e7eb')
    const axisLabelColor = cssColor('--chart-axis-label', '#6b7280')
    const dangerColor = cssColor('--color-danger', '#ff4d4f')
    const successColor = cssColor('--color-success', '#52c41a')

    const option = {
      grid: { left: '3%', right: '4%', bottom: '8%', top: '8%', containLabel: true },
      tooltip: {
        trigger: 'axis',
        formatter: function (params: any) {
          if (!params || params.length === 0) return ''
          const ts = params[0].value[0]
          const item = ohlcMap[ts]
          if (!item) return ''
          const date = new Date(ts)
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
          const changeColor = (item.changePercent || 0) >= 0 ? dangerColor : successColor
          const changeSign = (item.changePercent || 0) >= 0 ? '+' : ''
          return `
            <div style="font-weight:600;margin-bottom:6px">${dateStr}</div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:12px">
              <span style="color:${axisLabelColor}">收盘：</span><span style="font-weight:600">${item.close?.toFixed(2) || '--'}</span>
              <span style="color:${axisLabelColor}">开盘：</span><span>${item.open?.toFixed(2) || '--'}</span>
              <span style="color:${axisLabelColor}">最高：</span><span style="color:${dangerColor}">${item.high?.toFixed(2) || '--'}</span>
              <span style="color:${axisLabelColor}">最低：</span><span style="color:${successColor}">${item.low?.toFixed(2) || '--'}</span>
              <span style="color:${axisLabelColor}">涨跌幅：</span><span style="color:${changeColor}">${changeSign}${(item.changePercent || 0).toFixed(2)}%</span>
              <span style="color:${axisLabelColor}">成交量：</span><span>${formatKlineVolume(item.volume)}</span>
            </div>`
        }
      },
      xAxis: {
        type: 'time', boundaryGap: false,
        axisLine: { lineStyle: { color: gridColor } },
        axisTick: { show: false },
        axisLabel: { color: axisLabelColor, fontSize: 10, formatter: function (value: any) { const d = new Date(value); return `${d.getMonth() + 1}/${d.getDate()}` } },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value', scale: true,
        splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
        axisLabel: { color: axisLabelColor, fontSize: 10, formatter: '{value}' }
      },
      series: [{
        name: '收盘价', type: 'line', data: closeSeries,
        smooth: true, symbol: 'none',
        lineStyle: { width: 2, color: colors.line },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: colors.area[0] }, { offset: 1, color: colors.area[1] }
        ]) },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { type: 'dashed', color: axisLabelColor, width: 1 },
          data: data.length > 0 ? [{ yAxis: data[0].close, label: { formatter: '{c}', fontSize: 10, color: axisLabelColor } }] : []
        }
      }]
    }
    klineChartInstance.setOption(option, true)
  }

  const formatKlineVolume = (vol: any) => {
    if (vol == null || isNaN(vol)) return '--'
    if (vol >= 10000) return (vol / 10000).toFixed(1) + ' 万手'
    return vol.toFixed(0) + ' 手'
  }

  watch(() => props.stockData, (newData: any) => {
    if (newData && newData.code) fetchKlineData(newData.code)
  }, { immediate: false })

  const handleResize = () => { if (klineChartInstance) klineChartInstance.resize() }

  watch(echartThemeName, () => {
    if (klineChartInstance) { klineChartInstance.dispose(); klineChartInstance = null }
    nextTick(() => renderKlineChart())
  })

  onMounted(() => { window.addEventListener('resize', handleResize) })

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    if (klineChartInstance) { klineChartInstance.dispose(); klineChartInstance = null }
  })

  watch(filteredKlineData, () => { nextTick(() => renderKlineChart()) }, { immediate: false })

  const changeClass = computed(() => {
    if (!props.stockData) return ''
    const change = parseFloat(props.stockData.changePercent) || 0
    if (change > 0) return 'up'
    if (change < 0) return 'down'
    return ''
  })

  const exchangeLabel = computed(() => {
    const ex = props.stockData?.exchange
    if (!ex) return ''
    const map: Record<string, string> = { sh: '沪市', sz: '深市', bj: '北交所' }
    return map[ex] || ex.toUpperCase()
  })

  const formatPrice = (val: any) => { const num = parseFloat(val); if (isNaN(num) || num === 0) return '--'; return num.toFixed(2) }
  const formatChange = (val: any) => { const num = parseFloat(val); if (isNaN(num)) return '--'; return (num > 0 ? '+' : '') + num.toFixed(2) }
  const formatPercent = (val: any) => { const num = parseFloat(val); if (isNaN(num) || num === 0) return '--'; return (num > 0 ? '+' : '') + num.toFixed(2) + '%' }
  const formatVolume = (val: any) => { const num = parseFloat(val); if (isNaN(num) || num === 0) return '--'; if (num >= 10000) return (num / 10000).toFixed(2) + ' 万手'; return num.toFixed(0) + ' 手' }
  const formatAmount = (val: any) => { const num = parseFloat(val); if (isNaN(num) || num === 0) return '--'; if (num >= 100000000) return (num / 100000000).toFixed(2) + ' 亿'; if (num >= 10000) return (num / 10000).toFixed(2) + ' 万'; return num.toFixed(2) }
  const formatPE = (val: any) => { const num = parseFloat(val); if (isNaN(num) || num === 0) return '--'; return num.toFixed(2) }
  const formatMarketCap = (val: any) => { const num = parseFloat(val); if (isNaN(num) || num === 0) return '--'; if (num >= 100000000) return (num / 100000000).toFixed(2) + ' 亿'; if (num >= 10000) return (num / 10000).toFixed(2) + ' 万'; return num.toFixed(2) }

  return {
    klineChartEl, klineLoading, klineError, klinePeriods, klineSelectedRange,
    filteredKlineData, klineSummary, setKlineRange, changeClass, exchangeLabel,
    formatPrice, formatChange, formatPercent, formatVolume, formatAmount,
    formatPE, formatMarketCap
  }
}
