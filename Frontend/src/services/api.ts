import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'

const API_BASE_URL: string = '/api'

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 600000,
})

const FALLBACK_API_BASE = import.meta.env.VITE_FALLBACK_API_BASE || 'http://localhost:5000/api'

const localBackendApi: AxiosInstance = axios.create({
  baseURL: FALLBACK_API_BASE,
  timeout: 600000,
})

interface ApiResponse<T = unknown> {
  data: T
  success?: boolean
  meta?: Record<string, unknown>
}

async function getWithLocalFallback<T = unknown>(path: string, config: AxiosRequestConfig = {}): Promise<ApiResponse<T>> {
  try {
    return await api.get(path, config)
  } catch (error: unknown) {
    const axiosError = error as { message?: string }
    if (axiosError?.message === 'Network Error' && API_BASE_URL === '/api') {
      return localBackendApi.get(path, config)
    }
    throw error
  }
}

export const fundAPI = {
  searchFunds(keyword: string) { return api.get(`/fund/search?q=${encodeURIComponent(keyword)}`) },
  getSearchStatus() { return api.get('/fund/search/status') },
  updateSearchDatabase() { return api.post('/fund/search/update') },
  getFundDetail(fundCode: string) { return api.get(`/fund/${fundCode}`) },
  getFundIndustryExposure(fundCode: string, refresh = false) {
    return api.get(`/fund/${fundCode}/industry-exposure`, { params: refresh ? { refresh: true } : {} })
  },
  getFundBasicInfo(fundCode: string) { return api.get(`/fund/${fundCode}/basic`) },
  getFundTrend(fundCode: string) { return api.get(`/fund/${fundCode}/trend`) },
  getFundCompareData(fundCode: string, forceRefresh = false) {
    return api.get(`/fund/${fundCode}/compare-data${forceRefresh ? '?refresh=true' : ''}`)
  },
  getDailyMarket(forceRefresh = false) {
    return api.get(`/market/daily${forceRefresh ? '?refresh=true' : ''}`)
  },
  analyzeFund(fundCode: string) { return api.get(`/fund/${fundCode}/analyze`) },
}

export const watchlistAPI = {
  getWatchlist() { return api.get('/watchlist') },
  checkInWatchlist(fundCode: string) { return api.get(`/watchlist/${fundCode}`) },
  addToWatchlist(fundCode: string, fundName: string, fundType = '', groupId: number | null = null, estimate?: any) {
    return api.post('/watchlist', { fund_code: fundCode, fund_name: fundName, fund_type: fundType, group_id: groupId, estimate })
  },
  removeFromWatchlist(fundCode: string) { return api.delete(`/watchlist/${fundCode}`) },
  batchDelete(fundCodes: string[]) { return api.post('/watchlist/batch-delete', { fund_codes: fundCodes }) },
  reorder(fundCodeOrder: string[], groupId: number | null = null) {
    return api.put('/watchlist/reorder', { order: fundCodeOrder, group_id: groupId })
  },
  moveFundToGroup(fundCode: string, groupId: number | null) {
    return api.put('/watchlist/move', { fund_code: fundCode, group_id: groupId })
  },
  getGroups() { return api.get('/watchlist/groups') },
  createGroup(name: string) { return api.post('/watchlist/groups', { name }) },
  renameGroup(groupId: number, name: string) { return api.put(`/watchlist/groups/${groupId}`, { name }) },
  deleteGroup(groupId: number) { return api.delete(`/watchlist/groups/${groupId}`) },
  reorderGroups(groupIdOrder: number[]) { return api.put('/watchlist/groups/reorder', { order: groupIdOrder }) },
  refreshEstimates() { return api.post('/watchlist/refresh-estimates') },
}

