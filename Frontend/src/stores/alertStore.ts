import { defineStore } from 'pinia'
import { alertAPI } from '../services/api'

interface AlertRule {
  id: number
  fund_code: string
  alert_type: string
  threshold: number
  enabled: boolean
  last_triggered: string | null
  created_time: string
}

export const useAlertStore = defineStore('alert', {
  state: () => ({
    rules: [] as AlertRule[],
    triggeredCount: 0,
    loading: false,
    lastCheck: 0,
  }),
  getters: {
    enabledRules: (state) => state.rules.filter(r => r.enabled),
    rulesByFund: (state) => (code: string) => state.rules.filter(r => r.fund_code === code),
  },
  actions: {
    async fetch() {
      this.loading = true
      try {
        const response = await alertAPI.list()
        this.rules = (response.data as AlertRule[]) || []
      } finally {
        this.loading = false
      }
    },
    async create(data: { fund_code: string; alert_type: string; threshold: number }) {
      await alertAPI.create(data)
      await this.fetch()
    },
    async update(id: number, data: { threshold?: number; enabled?: number }) {
      await alertAPI.update(id, data)
      await this.fetch()
    },
    async remove(id: number) {
      await alertAPI.remove(id)
      await this.fetch()
    },
    async check() {
      this.loading = true
      try {
        const response = await alertAPI.check()
        const result = response.data as { triggered: unknown[]; checked_count: number }
        this.triggeredCount = (result.triggered || []).length
        this.lastCheck = Date.now()
        return result.triggered || []
      } catch {
        return []
      } finally {
        this.loading = false
      }
    },
    clear() {
      this.rules = []
      this.triggeredCount = 0
    },
  },
})
