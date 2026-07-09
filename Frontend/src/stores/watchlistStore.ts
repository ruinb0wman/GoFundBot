import { defineStore } from 'pinia'
import { watchlistAPI } from '../services/api'
import { db } from '../db'

interface WatchlistFund {
  fund_code: string
  fund_name?: string
  [key: string]: unknown
}

interface WatchlistGroup {
  id: number
  name: string
  [key: string]: unknown
}

export const useWatchlistStore = defineStore('watchlist', {
  state: () => ({
    funds: [] as WatchlistFund[],
    groups: [] as WatchlistGroup[],
    loading: false,
    lastFetch: 0,
  }),
  getters: {
    totalCount: (state) => state.funds.length,
    fundMap: (state) => {
      const map: Record<string, WatchlistFund> = {}
      for (const f of state.funds) {
        map[f.fund_code] = f
      }
      return map
    },
  },
  actions: {
    async fetch(force = false) {
      const now = Date.now()
      if (!force && this.lastFetch && now - this.lastFetch < 30000) {
        return
      }
      // Try Dexie cache first for instant load
      const cachedFunds = await db.watchlist.toArray()
      if (cachedFunds.length > 0 && !force) {
        this.funds = cachedFunds.map(f => ({
          fund_code: f.fundCode,
          fund_name: f.fundName,
          fund_type: f.fundType,
          group_id: f.groupId,
          sort_order: f.sortOrder,
        })) as unknown as WatchlistFund[]
      }

      this.loading = true
      try {
        const response = await watchlistAPI.getWatchlist()
        const body = response.data as { success: boolean; data?: { data?: WatchlistFund[]; groups?: WatchlistGroup[] } }
        const rawFunds = body?.data?.data
        const apiFunds: WatchlistFund[] = Array.isArray(rawFunds) ? rawFunds : []
        this.funds = apiFunds
        this.groups = Array.isArray(body?.data?.groups) ? body.data.groups : []
        this.lastFetch = now

        // Write to Dexie for offline caching
        await db.watchlist.clear()
        const nowNum = Date.now()
        for (const f of apiFunds) {
          await db.watchlist.put({
            fundCode: f.fund_code as string,
            fundName: f.fund_name as string,
            fundType: (f.fund_type as string) ?? null,
            groupId: (f.group_id as number | null) ?? null,
            sortOrder: (f.sort_order as number) ?? 0,
            addedAt: nowNum,
          })
        }
      } catch (error) {
        this.funds = Array.isArray(this.funds) ? this.funds : []
        this.groups = Array.isArray(this.groups) ? this.groups : []
        if (cachedFunds.length === 0) {
          console.error('加载自选列表失败:', error)
        }
      } finally {
        this.loading = false
      }
    },
    async refreshEstimates() {
      await watchlistAPI.refreshEstimates()
      await this.fetch(true)
    },
    clear() {
      this.funds = []
      this.groups = []
      this.lastFetch = 0
    },
  },
})
