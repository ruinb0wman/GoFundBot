import Dexie, { type Table } from 'dexie'

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
}

export interface ChatMessage {
  id?: number
  sessionId: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName: string | null
  toolParamsJson: string | null
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
  }
}

export const db = new GoFundDB()
