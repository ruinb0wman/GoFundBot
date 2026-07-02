// @ts-nocheck
/* eslint-disable max-lines */
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useEChartsTheme } from './useEChartsTheme'
import { useDebouncedWatch } from './useDebouncedWatch'
import { fundAPI } from '../services/api'
import { portfolioAPI } from '../services/portfolioApi'
import { useFundStore } from '../stores/fundStore'

export function useMyPositions() {
  const today = new Date().toISOString().split('T')[0]
  const { echartThemeName } = useEChartsTheme()
  const cssColor = (name, fallback = '') => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

  const positions = ref([])
  const helperText = ref('')
  const isAutoFilling = ref(false)
  const trendCache = new Map()
  const quoteMap = ref({})
  const historyMap = ref({})
  const lastRefreshTime = ref('')
  let refreshTimer = null

  const normalizeFundCode = code => {
    const text = String(code ?? '').trim()
    return /^\d{1,6}$/.test(text) ? text.padStart(6, '0') : text
  }

  const fundSearchList = response => {
    const data = response?.data?.data
    return Array.isArray(data) ? data : (data?.funds || [])
  }

  const trendNav = item => {
    if (!item) return null
    const raw = item.net_worth ?? item.value ?? item.y
    if (raw === null || raw === undefined || raw === '') return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }

  const pnlBarChartEl = ref(null)
  const returnTrendChartEl = ref(null)
  let pnlBarChart = null
  let returnTrendChart = null

  const form = reactive({
    code: '',
    name: '',
    purchaseDate: '',
    purchaseTime: '14:59',
    shares: null,
    cost: null
  })

  const operationForm = reactive({
    type: 'add',
    sourceId: '',
    targetCode: '',
    targetName: '',
    amount: null,
    date: today
  })
  const operationText = ref('')
  const operationLoading = ref(false)

  const currentNav = item => quoteMap.value[normalizeFundCode(item.code)]?.nav ?? item.cost
  const quoteTime = item => quoteMap.value[normalizeFundCode(item.code)]?.time || '--'

  const costAmount = item => Number(item.shares || 0) * Number(item.cost || 0)
  const marketAmount = item => Number(item.shares || 0) * Number(currentNav(item) || 0)
  const profit = item => marketAmount(item) - costAmount(item)
  const profitRate = item => (costAmount(item) === 0 ? 0 : (profit(item) / costAmount(item)) * 100)

  const totalCost = computed(() => positions.value.reduce((sum, item) => sum + costAmount(item), 0))
  const totalMarket = computed(() => positions.value.reduce((sum, item) => sum + marketAmount(item), 0))
  const totalProfit = computed(() => totalMarket.value - totalCost.value)
  const totalRate = computed(() => (totalCost.value === 0 ? 0 : (totalProfit.value / totalCost.value) * 100))

  const normalizeDate = raw => {
    if (!raw || typeof raw !== 'string') return ''
    return raw.split(' ')[0]
  }

  const findClosestNetWorth = (trend, targetDate) => {
    if (!Array.isArray(trend) || trend.length === 0 || !targetDate) return null
    const target = new Date(targetDate).setHours(0, 0, 0, 0)
    let best = null
    for (const item of trend) {
      const dateStr = normalizeDate(item.date)
      const nav = trendNav(item)
      if (!dateStr || nav === null) continue
      const ts = new Date(dateStr).setHours(0, 0, 0, 0)
      if (Number.isNaN(ts) || ts > target) continue
      if (!best || ts > best.ts) {
        best = { ts, date: dateStr, value: nav }
      }
    }
    return best
  }

  const findNavAtOrBeforeDate = (trend, dateStr) => {
    const matched = findClosestNetWorth(trend, dateStr)
    return matched ? matched.value : null
  }

  const getFundNavByRule = async (code, date, time = '15:00') => {
    const fundCode = normalizeFundCode(code)
    const isToday = date === today
    const isBeforeCutoff = time < '15:00'
    try {
      if (isToday && isBeforeCutoff) {
        const quote = await fetchRealtimeQuote(fundCode)
        if (quote?.nav) return quote.nav
      }
      const trend = await loadTrendByCode(fundCode)
      const match = findClosestNetWorth(trend, date)
      if (match) return Number(match.value)
    } catch (error) {
      console.error(`获取基金 ${code} 净值失败，尝试使用本地兜底净值:`, error)
    }
    const cachedQuote = quoteMap.value[fundCode]?.nav
    if (cachedQuote) return Number(cachedQuote)
    const existing = positions.value.find(item => normalizeFundCode(item.code) === fundCode)
    if (existing?.cost) return Number(existing.cost)
    return null
  }

  const findPositionById = id => positions.value.find(p => p.id === id)

  const handleOperationTypeChange = () => {
    operationText.value = ''
    if (operationForm.type !== 'convert') {
      operationForm.targetCode = ''
      operationForm.targetName = ''
    }
  }

  const loadTargetFundName = async () => {
    const code = normalizeFundCode(operationForm.targetCode)
    if (!/^\d{6}$/.test(code)) return
    operationForm.targetCode = code
    try {
      const response = await fundAPI.searchFunds(code)
      const list = fundSearchList(response)
      const exact = list.find(item => item.CODE === code) || list[0]
      if (exact) operationForm.targetName = exact.NAME || operationForm.targetName
    } catch (error) {
      console.error('查询目标基金失败:', error)
    }
  }

  const applyOperation = async () => {
    const source = findPositionById(operationForm.sourceId)
    if (!source) {
      operationText.value = '请选择需要操作的原基金。'
      return
    }
    const amount = Number(operationForm.amount || 0)
    if (amount <= 0) {
      operationText.value = '请输入有效金额。'
      return
    }
    try {
      operationLoading.value = true
      const sourceNav = await getFundNavByRule(source.code, operationForm.date, '21:00')
      if (!sourceNav) {
        operationText.value = '无法获取原基金净值，请稍后重试。'
        return
      }
      if (operationForm.type === 'add') {
        const addShares = amount / sourceNav
        const oldCost = source.cost * source.shares
        const newCost = oldCost + amount
        const newShares = source.shares + addShares
        source.shares = Number(newShares.toFixed(6))
        source.cost = Number((newCost / newShares).toFixed(6))
        source.purchaseDate = operationForm.date
        source.purchaseTime = '21:00'
        operationText.value = `加仓完成：增加 ${addShares.toFixed(2)} 份。`
      }
      if (operationForm.type === 'reduce') {
        const reduceShares = amount / sourceNav
        if (reduceShares >= source.shares) {
          operationText.value = '减仓金额过大，超过当前持有份额。'
          return
        }
        source.shares = Number((source.shares - reduceShares).toFixed(6))
        operationText.value = `减仓完成：减少 ${reduceShares.toFixed(2)} 份。`
      }
      if (operationForm.type === 'convert') {
        const targetCode = normalizeFundCode(operationForm.targetCode)
        operationForm.targetCode = targetCode
        if (!/^\d{6}$/.test(targetCode) || !operationForm.targetName) {
          operationText.value = '请填写有效的目标基金代码与名称。'
          return
        }
        const reduceShares = amount / sourceNav
        if (reduceShares > source.shares) {
          operationText.value = '转换金额过大，超过当前持有份额。'
          return
        }
        const targetNav = await getFundNavByRule(targetCode, operationForm.date, '21:00')
        if (!targetNav) {
          operationText.value = '无法获取目标基金净值。若要转换到新基金，请在晚间净值更新后再试；若目标基金已在持仓中，可先添加目标持仓后再转换。'
          return
        }
        source.shares = Number((source.shares - reduceShares).toFixed(6))
        if (source.shares <= 0.000001) {
          positions.value = positions.value.filter(item => item.id !== source.id)
        }
        const addShares = amount / targetNav
        const existingTarget = positions.value.find(item => normalizeFundCode(item.code) === targetCode)
        if (existingTarget) {
          const oldCost = existingTarget.cost * existingTarget.shares
          const newShares = existingTarget.shares + addShares
          const newCost = oldCost + amount
          existingTarget.shares = Number(newShares.toFixed(6))
          existingTarget.cost = Number((newCost / newShares).toFixed(6))
        } else {
          positions.value.unshift({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            code: targetCode,
            name: operationForm.targetName,
            purchaseDate: operationForm.date,
            purchaseTime: '21:00',
            shares: Number(addShares.toFixed(6)),
            cost: Number(targetNav.toFixed(6))
          })
        }
        operationText.value = `转换完成：卖出 ${source.code} 金额 ¥${amount.toFixed(2)}，买入 ${targetCode}。`
      }
      await Promise.all([refreshRealtimeQuotes(), loadHistoryForPositions()])
      syncToApi()
      renderCharts()
      if (operationForm.type !== 'convert') {
        operationForm.amount = null
      }
    } catch (error) {
      console.error('执行持仓变更失败:', error)
      operationText.value = '操作失败，请稍后重试。'
    } finally {
      operationLoading.value = false
    }
  }

  const loadFundNameByCode = async code => {
    const normalizedCode = normalizeFundCode(code)
    if (!/^\d{6}$/.test(normalizedCode)) {
      helperText.value = '请输入 6 位基金代码。'
      return
    }
    try {
      isAutoFilling.value = true
      const response = await fundAPI.searchFunds(normalizedCode)
      const list = fundSearchList(response)
      const exact = list.find(item => item.CODE === normalizedCode) || list[0]
      if (exact) {
        form.name = exact.NAME || form.name
        helperText.value = `已自动填充基金名称：${form.name}`
      } else {
        helperText.value = '未找到该基金代码对应名称，请检查后手动填写。'
      }
    } catch (error) {
      console.error('自动查询基金名称失败:', error)
      helperText.value = '自动查询基金名称失败，请稍后重试。'
    } finally {
      isAutoFilling.value = false
    }
  }

  const loadTrendByCode = async code => {
    const fundCode = normalizeFundCode(code)
    if (trendCache.has(fundCode)) return trendCache.get(fundCode)
    const response = await fundAPI.getFundTrend(fundCode)
    const trend = response?.data?.net_worth_trend || []
    trendCache.set(fundCode, trend)
    return trend
  }

  const fetchRealtimeQuote = async code => {
    const fundCode = normalizeFundCode(code)
    const fundStore = useFundStore()
    const data = await fundStore.fetchFund(fundCode)
    const realtime = data?.realtime_estimate || {}
    const estimate = Number(realtime.estimate_value)
    const official = Number(realtime.net_worth)
    const estimateDate = normalizeDate(realtime.estimate_time)
    const officialDate = normalizeDate(realtime.net_worth_date)
    const useOfficial = Number.isFinite(official) && officialDate && (!estimateDate || officialDate >= estimateDate)
    const nav = useOfficial ? official : estimate
    if (!Number.isFinite(nav)) return null
    return {
      nav,
      date: useOfficial ? officialDate : estimateDate,
      source: useOfficial ? 'official' : 'estimate',
      time: useOfficial ? (realtime.net_worth_date || '--') : (realtime.estimate_time || '--')
    }
  }

  const fillCostByDateRule = async () => {
    const code = normalizeFundCode(form.code)
    if (!/^\d{6}$/.test(code) || !form.purchaseDate || !form.purchaseTime) return
    form.code = code
    const isToday = form.purchaseDate === today
    const isBeforeCutoff = form.purchaseTime < '15:00'
    try {
      isAutoFilling.value = true
      if (isToday && !isBeforeCutoff) {
        form.cost = null
        helperText.value = '按交易规则：当日15:00后申购按下一交易日净值确认，当前无法自动确认成本净值，请次日补录或手动填写。'
        return
      }
      if (isToday && isBeforeCutoff) {
        const quote = await fetchRealtimeQuote(code)
        if (quote) {
          form.cost = quote.nav
          helperText.value = `按交易规则：当日15:00前申购按当日净值确认。当前以实时估值 ${quote.nav.toFixed(4)} 预填，待官方净值公布后可微调。`
          return
        }
      }
      const trend = await loadTrendByCode(code)
      const match = findClosestNetWorth(trend, form.purchaseDate)
      if (match) {
        form.cost = Number(match.value)
        helperText.value = `已根据 ${code} 在 ${match.date} 的净值自动填充成本净值：${Number(match.value).toFixed(4)}`
      } else {
        helperText.value = '未找到购买日及之前的净值数据，请手动填写成本净值。'
      }
    } catch (error) {
      console.error('自动填充购买净值失败:', error)
      helperText.value = '自动填充购买净值失败，请稍后重试。'
    } finally {
      isAutoFilling.value = false
    }
  }

  const refreshRealtimeQuotes = async () => {
    if (positions.value.length === 0) return
    const codes = [...new Set(positions.value.map(item => normalizeFundCode(item.code)).filter(Boolean))]
    try {
      const results = await Promise.allSettled(codes.map(code => fetchRealtimeQuote(code)))
      const nextMap = { ...quoteMap.value }
      results.forEach((result, index) => {
        const code = codes[index]
        if (result.status === 'fulfilled' && result.value) {
          nextMap[code] = result.value
        }
      })
      quoteMap.value = nextMap
      lastRefreshTime.value = new Date().toLocaleString('zh-CN')
    } catch (error) {
      console.error('刷新实时估值失败:', error)
    }
  }

  const loadHistoryForPositions = async () => {
    if (positions.value.length === 0) {
      historyMap.value = {}
      return
    }
    const codes = [...new Set(positions.value.map(item => normalizeFundCode(item.code)).filter(Boolean))]
    const results = await Promise.allSettled(codes.map(code => loadTrendByCode(code)))
    const next = {}
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        next[codes[index]] = result.value
      }
    })
    historyMap.value = next
  }

  const getHistoryDateSet = () => {
    const set = new Set()
    Object.values(historyMap.value).forEach(trend => {
      if (!Array.isArray(trend)) return
      trend.forEach(item => {
        const d = normalizeDate(item.date)
        if (d) set.add(d)
      })
    })
    return [...set].sort((a, b) => new Date(a) - new Date(b))
  }

  const buildPortfolioReturnSeries = () => {
    const dates = getHistoryDateSet()
    if (dates.length === 0 || positions.value.length === 0) return []
    const baseCost = totalCost.value
    if (baseCost <= 0) return []
    const rows = []
    for (const date of dates) {
      let market = 0
      let hasData = false
      for (const item of positions.value) {
        if (!item.purchaseDate || new Date(date) < new Date(item.purchaseDate)) continue
        const trend = historyMap.value[normalizeFundCode(item.code)] || []
        const nav = findNavAtOrBeforeDate(trend, date)
        if (nav !== null) {
          market += Number(item.shares || 0) * nav
          hasData = true
        }
      }
      if (!hasData) continue
      const rate = ((market - baseCost) / baseCost) * 100
      rows.push({ date, rate: Number(rate.toFixed(4)) })
    }
    return rows
  }

  const periodProfitSince = dateStr => {
    if (!dateStr) return totalProfit.value
    return positions.value.reduce((sum, item) => {
      const shares = Number(item.shares || 0)
      const current = Number(currentNav(item) || 0)
      if (shares <= 0 || current <= 0) return sum
      const purchasedAfterBase = item.purchaseDate && new Date(item.purchaseDate) > new Date(dateStr)
      if (purchasedAfterBase) {
        return sum + shares * (current - Number(item.cost || 0))
      }
      const trend = historyMap.value[normalizeFundCode(item.code)] || []
      const baseNav = findNavAtOrBeforeDate(trend, dateStr)
      if (baseNav === null) return sum
      return sum + shares * (current - baseNav)
    }, 0)
  }

  const getLastTradingDateBefore = dateStr => {
    const dates = getHistoryDateSet().filter(d => d < dateStr)
    return dates.length ? dates[dates.length - 1] : null
  }

  const calendarPnl = computed(() => {
    if (positions.value.length === 0) return { day: 0, month: 0, year: 0 }
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    const monthStart = `${todayStr.slice(0, 8)}01`
    const yearStart = `${todayStr.slice(0, 4)}-01-01`
    const prevDay = getLastTradingDateBefore(todayStr)
    const prevMonth = getLastTradingDateBefore(monthStart)
    const prevYear = getLastTradingDateBefore(yearStart)
    return {
      day: prevDay ? periodProfitSince(prevDay) : totalProfit.value,
      month: prevMonth ? periodProfitSince(prevMonth) : totalProfit.value,
      year: prevYear ? periodProfitSince(prevYear) : totalProfit.value
    }
  })

  const renderPnlBarChart = () => {
    if (!pnlBarChartEl.value || positions.value.length === 0) return
    if (!pnlBarChart) pnlBarChart = echarts.init(pnlBarChartEl.value, echartThemeName.value)
    const successColor = cssColor('--color-success', '#52c41a')
    const dangerColor = cssColor('--color-danger', '#ff4d4f')
    const labels = positions.value.map(item => `${item.name || item.code}(${item.code})`)
    const values = positions.value.map(item => Number(profit(item).toFixed(2)))
    pnlBarChart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: '4%', right: '4%', top: '12%', bottom: '12%', containLabel: true },
      xAxis: { type: 'category', data: labels, axisLabel: { rotate: 20 } },
      yAxis: { type: 'value', name: '盈亏(元)' },
      series: [{
        type: 'bar',
        data: values,
        itemStyle: { color: params => (params.value >= 0 ? successColor : dangerColor) }
      }]
    })
  }

  const renderReturnTrendChart = () => {
    if (!returnTrendChartEl.value || positions.value.length === 0) return
    if (!returnTrendChart) returnTrendChart = echarts.init(returnTrendChartEl.value, echartThemeName.value)
    const primaryColor = cssColor('--color-primary', '#1677ff')
    const seriesData = buildPortfolioReturnSeries()
    returnTrendChart.setOption({
      tooltip: { trigger: 'axis', valueFormatter: value => `${Number(value).toFixed(2)}%` },
      grid: { left: '4%', right: '4%', top: '12%', bottom: '12%', containLabel: true },
      xAxis: { type: 'category', data: seriesData.map(i => i.date) },
      yAxis: { type: 'value', name: '持有收益率(%)' },
      series: [{
        name: '持有收益率',
        type: 'line',
        smooth: true,
        data: seriesData.map(i => i.rate),
        lineStyle: { width: 2, color: primaryColor },
        areaStyle: { color: primaryColor + '26' }
      }]
    })
  }

  const renderCharts = async () => {
    await nextTick()
    if (positions.value.length === 0) {
      if (pnlBarChart) { pnlBarChart.dispose(); pnlBarChart = null }
      if (returnTrendChart) { returnTrendChart.dispose(); returnTrendChart = null }
      return
    }
    renderPnlBarChart()
    renderReturnTrendChart()
  }

  const startRefreshTimer = () => {
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = setInterval(async () => {
      await refreshRealtimeQuotes()
      renderCharts()
    }, 60000)
  }

  const handleCodeBlur = async () => {
    await loadFundNameByCode(form.code)
    if (form.purchaseDate && form.purchaseTime) {
      await fillCostByDateRule()
    }
  }

  const handleDateChange = async () => {
    if (!form.name && form.code) {
      await loadFundNameByCode(form.code)
    }
    await fillCostByDateRule()
  }

  const resetForm = () => {
    form.code = ''
    form.name = ''
    form.purchaseDate = ''
    form.purchaseTime = '14:59'
    form.shares = null
    form.cost = null
    helperText.value = ''
  }

  const addPosition = async () => {
    const code = normalizeFundCode(form.code)
    const newPos = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      code,
      name: form.name,
      purchaseDate: form.purchaseDate,
      purchaseTime: form.purchaseTime,
      shares: Number(form.shares),
      cost: Number(form.cost)
    }
    positions.value.unshift(newPos)
    resetForm()
    portfolioAPI.addPosition({
      fund_code: code, fund_name: form.name || '',
      purchase_date: form.purchaseDate || '', purchase_time: form.purchaseTime || '',
      shares: Number(form.shares) || 0, cost: Number(form.cost) || 0,
    }).catch(() => {})
    await refreshRealtimeQuotes()
    await loadHistoryForPositions()
    renderCharts()
  }

  const syncToApi = async () => {
    portfolioAPI.clearPositions().catch(() => {})
    for (const p of positions.value) {
      await portfolioAPI.addPosition({
        fund_code: p.code, fund_name: p.name || '',
        purchase_date: p.purchaseDate || '', purchase_time: p.purchaseTime || '',
        shares: p.shares || 0, cost: p.cost || 0,
      })
    }
  }

  const removePosition = async id => {
    positions.value = positions.value.filter(item => item.id !== id)
    portfolioAPI.deletePosition(id).catch(() => {})
    await loadHistoryForPositions()
    renderCharts()
  }

  const formatNumber = (value, digit = 2) => Number(value || 0).toFixed(digit)
  const formatSigned = value => `${value >= 0 ? '+' : ''}${formatNumber(value, 2)}`

  useDebouncedWatch([quoteMap, historyMap], () => renderCharts(), 300, { deep: true })

  watch(echartThemeName, () => {
    if (pnlBarChart) { pnlBarChart.dispose(); pnlBarChart = null }
    if (returnTrendChart) { returnTrendChart.dispose(); returnTrendChart = null }
    renderCharts()
  })

  onMounted(async () => {
    try {
      const res = await portfolioAPI.getPositions()
      const data = res?.data
      if (Array.isArray(data)) {
        positions.value = data.map(p => ({
          id: p.id, code: p.fund_code, name: p.fund_name,
          purchaseDate: p.purchase_date, purchaseTime: p.purchase_time,
          shares: p.shares || 0, cost: p.cost || 0,
        }))
      }
    } catch (e) { console.error('加载持仓失败', e) }
    await Promise.all([refreshRealtimeQuotes(), loadHistoryForPositions()])
    renderCharts()
    startRefreshTimer()
    window.addEventListener('resize', renderCharts)
  })

  onUnmounted(() => {
    if (refreshTimer) clearInterval(refreshTimer)
    if (pnlBarChart) pnlBarChart.dispose()
    if (returnTrendChart) returnTrendChart.dispose()
    window.removeEventListener('resize', renderCharts)
  })

  return {
    today,
    positions,
    form,
    operationForm,
    helperText,
    isAutoFilling,
    operationText,
    operationLoading,
    pnlBarChartEl,
    returnTrendChartEl,
    quoteMap,
    historyMap,
    lastRefreshTime,
    totalCost,
    totalMarket,
    totalProfit,
    totalRate,
    calendarPnl,
    currentNav,
    quoteTime,
    costAmount,
    marketAmount,
    profit,
    profitRate,
    formatNumber,
    formatSigned,
    handleCodeBlur,
    handleDateChange,
    addPosition,
    removePosition,
    handleOperationTypeChange,
    loadTargetFundName,
    applyOperation
  }
}
