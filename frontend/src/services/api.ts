import { httpRequest, type HttpResponse } from './httpClient'

interface QueryArgs {
  params?: Record<string, unknown>
  timeoutMs?: number
}

/**
 * Axios-like request helper. Paths resolve through httpClient (`/api` Vite proxy
 * → `localhost:8310`).
 */
async function request<T = any>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  options: QueryArgs = {},
): Promise<HttpResponse<T>> {
  return httpRequest<T>(path, {
    method,
    body,
    params: options.params,
    timeoutMs: options.timeoutMs,
  })
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
  /** 分批富化风险指标（一次一批，limit 默认服务端 300）。 */
  compute(params: Record<string, unknown> = {}) { return api.post('/screening/compute', params) },
  /** 重算 4433 排名。 */
  ranks() { return api.post('/screening/ranks') },
  /** 行业标签计数（筛选页标签面板）。 */
  getIndustryTags() { return api.get('/screening/industry-tags') },
  /** 策略沙箱 `screen()` 用的全量字段（7 列）。 */
  getScreenRows() { return api.get('/screening/screen-rows') },
  getFundDetail(fundCode: string) { return api.get(`/screening/fund/${fundCode}`) },
}

export const researchAPI = {
  /** 投研看板（service 聚合，与 pi 的 get_research_dashboard 同一份实现）。 */
  getDashboard(params: Record<string, unknown> = {}) { return api.get('/research/dashboard', { params }) },
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
