import Dexie, { type Table } from 'dexie'
import type { BacktestSummary, PortfolioSummary } from '@gofund/core/backtest/backtestTypes'

/**
 * A replayable backtest scheme. Everything that defines the run (pool, window,
 * amounts, fees) lives in the code's `prepare()`, so the record is just the code.
 */
export interface StrategyScriptRecord {
  id?: number
  name: string
  code: string
  source: 'manual' | 'ai'
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  lastSummary?: BacktestSummary | PortfolioSummary
}


export interface WatchlistItem {
  fundCode: string
  fundName: string
  fundType: string | null
  groupId: number | null
  sortOrder: number
  addedAt: number
}

export interface WatchlistGroup {
  id?: number
  name: string
  sortOrder: number
}

export interface PortfolioItem {
  fundCode: string
  fundName: string | null
  fundType: string | null
  fundDataJson: string | null
  groupId: number | null
  sortOrder: number
  updatedAt: number
}

export interface TradeRecord {
  id?: number
  fundCode: string
  fundName: string | null
  type: 'buy' | 'sell' | 'fee' | 'dividend'
  tradeDate: string | null
  amount: number
  share: number
  nav: number
  status: string
  txnId: string | null
  createdAt: number
}

export interface UserPosition {
  id?: number
  fundCode: string
  fundName: string | null
  purchaseDate: string | null
  /** Non-indexed extra field — the MyPositions form records a time too. */
  purchaseTime?: string | null
  shares: number
  cost: number
  createdAt: number
}

export interface AlertRule {
  id?: number
  fundCode: string
  alertType: 'price_up' | 'price_down' | 'return_above' | 'return_below'
  threshold: number
  enabled: number
  lastTriggered: string | null
  createdAt: number
}

export interface ChatSession {
  id?: number
  title: string
  updatedAt: number
  channel?: string
}

export interface ChatMessage {
  id?: number
  sessionId: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName: string | null
  toolParamsJson: string | null
  /** Structured tool-call chips: [{name, params, status, durationMs}] (non-indexed). */
  toolCallsJson: string | null
  createdAt: number
}

export interface FundCacheEntry {
  fundCode: string
  data: unknown
  updatedAt: number
}

export interface MarketCacheEntry {
  key: string
  data: unknown
  updatedAt: number
}

/**
 * 一行筛选结果 —— 现在是 **service `/api/screening/query` 的响应形状**
 * （本地 Dexie `screeningFunds` 表已在 P3.3 删除）。
 */
export interface ScreeningFund {
  fund_code: string
  fund_name: string
  fund_type: string | null
  return_1m: number | null
  return_3m: number | null
  return_6m: number | null
  return_1y: number | null
  return_2y: number | null
  return_3y: number | null
  ytd: number | null
  since_inception: number | null
  fee: string | null
  nav: number | null
  nav_date: string | null
  source: string | null
  updated_time: string | null
  max_drawdown_1y: number | null
  sharpe_ratio_1y: number | null
  sharpe_ratio_3y: number | null
  volatility_1y: number | null
  calmar_ratio_1y: number | null
  industry_tag_name: string | null
  rank_pct_1m: number | null
  rank_pct_3m: number | null
  rank_pct_6m: number | null
  rank_pct_1y: number | null
  rank_pct_2y: number | null
  rank_pct_3y: number | null
  pass_4433: number
}

export interface AnalysisMemoryRecord {
  id?: number
  fundCode: string
  analysisDate: number
  rating: string
  sentimentScore: number
  thesis: string
  resolved: number
  actualReturn: number | null
  reflection: string | null
  resolvedDate: number | null
}

export interface StrategyRecord {
  id?: number
  title: string
  content: string
  tags: string[]
  active: number
  source: 'manual' | 'ai-draft'
  createdAt: number
  updatedAt: number
}

export class GoFundDB extends Dexie {
  watchlist!: Table<WatchlistItem>
  watchlistGroups!: Table<WatchlistGroup>
  portfolio!: Table<PortfolioItem>
  tradeRecords!: Table<TradeRecord>
  positions!: Table<UserPosition>
  alertRules!: Table<AlertRule>
  chatSessions!: Table<ChatSession>
  chatMessages!: Table<ChatMessage>
  fundCache!: Table<FundCacheEntry>
  marketCache!: Table<MarketCacheEntry>
  /** @deprecated 筛选数据的唯一真源已是 service SQLite（`screening_funds` 表），详见 `useScreeningDb.ts`。 */
  analysisMemory!: Table<AnalysisMemoryRecord>
  strategies!: Table<StrategyRecord>
  strategyScripts!: Table<StrategyScriptRecord>

  constructor() {
    super('GoFundBot')

    this.version(1).stores({
      watchlist: 'fundCode, groupId, sortOrder, addedAt',
      watchlistGroups: '++id, sortOrder',
      portfolio: 'fundCode, groupId, sortOrder',
      tradeRecords: '++id, fundCode, type, tradeDate, status, createdAt',
      positions: '++id, fundCode',
      alertRules: '++id, fundCode, alertType, enabled',
      chatSessions: '++id, updatedAt',
      chatMessages: '++id, sessionId, role, createdAt',
      fundCache: 'fundCode, updatedAt',
      marketCache: 'key, updatedAt',
    })

    this.version(2).stores({
      screeningFunds: 'fund_code, fund_type, pass_4433, updated_time',
    })

    this.version(3).stores({
      analysisMemory: '++id, fundCode, resolved, analysisDate',
    })

    this.version(4).stores({
      strategies: '++id, active, updatedAt',
      chatSessions: '++id, updatedAt, channel',
    })

    this.version(5).stores({
      backtestRuns: '++id, fundCode, createdAt, specHash',
    })

    // The scheme (code + config) replaces the per-fund run history.
    this.version(6).stores({
      strategyScripts: '++id, name, mode, updatedAt',
      backtestRuns: null,
    })

    // Code-first strategies: the record is just the code, and NAV gets a real cache.
    this.version(7).stores({
      strategyScripts: '++id, name, updatedAt',
      navHistory: 'code, lastDate, updatedAt',
      screeningFunds: 'fund_code, fund_type, pass_4433, updated_time, nav_date',
    })

    // P3.3：筛选富化搬到 service SQLite，本地表删除（旧数据留在 IndexedDB 里不再读）。
    this.version(8).stores({
      screeningFunds: null,
    })

    // P3.4：净值缓存搬到 service SQLite（`nav_history` + 覆盖度判断都在那边）。
    this.version(9).stores({
      navHistory: null,
    })
  }
}

export const db = new GoFundDB()
