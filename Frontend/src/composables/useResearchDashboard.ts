// @ts-nocheck
import Decimal from 'decimal.js'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { researchAPI, screeningAPI } from '../services/api'
import { fmtPercent, fmtNumber, fmtAmountYi } from '../utils/number'

function check4433Rule(ranks: {
  rank_pct_1y: number | null
  rank_pct_2y: number | null
  rank_pct_3y: number | null
  rank_pct_6m: number | null
  rank_pct_3m: number | null
}): boolean {
  if (ranks.rank_pct_1y == null || ranks.rank_pct_1y > 25) return false
  const longTermPass = (ranks.rank_pct_2y != null && ranks.rank_pct_2y <= 25) ||
    (ranks.rank_pct_3y != null && ranks.rank_pct_3y <= 25)
  if (!longTermPass) return false
  if (ranks.rank_pct_6m == null || ranks.rank_pct_6m > 33.33) return false
  if (ranks.rank_pct_3m == null || ranks.rank_pct_3m > 33.33) return false
  return true
}

function compute4433FromItems(items: any[]): {
  totalPass: number
  passByType: Map<string, number>
} {
  const groups = new Map<string, any[]>()
  for (const fund of items) {
    const type = fund.fund_type || '(untyped)'
    if (!groups.has(type)) groups.set(type, [])
    groups.get(type)!.push(fund)
  }

  const passByType = new Map<string, number>()
  let totalPass = 0

  for (const [type, funds] of groups) {
    if (funds.length < 3) {
      passByType.set(type, 0)
      continue
    }

    const periods = ['1m', '3m', '6m', '1y', '2y', '3y'] as const
    const getReturn = (f: any, p: string) => {
      switch (p) {
        case '1m': return f.return_1m
        case '3m': return f.return_3m
        case '6m': return f.return_6m
        case '1y': return f.return_1y
        case '2y': return f.return_2y
        case '3y': return f.return_3y
        default: return null
      }
    }

    for (const period of periods) {
      const withReturn = funds
        .map((f: any, i: number) => ({ fund: f, ret: getReturn(f, period), idx: i }))
        .filter((x: any) => x.ret !== null && Number.isFinite(x.ret))
      if (withReturn.length < 3) continue
      withReturn.sort((a: any, b: any) => b.ret - a.ret)
      const total = withReturn.length
      for (let i = 0; i < total; i++) {
        withReturn[i].fund[`rank_pct_${period}`] = (i / total) * 100
      }
    }

    let passCount = 0
    for (const f of funds) {
      if (check4433Rule({
        rank_pct_1y: f.rank_pct_1y,
        rank_pct_2y: f.rank_pct_2y,
        rank_pct_3y: f.rank_pct_3y,
        rank_pct_6m: f.rank_pct_6m,
        rank_pct_3m: f.rank_pct_3m,
      })) passCount++
    }
    passByType.set(type, passCount)
    totalPass += passCount
  }

  return { totalPass, passByType }
}

