import { httpRequest, isTauriRuntime, type HttpResponse } from './httpClient'

const FALLBACK_API_BASE: string =
  import.meta.env.VITE_FALLBACK_API_BASE || 'http://localhost:8310/api'

interface QueryArgs {
  params?: Record<string, unknown>
  timeoutMs?: number
}

/**
 * Axios-like request helper. Resolves path via httpClient (Tauri → absolute
 * localhost:8310, Web → `/api` Vite proxy), and retries once against
 * `localhost:8310/api` on Web network errors (backend/dev-server fallback).
 */
async function request<T = any>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  options: QueryArgs = {},
): Promise<HttpResponse<T>> {
  try {
    return await httpRequest<T>(path, {
      method,
      body,
      params: options.params,
      timeoutMs: options.timeoutMs,
    })
  } catch (error) {
    const axiosError = error as { response?: unknown; message?: string }
    // Re-throw HTTP errors; only fall back on genuine network errors (Web only).
    if (isTauriRuntime() || axiosError?.response) throw error
    if (axiosError?.message === 'Request failed' || axiosError instanceof Error) {
      const abs = `${FALLBACK_API_BASE}${path.startsWith('/') ? path : `/${path}`}`
      return httpRequest<T>(abs, {
        method,
        body,
        params: options.params,
        timeoutMs: options.timeoutMs,
      })
    }
    throw error
  }
}

export const api = {
  get<T = any>(path: string, options?: QueryArgs) {
    return request<T>('GET', path, undefined, options)
  },
  post<T = any>(path: string, body?: unknown, options?: QueryArgs) {
    return request<T>('POST', path, body, options)
  },
  put<T = any>(path: string, body?: unknown, options?: QueryArgs) {
    return request<T>('PUT', path, body, options)
  },
  delete<T = any>(path: string, options?: QueryArgs) {
    return request<T>('DELETE', path, undefined, options)
  },
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
  getEstimates(codes: string[]) { return api.get(`/funds/estimates?codes=${codes.join(',')}`) },
  getNavBatch(codes: string[]) { return api.post('/funds/nav-batch', { codes }) },
}

export const watchlistAPI = {
  refreshEstimates() { return api.post('/watchlist/refresh-estimates') },
}

export const screeningAPI = {
  getStatus() { return api.get('/screening/status') },
  getProgress() { return api.get('/screening/progress') },
  sync(params?: Record<string, unknown>) { return api.get('/screening/sync', { params }) },
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
  strategySuggest(data: { fundCode: string }) { return api.post('/backtest/strategy-suggest', data) },
}

export const marketAPI = {
  getOverview() { return api.get('/market/overview') },
  getFlashNews(count = 30, page = 1) { return api.get(`/news/flash?count=${count}&page=${page}`) },
  getSectorRank(limit = 90) { return api.get(`/market/sectors?limit=${limit}`) },
  getMarketIndex() { return api.get('/market/indices') },
  getGoldRealtime() { return api.get('/market/gold/realtime') },
  getGoldHistory(days = 10) { return api.get(`/market/gold/history?days=${days}`) },
  getSilverHistory(days = 10) { return api.get(`/market/silver/history?days=${days}`) },
  getVolumeWeekly() { return api.get('/market/volume') },
  getVolume7Days() { return api.get('/market/volume/7days') },
  getCombinedIndices() { return api.get('/market/indices/combined') },
  getSSE30min() { return api.get('/market/sse') },
  getIndicesIntraday() { return api.get('/market/indices/intraday') },
  getStockQuote(code: string) { return api.get(`/stocks/${code}/reference`) },
  getStockKline(code: string, params: Record<string, unknown> = {}) { return api.get(`/market/kline/${code}`, { params }) },
  getIndexDetail(code: string) { return api.get(`/market/index/${code}/detail`) },
  getIndexKline(code: string, params: Record<string, unknown> = {}) { return api.get(`/market/kline/${code}`, { params }) },
  getMarketMoneyFlow() { return api.get('/market/money-flow') },
  getCryptoQuotes() { return api.get('/market/crypto') },
  getCryptoDetail(symbol: string) { return api.get(`/market/crypto/${symbol}/detail`) },
  getCryptoKline(symbol: string, params: Record<string, unknown> = {}) { return api.get(`/market/kline/${symbol}`, { params }) },
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

export const systemAPI = {
  getProxy() { return api.get('/proxy') },
  updateProxy(data: { url: string }) { return api.put('/proxy', data) },
}

export const settingsAPI = {
  get() { return api.get('/settings') },
  update(data: Record<string, unknown>) { return api.put('/settings', data) },
}

export default api