export const screeningAPI = {
  getStatus() { return api.get('/screening/status') },
  getProgress() { return api.get('/screening/progress') },
  startUpdate(options: Record<string, unknown> = {}) { return api.post('/screening/update', options) },
  stopUpdate() { return api.post('/screening/stop') },
  query(params: Record<string, unknown>) { return api.post('/screening/query', params) },
  getStrategies() { return api.get('/screening/strategies') },
  getAvailableTypes(params: Record<string, unknown>) { return api.post('/screening/available-types', params) },
  getIndustryTags() { return api.get('/screening/industry-tags') },
  getStockIndustryStatus() { return api.get('/screening/stock-industry/status') },
  warmupStockIndustry(params: Record<string, unknown> = {}) { return api.post('/screening/stock-industry/warmup', params) },
  getFundDetail(fundCode: string) { return api.get(`/screening/fund/${fundCode}`) },
  fillRiskMetrics() { return api.post('/screening/fill-risk') },
  updateSingleFund(fundCode: string) { return api.post(`/screening/update-single/${fundCode}`) },
  recalculateRankings() { return api.post('/screening/recalculate-rankings') },
}

export const backtestAPI = {
  fixedInvestment(data: Record<string, unknown>) { return api.post('/backtest/fixed-investment', data) },
  strategySuggest(data: { fund_code: string }) { return api.post('/backtest/strategy-suggest', data) },
}

export const marketAPI = {
  getOverview() { return api.get('/market/overview') },
  getFlashNews(count = 30, page = 1) { return api.get(`/market/news?count=${count}&page=${page}`) },
  getSectorRank(limit = 90) { return api.get(`/market/sectors?limit=${limit}`) },
  getMarketIndex() { return api.get('/market/index') },
  getGoldRealtime() { return api.get('/market/gold/realtime') },
  getGoldHistory(days = 10) { return api.get(`/market/gold/history?days=${days}`) },
  getSilverHistory(days = 10) { return api.get(`/market/silver/history?days=${days}`) },
  getVolumeWeekly() { return api.get('/market/volume') },
  getSSE30min() { return api.get('/market/sse') },
  getIndicesIntraday() { return api.get('/market/indices/intraday') },
  getStockQuote(code: string) { return api.get(`/stock/${code}/quote`) },
  getStockKline(code: string, params: Record<string, unknown> = {}) { return api.get(`/stock/${code}/kline`, { params }) },
  getIndexDetail(code: string) { return api.get(`/market/index/${code}/detail`) },
  getIndexKline(code: string, params: Record<string, unknown> = {}) { return api.get(`/market/index/${code}/kline`, { params }) },
}

export const researchAPI = {
  getDashboard(params: Record<string, unknown> = {}) { return getWithLocalFallback('/research/dashboard', { params }) },
  getMarketStats() { return getWithLocalFallback('/research/market-stats') },
  getFundDashboard(limit = 5) { return getWithLocalFallback('/research/fund-dashboard', { params: { limit } }) },
  getEtfTracking(limit = 80, refresh = false) { return getWithLocalFallback('/research/etf-tracking', { params: { limit, refresh } }) },
  getIndustryPerformance() { return getWithLocalFallback('/research/industry-performance') },
  rebuildIndustryPerformance() { return api.post('/research/rebuild-industry-performance') },
  getSectorSummary(limit = 50) { return getWithLocalFallback('/research/sector-summary', { params: { limit } }) },
}

export const alertAPI = {
  list() { return api.get('/alerts') },
  create(data: { fund_code: string; alert_type: string; threshold: number }) { return api.post('/alerts', data) },
  update(id: number, data: { threshold?: number; enabled?: number }) { return api.put(`/alerts/${id}`, data) },
  remove(id: number) { return api.delete(`/alerts/${id}`) },
  check() { return api.get('/alerts/check') },
  marketAnomaly() { return api.get('/alerts/market-anomaly') },
}

export const anomalyConfigAPI = {
  get() { return api.get('/alerts/anomaly-config') },
  update(data: Record<string, number>) { return api.put('/alerts/anomaly-config', data) },
  getDefaults() { return api.get('/alerts/anomaly-config/defaults') },
}

export default api