export function useResearchDashboard(emit: (event: string, ...args: any[]) => void) {
  const loading = ref(false)
  const error = ref('')
  const activeTab = ref('market')
  const dashboard = ref({})
  const updatedAt = ref('')
  const industryTaskStatus = ref({})
  let industryPollTimer = null
  const showToast = ref(false)
  const toastMessage = ref('')
  const enrichmentFilled = ref(false)
  let toastTimer = null

  const showToastNotification = (message, duration = 4000) => {
    toastMessage.value = message
    showToast.value = true
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      showToast.value = false
    }, duration)
  }

  const tabs = [
    { key: 'market', label: '基金市场统计' },
    { key: 'funds', label: '基金看板' },
    { key: 'etf', label: 'ETF 每日跟踪' },
    { key: 'sectors', label: '板块行情' }
  ]

  const loadDashboard = async () => {
    loading.value = true
    error.value = ''
    try {
      const res = await researchAPI.getDashboard({ limit: 5, etf_limit: 80 })
      dashboard.value = res.data?.data || res.data || {}
      industryTaskStatus.value = dashboard.value.industry_performance_task || dashboard.value.industry_performance?.task_status || {}
      if (!dashboard.value.industry_performance || !(dashboard.value.industry_performance.items || []).length) {
        try {
          const industryRes = await researchAPI.getIndustryPerformance()
          const industryData = industryRes.data?.data || industryRes.data || {}
          dashboard.value = {
            ...dashboard.value,
            industry_performance: industryData
          }
          industryTaskStatus.value = industryData.task_status || industryTaskStatus.value
        } catch (industryErr) {
          console.warn('行业表现加载失败:', industryErr)
        }
      }
      updatedAt.value = dashboard.value.updated_at || ''

      const enrichment = dashboard.value.market_stats?.enrichment_summary
      if (enrichment?.missing > 0 && !enrichmentFilled.value) {
        enrichmentFilled.value = true
        screeningAPI.startUpdate().catch(() => {})
      }
    } catch (err) {
      error.value = err?.response?.data?.error || err?.message || '投研数据加载失败'
    } finally {
      loading.value = false
    }
  }

  const pollIndustryPerformance = () => {
    if (industryPollTimer) return
    industryPollTimer = setInterval(async () => {
      try {
        const res = await researchAPI.getIndustryPerformance()
        const industryData = res.data?.data || res.data || {}
        dashboard.value = {
          ...dashboard.value,
          industry_performance: industryData
        }
        industryTaskStatus.value = industryData.task_status || {}
        if (!industryTaskStatus.value.running) {
          clearInterval(industryPollTimer)
          industryPollTimer = null
          await loadDashboard()
          const itemCount = industryData.items?.length || industryData.summary?.total || 0
          showToastNotification(`板块行情汇总完成，共 ${itemCount} 个板块`)
        }
      } catch (err) {
        console.warn('板块行情后台刷新状态获取失败:', err)
      }
    }, 3000)
  }

  const refreshDashboard = async () => {
    if (activeTab.value !== 'sectors') {
      await loadDashboard()
      return
    }
    loading.value = true
    error.value = ''
    try {
      const res = await researchAPI.rebuildIndustryPerformance()
      const rebuildData = res.data?.data || res.data || {}
      industryTaskStatus.value = rebuildData.task_status || { running: true, message: '后台汇总板块行情...' }
      dashboard.value = {
        ...dashboard.value,
        industry_performance: rebuildData.data || dashboard.value.industry_performance || {}
      }
      pollIndustryPerformance()
    } catch (err) {
      error.value = err?.response?.data?.error || err?.message || '板块行情刷新启动失败'
    } finally {
      loading.value = false
    }
  }

  const marketStats = computed(() => dashboard.value.market_stats || {})
  const items = computed(() => marketStats.value.items || [])

  const computed4433 = computed(() => {
    const rawItems = items.value
    if (!rawItems.length) return { totalPass: 0, passByType: new Map<string, number>() }
    return compute4433FromItems(rawItems)
  })

  const summary = computed(() => {
    const s = marketStats.value.summary || {}
    const rawItems = items.value
    if (!rawItems.length) {
      return { ...s, risk_ready: 0, risk_ready_rate: 0, pass_4433: 0, pass_4433_rate: 0 }
    }
    const { totalPass } = computed4433.value
    const riskReady = rawItems.filter((i: any) => i.sharpe_ratio_1y != null).length
    return {
      ...s,
      pass_4433: totalPass,
      pass_4433_rate: Math.round((totalPass / rawItems.length) * 10000) / 100,
      risk_ready: riskReady,
      risk_ready_rate: Math.round((riskReady / rawItems.length) * 10000) / 100,
    }
  })

  const typeStats = computed(() => {
    const rawItems = items.value
    const backendStats: any[] = marketStats.value.type_stats || []
    if (!rawItems.length) return backendStats
    const { passByType } = computed4433.value
    return backendStats.map((st: any) => ({
      ...st,
      pass_4433: passByType.get(st.fund_type) || 0,
      pass_rate: st.count ? Math.round(((passByType.get(st.fund_type) || 0) / st.count) * 10000) / 100 : 0,
    }))
  })

  const groupStats = computed(() => marketStats.value.group_stats || [])
  const fundCards = computed(() => dashboard.value.fund_dashboard?.cards || [])
  const etfTracking = computed(() => dashboard.value.etf_tracking || {})
  const etfSummary = computed(() => etfTracking.value.summary || {})
  const etfCategories = computed(() => etfTracking.value.categories || [])
  const etfItems = computed(() => etfTracking.value.items || [])
  const industryPerformance = computed(() => dashboard.value.industry_performance || {})
  const industryStats = computed(() => industryPerformance.value.summary || {})
  const industryItems = computed(() => industryPerformance.value.items || [])
  const industryTop3m = computed(() => industryPerformance.value.top_3m || [])
  const industryTop1y = computed(() => industryPerformance.value.top_1y || [])

  const enrichmentSummary = computed(() => marketStats.value.enrichment_summary || {})

  const formatPercent = (value: any) => fmtPercent(value)

  const formatNumber = (value: any) => fmtNumber(value, 2)

  const displayFundName = (name: string, maxLength = 10) => {
    const text = String(name || '')
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
  }

  const formatDateTime = (value: string) => {
    if (!value) return ''
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
  }

  const formatAmountYi = (value: any) => fmtAmountYi(value)

  const returnClass = (value: any) => {
    const num = Number(value)
    if (!Number.isFinite(num)) return ''
    return num > 0 ? 'up' : num < 0 ? 'down' : ''
  }

  const viewFund = (fund: any) => {
    if (fund?.fund_code) emit('view-fund', fund.fund_code)
  }

  onMounted(loadDashboard)
  onUnmounted(() => {
    if (industryPollTimer) clearInterval(industryPollTimer)
  })

  return {
    loading,
    error,
    activeTab,
    tabs,
    updatedAt,
    summary,
    typeStats,
    groupStats,
    fundCards,
    etfSummary,
    etfCategories,
    etfItems,
    industryStats,
    industryItems,
    industryTop3m,
    industryTop1y,
    enrichmentSummary,
    industryTaskStatus,
    showToast,
    toastMessage,
    showToastNotification,
    loadDashboard,
    refreshDashboard,
    formatPercent,
    formatNumber,
    formatAmountYi,
    displayFundName,
    formatDateTime,
    returnClass,
    viewFund
  }
}
