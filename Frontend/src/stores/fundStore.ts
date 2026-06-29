import { defineStore } from 'pinia'
import { fundAPI } from '../services/api'

interface CacheEntry {
  data: unknown
  ts: number
}

export const useFundStore = defineStore('fund', {
  state: () => ({
    cache: {} as Record<string, CacheEntry>,
    pendingRequests: {} as Record<string, Promise<unknown>>,
  }),
  actions: {
    async fetchFund(fundCode: string, force = false) {
      const cached = this.cache[fundCode]
      if (!force && cached && Date.now() - cached.ts < 60000) {
        return cached.data
      }
      const existing = this.pendingRequests[fundCode]
      if (existing) {
        return existing
      }
      const promise = fundAPI.getFundDetail(fundCode).then(res => {
        delete this.pendingRequests[fundCode]
        this.cache[fundCode] = { data: res.data, ts: Date.now() }
        return res.data
      }).catch(err => {
        delete this.pendingRequests[fundCode]
        throw err
      })
      this.pendingRequests[fundCode] = promise
      return promise
    },
    clearCache() {
      this.cache = {}
    },
  },
})
