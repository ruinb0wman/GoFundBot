// @ts-nocheck
import Decimal from 'decimal.js'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { researchAPI } from '../services/api'
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
