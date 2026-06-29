import { defineStore } from 'pinia'
import { watchlistAPI } from '../services/api'

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
      this.loading = true
      try {
        const response = await watchlistAPI.getWatchlist()
        const data = response.data as { data?: WatchlistFund[]; groups?: WatchlistGroup[] }
        this.funds = data.data || []
        this.groups = data.groups || []
        this.lastFetch = now
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
