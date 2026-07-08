import api from './api'

export const portfolioAPI = {
  // ── Funds ──
  getFunds() { return api.get('/user/portfolio/funds') },
  addFund(data: Record<string, unknown>) { return api.post('/user/portfolio/funds', data) },
  batchAddFunds(funds: Record<string, unknown>[]) { return api.post('/user/portfolio/funds/batch', { funds }) },
  removeFund(code: string) { return api.delete(`/user/portfolio/funds/${code}`) },
  reorderFunds(codes: string[]) { return api.put('/user/portfolio/funds/reorder', { fund_codes: codes }) },
  updateAllFunds(funds: Record<string, unknown>[]) { return api.put('/user/portfolio/funds/all', { funds }) },

  // ── Holdings (computed from trade records) ──
  getHoldings(asOf?: string) {
    const params = asOf ? { as_of: asOf } : {}
    return api.get('/user/portfolio/holdings', { params })
  },

  // ── Trade Records ──
  getTrades(fundCode?: string) {
    const params = fundCode ? { fund_code: fundCode } : {}
    return api.get('/user/portfolio/trades', { params })
  },
  addTrade(data: Record<string, unknown>) { return api.post('/user/portfolio/trades', data) },
  updateTrade(id: number, data: Record<string, unknown>) { return api.put(`/user/portfolio/trades/${id}`, data) },
  deleteTrade(id: number) { return api.delete(`/user/portfolio/trades/${id}`) },
  deletePendingTrade(txnId: string) { return api.delete(`/user/portfolio/trades/pending/${txnId}`) },
  batchSettleTrades(txnIds: string[]) { return api.post('/user/portfolio/trades/batch-settle', { txn_ids: txnIds }) },
  clearTrades() { return api.delete('/user/portfolio/trades') },

  // ── Groups ──
  getGroups() { return api.get('/user/portfolio/groups') },
  createGroup(name: string) { return api.post('/user/portfolio/groups', { name }) },
  updateGroup(id: number, data: Record<string, unknown>) { return api.put(`/user/portfolio/groups/${id}`, data) },
  deleteGroup(id: number) { return api.delete(`/user/portfolio/groups/${id}`) },

  // ── Fund ↔ Group Map ──
  getGroupMap() { return api.get('/user/portfolio/fund-group-map') },
  syncGroupMap(mappings: { fund_code: string; group_id: string | null }[]) {
    return api.put('/user/portfolio/fund-group-map', { mappings })
  },

  // ── Positions (MyPositions) ──
  getPositions() { return api.get('/user/portfolio/positions') },
  addPosition(data: Record<string, unknown>) { return api.post('/user/portfolio/positions', data) },
  updatePosition(id: number, data: Record<string, unknown>) { return api.put(`/user/portfolio/positions/${id}`, data) },
  deletePosition(id: number) { return api.delete(`/user/portfolio/positions/${id}`) },
  clearPositions() { return api.delete('/user/portfolio/positions') },

  // ── Migration & Export ──
  migrate(payload: Record<string, unknown>) { return api.post('/user/portfolio/migrate', payload) },
  exportAll() { return api.get('/user/portfolio/export') },
}
