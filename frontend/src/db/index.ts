import Dexie, { type Table } from 'dexie'
import type { BacktestSummary, PortfolioSummary } from '@gofund/core/backtest/backtestTypes'

/**
 * 前端 Dexie —— **只剩「一次性导入旧数据」这一条活路径**（`db/migrateToServer.ts`）。
 *
 * 用户数据（自选/持仓/策略/回测方案）从 P2 起真源是 service SQLite，缓存（筛选库/净值）
 * 从 P3.3/P3.4 起也在 service；这里的表只在首次启动时被读一次，导入成功后清空。
 * 保留的接口里，`ScreeningFund`/`StrategyRecord` 等仍被别的模块当**类型**用。
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
  positions!: Table<UserPosition>
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

    // P6：其余表都成了死重量（其中 portfolio/tradeRecords 的前端调用方早已删除），
    // 只留下 `migrateToServer.ts` 一次性导入还需要的那 5 张。
    this.version(10).stores({
      portfolio: null,
      tradeRecords: null,
      alertRules: null,
      chatSessions: null,
      chatMessages: null,
      fundCache: null,
      marketCache: null,
      analysisMemory: null,
    })
  }
}

export const db = new GoFundDB()
