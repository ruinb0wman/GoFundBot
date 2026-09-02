export interface DraggingIndex {
  index: number
  groupId: number | null
}

export interface CompareFund {
  code: string
  name: string
}

export interface SubscriptionRedemption {
  categories?: string[]
  series?: Array<{
    name: string
    data: number[]
  }>
}

export interface FluctuationScale {
  categories?: string[]
  series?: Array<{
    y: number
    mom: string
  }>
}

export interface PortfolioHolding {
  code: string
  name: string
  ratio: number | null
  industryText: string
  industry?: string
  industry_name?: string
  industryName?: string
  sector?: string
  sector_name?: string
  position?: number
  hold_ratio?: number
}

export interface Portfolio {
  stock_codes_new?: PortfolioHolding[]
  stock_codes?: (string | number)[]
}

export interface FundDashboard {
  performance_eval: string
  manager_ability: string
  position_analysis: string
  market_outlook: string
}

export interface AnalystReport {
  analyst_role: string
  thesis: string
  score: number
  key_evidence: string[]
  risk_flags: string[]
}

export interface FundAnalysisResult {
  rating: string
  sentiment_score: number
  operation_advice: string
  summary: string
  dashboard: FundDashboard
  highlights: string[]
  risk_factors: string[]
  news_intel: string[]
  detailed_report: string
  analyst_reports?: AnalystReport[]
}

export interface PortfolioGroupRebalance {
  enabled: boolean
  target: number | null
  upper: number | null
  lower: number | null
}

export interface RebalanceWarning {
  fundCode: string
  fundName: string
  ratio: number
  threshold: number
  type: 'upper' | 'lower'
}

export interface RealtimeFund {
  code: string
  name: string
  type?: string
  dwjz?: string
  prevDwjz?: string
  gsz?: string
  gztime?: string
  jzrq?: string
  gszzl?: number
  holdings?: unknown[]
  netWorthTrend?: unknown[]
  totalReturnTrend?: unknown[]
}

export interface RealtimeHolding {
  share: number
  cost: number
  total_fee?: number
}

export interface PortfolioGroup {
  id: number | string
  name: string
  rebalance_enabled?: boolean | number
  rebalance_target?: number | null
  rebalance_upper?: number | null
  rebalance_lower?: number | null
}

export interface PendingTxn {
  id: string
  type: 'buy' | 'sell'
  fundCode: string
  fundName: string
  inputValue: number
  tradeDate: string
  nav?: number
  createdAt?: string
}

export interface RealtimeTradeRecord {
  id: string
  txnId?: string
  dbId?: number
  fundCode: string
  fundName: string
  type: 'buy' | 'sell' | 'fee' | 'dividend'
  tradeDate: string | null
  amount: number
  share: number
  nav: number | null
  status: string
  note?: string
  createdAt?: string
  settledAt?: string
}

export interface SearchFundItem {
  CODE: string
  NAME: string
}

export interface ContextMenuState {
  show: boolean
  x: number
  y: number
  groupId: number | string | null
}

export type RealtimeFundGroupMap = Record<string, number | string>
