// @ts-nocheck
import Decimal from 'decimal.js'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { screeningAPI, researchAPI } from '../services/api'
import { fmtPercent, fmtNumber, fmtAmountYi } from '../utils/number'



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
      // 聚合在 service（P3.4）—— 与 pi 的 get_research_dashboard 工具同源。
      const res = await researchAPI.getDashboard({ limit: 5, etf_limit: 80 })
      const body = res.data as { data?: Record<string, unknown> } | undefined
      dashboard.value = body?.data ?? {}
      industryTaskStatus.value = { running: false, status: 'idle', message: '' }
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

  const pollIndustryPerformance = () => { /* placeholder kept for API compat */ }

  const refreshDashboard = async () => {
    loading.value = true
    error.value = ''
    try {
      await loadDashboard()
    } catch (err) {
      error.value = err?.response?.data?.error || err?.message || '板块行情刷新失败'
    } finally {
      loading.value = false
    }
  }

  const marketStats = computed(() => dashboard.value.market_stats || {})
  // 4433 / 风险指标口径都由 service（core）算好，页面直接展示 —— 不再本地重算。
  const summary = computed(() => marketStats.value.summary || {})
  const typeStats = computed(() => marketStats.value.type_stats || [])

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
