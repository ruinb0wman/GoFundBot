/**
 * 用户数据 / 筛选结果的**记录形状**。
 *
 * 这些接口原来长在 `db/index.ts`（Dexie schema）里 —— P6 掉了 Dexie 之后，
 * 它们只是 service HTTP 接口的响应形状（见 `services/userDataApi.ts`），
 * 谁需要类型就从这里 import，不再经由 `db/`。
 */
import type { BacktestSummary, PortfolioSummary } from '@gofund/core/backtest/backtestTypes'

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

/**
 * 一行筛选结果 —— `service /api/screening/query` 的响应形状
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
