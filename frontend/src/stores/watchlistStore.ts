import { defineStore } from 'pinia'
import { fundAPI, watchlistAPI } from '../services/api'
import {
  assignWatchlistGroupApi,
  createWatchlistGroupApi,
  deleteWatchlistGroupApi,
  getWatchlistApi,
  removeWatchlistApi,
  renameWatchlistGroupApi,
  reorderWatchlistApi,
  reorderWatchlistGroupsApi,
  upsertWatchlistApi,
} from '../services/userDataApi'

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
        const snapshot = await getWatchlistApi()
        this.funds = snapshot.items.map(f => ({
          fund_code: f.fundCode,
          fund_name: f.fundName,
          fund_type: f.fundType,
          group_id: f.groupId,
          sort_order: f.sortOrder,
        })) as unknown as WatchlistFund[]

        this.groups = snapshot.groups.map(g => ({
          id: g.id,
          name: g.name,
          sort_order: g.sortOrder,
        })) as unknown as WatchlistGroup[]

        this.lastFetch = now
      } catch (error) {
        this.funds = Array.isArray(this.funds) ? this.funds : []
        this.groups = Array.isArray(this.groups) ? this.groups : []
        console.error('读取自选列表失败:', error)
      } finally {
        this.loading = false
      }
    },
    async addFund(fundCode: string, fundName: string, fundType = '', groupId: number | null = null) {
      const now = Date.now()
      await upsertWatchlistApi({
        fundCode,
        fundName: fundName || fundCode,
        fundType: fundType || null,
        groupId,
        sortOrder: now,
        addedAt: now,
      })
      const exists = this.funds.some(f => f.fund_code === fundCode)
      if (!exists) {
        this.funds.push({
          fund_code: fundCode,
          fund_name: fundName || fundCode,
          fund_type: fundType || null,
          group_id: groupId,
          sort_order: now,
        })
      }
      window.dispatchEvent(new CustomEvent('watchlist-updated', { detail: { fundCode, action: 'add' } }))
    },
    async removeFund(fundCode: string) {
      await removeWatchlistApi([fundCode])
      this.funds = this.funds.filter(f => f.fund_code !== fundCode)
      window.dispatchEvent(new CustomEvent('watchlist-updated', { detail: { fundCode, action: 'remove' } }))
    },
    async batchDelete(fundCodes: string[]) {
      await removeWatchlistApi(fundCodes)
      const codeSet = new Set(fundCodes)
      this.funds = this.funds.filter(f => !codeSet.has(f.fund_code))
      window.dispatchEvent(new CustomEvent('watchlist-updated', { detail: { action: 'batch-delete' } }))
    },
    async checkInWatchlist(fundCode: string): Promise<boolean> {
      const snapshot = await getWatchlistApi()
      return snapshot.items.some(item => item.fundCode === fundCode)
    },
    async reorder(fundCodeOrder: string[], groupId: number | null = null) {
      await assignWatchlistGroupApi(fundCodeOrder, groupId)
      await reorderWatchlistApi(fundCodeOrder)
      await this.fetch(true)
    },
    async moveFundToGroup(fundCode: string, groupId: number | null) {
      await assignWatchlistGroupApi([fundCode], groupId)
      await this.fetch(true)
    },
    async createGroup(name: string): Promise<{ id: number }> {
      const created = await createWatchlistGroupApi(name)
      await this.fetch(true)
      return { id: created.id }
    },
    async renameGroup(groupId: number, name: string) {
      await renameWatchlistGroupApi(groupId, name)
      await this.fetch(true)
    },
    async deleteGroup(groupId: number) {
      await deleteWatchlistGroupApi(groupId)
      await this.fetch(true)
    },
    async reorderGroups(groupIdOrder: number[]) {
      await reorderWatchlistGroupsApi(groupIdOrder)
      await this.fetch(true)
    },
    async refreshEstimates() {
      const fundCodes = this.funds.map(f => String(f.fund_code)).filter(Boolean)
      if (fundCodes.length === 0) return
      try {
        const response = await fundAPI.getEstimates(fundCodes)
        const body = response.data as Record<string, any>
        const batch = body?.data as Record<string, any> | undefined
        const items = (batch?.items ?? []) as Array<Record<string, any>>
        const estimateMap: Record<string, Record<string, any>> = {}
        for (const item of items) {
          if (item?.success && item?.data) {
            estimateMap[item.code] = item.data
          }
        }
        for (const fund of this.funds) {
          const code = String(fund.fund_code)
          const est = estimateMap[code]
          if (est) {
            fund.net_worth = est.nav
            fund.net_worth_date = est.navDate
            fund.estimate_value = est.estimatedNav
            fund.estimate_change = est.estimatedChangePercent
            // 货币基金：无盘中估值，用 7 日年化 / 每万份收益展示
            fund.is_money_fund = est.isMoneyFund === true
            fund.seven_day_yield = est.sevenDayYield ?? null
            fund.unit_income = est.unitIncome ?? null
            if (fund.estimate_change == null) {
              const estimateNav = Number(est.estimatedNav)
              const officialNav = Number(est.nav)
              if (Number.isFinite(estimateNav) && Number.isFinite(officialNav) && estimateNav > 0 && officialNav > 0) {
                fund.estimate_change = ((estimateNav - officialNav) / officialNav) * 100
              }
            }
            fund.estimate_time = est.estimateTime
            // 货币基金没有涨跌幅，用 7 日年化占位列（组件会改标签）
            if (fund.is_money_fund && fund.estimate_change == null && est.sevenDayYield != null) {
              fund.estimate_change = est.sevenDayYield
            }
          }
        }
      } catch (error) {
        console.error('获取估值数据失败:', error)
      }
    },
    clear() {
      this.funds = []
      this.groups = []
      this.lastFetch = 0
    },
  },
})
