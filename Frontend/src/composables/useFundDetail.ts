// @ts-nocheck
import { ref, watch, computed } from 'vue'
import { fundAPI, marketAPI } from '../services/api'
import { portfolioAPI } from '../services/portfolioApi'
import { useFundStore } from '../stores/fundStore'
import {
  calcMaxDrawdown, calcDailyReturns, calcAnnualReturn,
  calcVolatility, calcSharpe
} from '../utils/number'

export function useFundDetail(props: any, emit: any) {
  const currentFundCode = ref(props.fundCode)
  const fundDetail: any = ref(null)
  const loading = ref(false)
  const error = ref('')
  const modalVisible = ref(false)
  const modalType = ref('')
  const fundAIAnalysisRef: any = ref(null)
  const showAIAnalysis = ref(false)
  const aiAnalysisData: any = ref(null)
  const tradeRecords: any = ref([])
  const stockModalVisible = ref(false)
  const stockQuoteLoading = ref(false)
  const stockQuoteData: any = ref(null)
  const stockQuoteError = ref('')

  const handleStockClick = async (stock: any) => {
    if (!stock || !stock.code) return
    stockQuoteLoading.value = true
    stockQuoteError.value = ''
    stockQuoteData.value = null
    stockModalVisible.value = true
    document.body.style.overflow = 'hidden'
    try {
      const response = await marketAPI.getStockQuote(stock.code)
      if (response.data?.success && response.data?.data) {
        stockQuoteData.value = response.data.data
      } else {
        stockQuoteError.value = response.data?.error || '获取行情数据失败'
      }
    } catch (err: any) {
      console.error('获取个股行情失败:', err)
      stockQuoteError.value = err.response?.data?.error || '网络请求失败，请稍后重试'
    } finally {
      stockQuoteLoading.value = false
    }
  }

  const closeStockModal = () => {
    stockModalVisible.value = false
    stockQuoteData.value = null
    stockQuoteLoading.value = false
    stockQuoteError.value = ''
    document.body.style.overflow = ''
  }

  const handleSameTypeFundSelect = (fundCode: string) => {
    if (!fundCode) return
    closeModal()
    emit('navigate-to-fund', fundCode)
  }

  const handleStartAIAnalysis = () => {
    showAIAnalysis.value = true
    setTimeout(() => {
      if (fundAIAnalysisRef.value) fundAIAnalysisRef.value.analyze()
    }, 0)
  }

  const handleAnalysisComplete = (data: any) => { aiAnalysisData.value = data }

  const riskMetrics = computed(() => {
    if (!fundDetail.value?.net_worth_trend) return null
    try {
      const sortedData = [...fundDetail.value.net_worth_trend].sort(
        (a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()
      )
      const values = sortedData.map((item: any) => parseFloat(item.net_worth)).filter((v: any) => !isNaN(v))
      const dates = sortedData.map((item: any) => item.date)
      if (values.length < 30) return null
      const now = new Date()

      const getDataForPeriod = (months: number) => {
        const cutoffDate = new Date(now)
        cutoffDate.setMonth(cutoffDate.getMonth() - months)
        const cutoffStr = cutoffDate.toISOString().split('T')[0]
        const periodValues = []
        for (let i = 0; i < dates.length; i++) {
          if (dates[i] >= cutoffStr) periodValues.push(values[i])
        }
        return periodValues
      }

      const values1y = getDataForPeriod(12)
      const maxDrawdown1y = calcMaxDrawdown(values1y)
      const dailyReturns1y = calcDailyReturns(values1y)
      const annualReturn1y = values1y.length >= 2
        ? calcAnnualReturn(values1y[0], values1y[values1y.length - 1], values1y.length)
        : null
      const volatility1y = calcVolatility(dailyReturns1y)
      const sharpe1y = calcSharpe(annualReturn1y, volatility1y)

      const values3y = getDataForPeriod(36)
      const maxDrawdown3y = calcMaxDrawdown(values3y)
      const dailyReturns3y = calcDailyReturns(values3y)
      const annualReturn3y = values3y.length >= 2
        ? calcAnnualReturn(values3y[0], values3y[values3y.length - 1], values3y.length)
        : null
      const volatility3y = calcVolatility(dailyReturns3y)
      const sharpe3y = calcSharpe(annualReturn3y, volatility3y)

      return {
        sharpe_ratio_1y: sharpe1y, sharpe_ratio_3y: sharpe3y,
        max_drawdown_1y: maxDrawdown1y, max_drawdown_3y: maxDrawdown3y,
        volatility_1y: volatility1y, volatility_3y: volatility3y,
        annual_return_1y: annualReturn1y, annual_return_3y: annualReturn3y
      }
    } catch (e) {
      console.error('计算风险指标错误:', e)
      return null
    }
  })

  const openModal = (type: string) => {
    modalType.value = type
    modalVisible.value = true
    document.body.style.overflow = 'hidden'
  }

  const closeModal = () => {
    modalVisible.value = false
    modalType.value = ''
    document.body.style.overflow = ''
  }

  const processedNetWorthTrend = computed(() => {
    if (!fundDetail.value?.net_worth_trend) return []
    try {
      const trend = fundDetail.value.net_worth_trend
      if (Array.isArray(trend) && trend.length > 0) {
        if (trend[0].date && trend[0].net_worth !== undefined) {
          return trend.map((item: any) => {
            const ts = new Date(item.date).getTime()
            if (isNaN(ts)) return null
            const val = parseFloat(item.net_worth)
            if (isNaN(val)) return null
            return { x: ts, y: val }
          }).filter(item => item !== null)
        }
        if (trend[0].x && trend[0].y !== undefined) {
          return trend
            .filter((item: any) => typeof item.x === 'number' && !isNaN(item.x) && !isNaN(parseFloat(item.y)))
            .map((item: any) => ({ x: item.x, y: parseFloat(item.y) || 0 }))
        }
        if (Array.isArray(trend[0]) && trend[0].length >= 2) {
          return trend
            .filter((item: any) => !isNaN(item[0]) && !isNaN(parseFloat(item[1])))
            .map((item: any) => ({ x: item[0], y: parseFloat(item[1]) || 0 }))
        }
      }
      return []
    } catch (e) {
      console.error('处理净值走势数据错误:', e)
      return []
    }
  })

  const processedAcWorthTrend = computed(() => {
    if (!fundDetail.value?.accumulated_net_worth) return []
    try {
      const trend = fundDetail.value.accumulated_net_worth
      if (Array.isArray(trend) && trend.length > 0) {
        if (trend[0].date !== undefined) {
          return trend
            .filter((item: any) => {
              const ts = new Date(item.date).getTime()
              return !isNaN(ts) && !isNaN(parseFloat(item.position_percentage))
            })
            .map((item: any) => [new Date(item.date).getTime(), parseFloat(item.position_percentage) || 0])
        }
        return trend
          .filter((item: any) => Array.isArray(item) && item.length >= 2 && !isNaN(item[0]) && !isNaN(parseFloat(item[1])))
          .map((item: any) => [item[0], parseFloat(item[1]) || 0])
      }
      return []
    } catch (e) {
      console.error('处理累计净值数据错误:', e)
      return []
    }
  })

  const fundStore = useFundStore()

  const fetchFundDetail = async (fundCode: string) => {
    if (!fundCode) { fundDetail.value = null; return }
    loading.value = true
    error.value = ''
    try {
      const [data] = await Promise.all([
        fundStore.fetchFund(fundCode),
        fetchTradeRecords(fundCode),
      ])
      fundDetail.value = data
    } catch (err: any) {
      console.error('获取基金详情失败:', err)
      error.value = err.response?.data?.error || '获取基金详情失败，请检查基金代码是否正确'
      fundDetail.value = null
    } finally {
      loading.value = false
    }
  }

  const fetchTradeRecords = async (fundCode: string) => {
    if (!fundCode) { tradeRecords.value = []; return }
    try {
      const response = await portfolioAPI.getTrades(fundCode)
      const data = response?.data
      if (Array.isArray(data)) {
        tradeRecords.value = data.map(r => ({
          id: r.id,
          fundCode: r.fund_code,
          fundName: r.fund_name || r.fund_code,
          type: r.type,
          tradeDate: r.trade_date || '',
          amount: r.amount || 0,
          share: r.share || 0,
          nav: r.nav || 0,
          status: r.status || 'settled',
          createdAt: r.created_at || '',
          settledAt: r.settled_at || '',
        }))
        return
      }
      tradeRecords.value = []
    } catch {
      tradeRecords.value = []
    }
  }

  const retry = () => {
    if (currentFundCode.value) fetchFundDetail(currentFundCode.value)
  }

  watch(() => props.fundCode, (newCode) => {
    currentFundCode.value = newCode
    if (newCode) { fetchFundDetail(newCode) }
    else { fundDetail.value = null; loading.value = false; error.value = '' }
  }, { immediate: true })

  return {
    currentFundCode, fundDetail, loading, error, showAIAnalysis,
    fundAIAnalysisRef, aiAnalysisData, riskMetrics, tradeRecords,
    processedNetWorthTrend, processedAcWorthTrend,
    modalVisible, modalType, openModal, closeModal,
    stockModalVisible, stockQuoteLoading, stockQuoteData, stockQuoteError,
    handleStockClick, closeStockModal,
    handleSameTypeFundSelect, handleStartAIAnalysis, handleAnalysisComplete,
    retry
  }
}
