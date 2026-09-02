// @ts-nocheck
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { marketAPI, alertAPI } from '../services/api'
import { useEChartsTheme } from './useEChartsTheme'
import { useDataPoller } from './useDataPoller'

export function useMarketOverview(props: any) {
  const router = useRouter()
  const { echartThemeName } = useEChartsTheme()

  const cssVar = (name: string, fallback = '') =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

  const hexToRgba = (hex: string, alpha: number) => {
    const clean = hex.replace('#', '')
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }

  const goldModal: any = ref({ visible: false, name: '', code: '', metalType: 'gold' })
  const goldDays = ref(10)
  const goldModalHistory: any = ref([])

  const metalChartOption = computed(() => {
    echartThemeName.value
    const data = goldModalHistory.value
    if (!data.length) return null
    const dates = data.map((i: any) => i.date.slice(5))
    const isSilver = goldModal.value.metalType === 'silver'

    if (isSilver) {
      const prices = data.map((i: any) => parseFloat(i.price) || null)
      const firstPrice = prices.find((p: number | null) => p !== null)
      const priceColor = prices[prices.length - 1] >= firstPrice
        ? cssVar('--color-danger', '#ff4d4f')
        : cssVar('--color-success', '#52c41a')
      return {
        grid: { top: 20, right: 20, bottom: 30, left: 55, containLabel: false },
        tooltip: {
          trigger: 'axis',
          formatter: (params: any) => {
            const idx = params[0]?.dataIndex
            if (idx == null) return ''
            const d = data[idx]
            return `<b>${d.date}</b><br/>价格: ${d.price} (${d.change}) ${d.unit || ''}<br/>最高: ${d.high}<br/>最低: ${d.low}`
          }
        },
        xAxis: { type: 'category', data: dates, axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 }, axisTick: { show: false } },
        yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { type: 'dashed', color: cssVar('--border-subtle', '#f0f0f0') } }, axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 } },
        series: [
          { name: '收盘价', data: prices, type: 'line', smooth: true, symbol: 'circle', symbolSize: 4, lineStyle: { width: 2, color: priceColor }, itemStyle: { color: priceColor }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: hexToRgba(priceColor, 0.2) }, { offset: 1, color: hexToRgba(priceColor, 0) }] } } }
        ]
      }
    }

    const chinaGold = data.map((i: any) => parseFloat(i.china_gold_price) || null)
    const zhoudafu = data.map((i: any) => parseFloat(i.zhoudafu_price) || null)
    return {
      grid: { top: 20, right: 20, bottom: 30, left: 55, containLabel: false },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const idx = params[0]?.dataIndex
          if (idx == null) return ''
          const d = data[idx]
          return `<b>${d.date}</b><br/>中国黄金: ${d.china_gold_price} (${d.china_gold_change})<br/>周大福: ${d.zhoudafu_price} (${d.zhoudafu_change})`
        }
      },
      legend: { data: ['中国黄金', '周大福'], bottom: 0, textStyle: { fontSize: 12 } },
      xAxis: { type: 'category', data: dates, axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 }, axisTick: { show: false } },
      yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { type: 'dashed', color: cssVar('--border-subtle', '#f0f0f0') } }, axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 } },
      series: [
        { name: '中国黄金', data: chinaGold, type: 'line', smooth: true, symbol: 'circle', symbolSize: 4, lineStyle: { width: 2, color: cssVar('--color-warning', '#faad14') }, itemStyle: { color: cssVar('--color-warning', '#faad14') } },
        { name: '周大福', data: zhoudafu, type: 'line', smooth: true, symbol: 'circle', symbolSize: 4, lineStyle: { width: 2, color: cssVar('--color-primary', '#1677ff') }, itemStyle: { color: cssVar('--color-primary', '#1677ff') } }
      ]
    }
  })

  const openGoldHistory = async (item: any) => {
    const isSilver = item.name && (item.name.includes('白银') || item.name.includes('银'))
    goldModal.value = { visible: true, name: item.name, code: item.code || '', metalType: isSilver ? 'silver' : 'gold' }
    document.body.style.overflow = 'hidden'
    await fetchMetalHistoryForModal()
  }

  const closeGoldHistory = () => {
    goldModal.value = { visible: false, name: '', code: '', metalType: 'gold' }
    document.body.style.overflow = ''
  }

  const isGoldItem = (item: any) => item.name && (item.name.includes('黄金') || item.name.includes('金') || item.name.includes('白银') || item.name.includes('银'))

  const fetchMetalHistoryForModal = async () => {
    try {
      const isSilver = goldModal.value.metalType === 'silver'
      const res = isSilver ? await marketAPI.getSilverHistory(goldDays.value) : await marketAPI.getGoldHistory(goldDays.value)
      if (res.data.success) goldModalHistory.value = res.data.data
    } catch (e) { console.error('获取历史数据失败:', e) }
  }

  const indicesIntraday: any = ref({ sh: [], sz: [], hs300: [] })
  const activeTab = ref('sh')
  const tabs = [
    { key: 'sh', name: '上证指数' },
    { key: 'sz', name: '深证成指' },
    { key: 'hs300', name: '沪深300' }
  ]

  const activeTabName = computed(() => tabs.find(t => t.key === activeTab.value)?.name || '')
  const hasCurrentData = computed(() => indicesIntraday.value[activeTab.value]?.length > 0)
  const latestKlineDate = computed(() => {
    const data = indicesIntraday.value[activeTab.value]
    if (!data || !data.length) return ''
    return data[data.length - 1].date || ''
  })

  const indicesPoller = useDataPoller<any[]>({
    fetcher: async () => {
      const res = await marketAPI.getCombinedIndices()
      return { success: true, data: res.data.data ?? [] }
    },
    type: 'indices',
    successInterval: 600_000,
    failureInterval: 60_000,
  })

  const klinePoller = useDataPoller<any>({
    fetcher: async () => {
      const now = new Date()
      const monthAgo = new Date(now)
      monthAgo.setDate(monthAgo.getDate() - 35)
      const startDate = monthAgo.toISOString().slice(0, 10).replace(/-/g, '')
      const codes = { sh: 'sh000001', sz: 'sz399001', hs300: 'sh000300' }
      const results = { ...indicesIntraday.value }
      let successCount = 0
      await Promise.all(Object.entries(codes).map(async ([key, code]) => {
        try {
          const res = await marketAPI.getIndexKline(code, { period: 'daily', startDate })
          if (res.data.success && Array.isArray(res.data.data)) {
            results[key] = res.data.data.slice(-22).map((item: any) => ({
              date: item.date, close: parseFloat(item.close) || 0, change: Number(item.changePercent)
            }))
            successCount++
          }
        } catch (e) { console.error(`获取 ${key} K线失败:`, e) }
      }))
      indicesIntraday.value = results
      return { success: successCount === Object.keys(codes).length, data: null }
    },
    type: 'kline',
    successInterval: 600_000,
    failureInterval: 60_000,
  })

  const goldPoller = useDataPoller<any[]>({
    fetcher: async () => {
      const res = await marketAPI.getGoldRealtime()
      return { success: res.data.success, data: res.data.data ?? [] }
    },
    type: 'gold',
    successInterval: 600_000,
    failureInterval: 60_000,
  })

  const volumePoller = useDataPoller<any[]>({
    fetcher: async () => {
      const res = await marketAPI.getVolume7Days()
      const volumeData = (res.data.data ?? []).slice().reverse()
      return { success: volumeData.length > 0, data: volumeData }
    },
    type: 'volume',
    successInterval: 600_000,
    failureInterval: 60_000,
  })

  const moneyFlowPoller = useDataPoller<any>({
    fetcher: async () => {
      const res = await marketAPI.getMarketMoneyFlow()
      return { success: true, data: res.data.data ?? null }
    },
    type: 'moneyFlow',
    successInterval: 600_000,
    failureInterval: 60_000,
  })

  const cryptoPoller = useDataPoller<any[]>({
    fetcher: async () => {
      const res = await marketAPI.getCryptoQuotes()
      return { success: res.data.success, data: res.data.data?.items ?? [] }
    },
    type: 'crypto',
    successInterval: 300_000, // 5 minutes for crypto (24/7 market)
    failureInterval: 60_000,
  })

  const marketIndex = computed(() => indicesPoller.data.value ?? [])
  const goldRealtime = computed(() => goldPoller.data.value ?? [])
  const aVolume = computed(() => volumePoller.data.value ?? [])
  const moneyFlow = computed(() => moneyFlowPoller.data.value)
  const cryptoData = computed(() => cryptoPoller.data.value ?? [])

  const indices = computed(() => {
    const all = marketIndex.value
    const chinaNames = ['上证指数','深证成指','创业板指','科创50','沪深300','上证50','中证500','中小100','恒生指数','国企指数','恒生科技']
    const globalNames = ['纳斯达克','纳斯达克100','道琼斯','标普500','日经225','韩国综合','英国富时100','德国DAX','法国CAC40','印度SENSEX']
    return {
      china: all.filter((i: any) => i.market === 'A股' || i.market === '港股' || chinaNames.some(n => i.name.includes(n))),
      global: all.filter((i: any) => i.market === '全球' || i.market === '美股' || globalNames.some(n => i.name.includes(n)))
    }
  })

  const chinaIndicesDate = computed(() => {
    const dates = indices.value.china.map((i: any) => i.date).filter(Boolean) as string[]
    return dates.length ? dates.sort().slice(-1)[0] : ''
  })

  const globalIndicesDate = computed(() => {
    const dates = indices.value.global.map((i: any) => i.date).filter(Boolean) as string[]
    return dates.length ? dates.sort().slice(-1)[0] : ''
  })

  const goldDataTime = computed(() => {
    const times = goldRealtime.value.map((i: any) => i.update_time).filter(Boolean) as string[]
    return times.length ? times.sort().slice(-1)[0] : ''
  })

  const cryptoDataTime = computed(() => {
    const times = cryptoData.value.map((i: any) => i.updateTime).filter(Boolean) as string[]
    return times.length ? times.sort().slice(-1)[0] : ''
  })

  const currentChartOption = computed(() => {
    echartThemeName.value
    const data = indicesIntraday.value[activeTab.value]
    if (!data || !data.length) return {}
    const dates = data.map((i: any) => {
      const d = String(i.date || '')
      const match = d.match(/(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})/)
      if (match) return `${parseInt(match[2])}-${parseInt(match[3])}`
      return d.slice(-5)
    })
    const closes = data.map((i: any) => i.close)
    const basePrice = closes[0]
    const isUp = closes[closes.length - 1] >= basePrice
    const lineColor = isUp ? cssVar('--color-danger', '#ff4d4f') : cssVar('--color-success', '#52c41a')

    return {
      grid: { top: 10, right: 20, bottom: 20, left: 55, containLabel: false },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const p = params[0]
          if (!p) return ''
          const item = data[p.dataIndex]
          const changeVal = item.change
          const changeText = changeVal != null ? `${changeVal >= 0 ? '+' : ''}${changeVal.toFixed(2)}%` : ''
          return `<div>${dates[p.dataIndex]}</div><div style="font-weight:bold;color:${lineColor}">${item.close.toFixed(2)}</div>${changeText ? `<div>${changeText}</div>` : ''}`
        }
      },
      xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: cssVar('--border-default', '#e5e7eb') } }, axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 }, axisTick: { show: false } },
      yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { type: 'dashed', color: cssVar('--border-subtle', '#f0f0f0') } }, axisLabel: { color: cssVar('--text-tertiary', '#9ca3af'), fontSize: 10 } },
      series: [{
        data: closes, type: 'line', smooth: true, symbol: 'circle', symbolSize: 3,
        lineStyle: { width: 2, color: lineColor },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: hexToRgba(lineColor, 0.2) }, { offset: 1, color: hexToRgba(lineColor, 0) }] } }
      }]
    }
  })

  const volumeOption = computed(() => {
    echartThemeName.value
    if (!aVolume.value.length) return {}
    const dates = aVolume.value.map((i: any) => formatDate(i.date))
    const values = aVolume.value.map((i: any) => parseFloat(i.total.replace('亿', '')))
    const barColor = cssVar('--color-primary', '#1677ff')
    return {
      grid: { top: 30, right: 10, bottom: 20, left: 10, containLabel: true },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const idx = params[0].dataIndex
          const item = aVolume.value[idx]
          return `<b>${item.date}</b><br/>总成交: ${item.total}<br/>沪: ${item.shanghai}<br/>深: ${item.shenzhen}<br/>北: ${item.beijing}`
        }
      },
      xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: cssVar('--border-default', '#e5e7eb') } }, axisTick: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: cssVar('--border-subtle', '#f0f0f0') } } },
      series: [{ data: values, type: 'bar', barWidth: '40%', itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: barColor }, { offset: 1, color: hexToRgba(barColor, 0.5) }] }, borderRadius: [4, 4, 0, 0] }, label: { show: true, position: 'top', formatter: '{c}亿', color: cssVar('--text-secondary', '#6b7280'), fontSize: 10 } }]
    }
  })

  const loading = computed(() =>
    indicesPoller.loading.value ||
    klinePoller.loading.value ||
    goldPoller.loading.value ||
    volumePoller.loading.value ||
    moneyFlowPoller.loading.value ||
    cryptoPoller.loading.value
  )

  const fetchAll = () => {
    indicesPoller.refresh()
    klinePoller.refresh()
    goldPoller.refresh()
    volumePoller.refresh()
    moneyFlowPoller.refresh()
    cryptoPoller.refresh()
  }

  const getChangeClass = (change: string) => {
    if (!change) return ''
    return String(change).startsWith('-') ? 'down' : 'up'
  }

  const getUpDnClass = (pct: string) => {
    if (!pct) return ''
    const val = parseFloat(pct)
    if (isNaN(val) || val === 0) return ''
    return String(pct).startsWith('-') ? 'down' : 'up'
  }

  const navigateToIndex = (item: any) => {
    if (item && item.code) router.push({ name: 'index-detail', params: { code: item.code } })
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ''
    const parts = dateStr.split('-')
    return parts.length >= 3 ? `${parts[1]}-${parts[2]}` : dateStr
  }

  const formatDataDate = (value: string) => {
    if (!value) return ''
    const trimmed = String(value).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
    const date = new Date(trimmed)
    if (Number.isNaN(date.getTime())) return trimmed
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  const moneyFlowOption = computed(() => {
    echartThemeName.value
    const data = moneyFlow.value
    if (!data || !data.date) return {}

    const categories = ['机构', '大户', '中户', '散户']
    const values = [
      data.superLargeNetInflow,
      data.largeNetInflow,
      data.mediumNetInflow,
      data.smallNetInflow,
    ]
    const valuesYi = values.map((v: number | null) => v != null ? v / 1e8 : 0)
    const maxAbs = Math.max(...valuesYi.map(Math.abs), 1)

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0]
          if (!p) return ''
          const raw = values[p.dataIndex]
          return `${categories[p.dataIndex]}: ${raw != null ? (raw / 1e8).toFixed(2) : '--'}亿`
        }
      },
      grid: { top: 5, right: 80, bottom: 25, left: 50, containLabel: true },
      xAxis: {
        type: 'value',
        max: maxAbs * 1.3,
        min: -maxAbs * 1.3,
        axisLabel: { formatter: '{value}亿', fontSize: 10, color: cssVar('--text-tertiary', '#9ca3af') },
        splitLine: { lineStyle: { type: 'dashed', color: cssVar('--border-subtle', '#f0f0f0') } },
      },
      yAxis: {
        type: 'category',
        data: categories,
        axisLabel: { fontSize: 11, fontWeight: 'bold', color: cssVar('--text-secondary', '#6b7280') },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [{
        type: 'bar',
        data: valuesYi.map((v: number, i: number) => ({
          value: v,
          itemStyle: {
            color: v >= 0
              ? cssVar('--color-danger', '#ff4d4f')
              : cssVar('--color-success', '#52c41a'),
            borderRadius: v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
          }
        })),
        barWidth: '55%',
        label: {
          show: true,
          position: 'right',
          formatter: (p: any) => `${p.value >= 0 ? '+' : ''}${p.value.toFixed(2)}亿`,
          fontSize: 10,
          color: cssVar('--text-primary', '#1f2937'),
        },
      }]
    }
  })

  const anomalies: any = ref([])
  const anomaliesLoading = ref(false)

  const fetchAnomalies = async () => {
    anomaliesLoading.value = true
    try {
      const res = await alertAPI.marketAnomaly()
      anomalies.value = (res.data || {}).anomalies || []
    } catch { anomalies.value = [] }
    finally { anomaliesLoading.value = false }
  }

  // Auto-start all pollers and anomalies
  // useDataPoller handles its own onMounted for auto-start
  fetchAnomalies()

  return {
    indicesStatus: indicesPoller.status,
    indicesUpdateTime: indicesPoller.updateTime,
    indicesLoading: indicesPoller.loading,
    klineStatus: klinePoller.status,
    klineUpdateTime: klinePoller.updateTime,
    klineLoading: klinePoller.loading,
    goldStatus: goldPoller.status,
    goldUpdateTime: goldPoller.updateTime,
    goldLoading: goldPoller.loading,
    volumeStatus: volumePoller.status,
    volumeUpdateTime: volumePoller.updateTime,
    volumeLoading: volumePoller.loading,
    moneyFlowStatus: moneyFlowPoller.status,
    moneyFlowUpdateTime: moneyFlowPoller.updateTime,
    moneyFlowLoading: moneyFlowPoller.loading,
    cryptoStatus: cryptoPoller.status,
    cryptoUpdateTime: cryptoPoller.updateTime,
    cryptoLoading: cryptoPoller.loading,

    loading, fetchAll, marketIndex, indices,
    chinaIndicesDate, globalIndicesDate, goldDataTime, cryptoDataTime,
    goldRealtime, aVolume, moneyFlow, moneyFlowOption, cryptoData,
    goldModal, goldDays, goldModalHistory, metalChartOption,
    openGoldHistory, closeGoldHistory, isGoldItem, fetchMetalHistoryForModal,
    formatDate, formatDataDate, getChangeClass, getUpDnClass, navigateToIndex,
    volumeOption, tabs, activeTab, activeTabName, hasCurrentData, latestKlineDate,
    currentChartOption, echartThemeName, anomalies, anomaliesLoading, fetchAnomalies,
  }
}
