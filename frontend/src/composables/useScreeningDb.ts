import { ref } from 'vue'
import { db, type ScreeningFund } from '../db'
import { screeningAPI, fundAPI } from '../services/api'
import { classifyFundIndustry } from '../services/industryClassifier'
import { computeRiskMetricsLocal } from '../utils/number'

export interface QueryResult {
  funds: ScreeningFund[]
  total: number
  page: number
  page_size: number
}

export interface ScreeningStatus {
  basic_count: number
  complete_count: number
  pass_4433_count: number
  risk_metrics_count: number
  type_counts: Record<string, number>
  latest_update: string | null
  sync_time: string | null
  syncing: boolean
  computed: boolean
}

const STORAGE_KEY = 'screening-last-sync'
const RISK_DATE_KEY = 'screening-risk-metrics-date'

const syncing = ref(false)
const lastSyncTime = ref<string | null>(localStorage.getItem(STORAGE_KEY) || null)
const computed = ref(false)

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function isRiskMetricsFresh(): boolean {
  const saved = localStorage.getItem(RISK_DATE_KEY)
  return saved === todayStr()
}

function markRiskMetricsFresh(): void {
  localStorage.setItem(RISK_DATE_KEY, todayStr())
}

function isBefore9am(time: string | null): boolean {
  if (!time) return true
  const nineAM = new Date()
  nineAM.setHours(9, 0, 0, 0)
  const t = new Date(time)
  return t < nineAM
}

function persistSyncTime(time: string): void {
  lastSyncTime.value = time
  localStorage.setItem(STORAGE_KEY, time)
}

async function fillMissingRiskMetrics(entries?: ScreeningFund[]): Promise<number> {
  let funds: ScreeningFund[]
  if (entries) {
    funds = entries
  } else {
    funds = await db.screeningFunds
      .filter(f => f.sharpe_ratio_1y === null)
      .toArray()
  }
  if (funds.length === 0) return 0

  const codes = funds.map(f => f.fund_code)
  try {
    const navRes = await fundAPI.getNavBatch(codes)
    const navItems = (navRes.data as Record<string, unknown>)?.data as Record<string, { date: string; nav: number }[]> | undefined ?? {}
    let riskCount = 0
    for (const entry of funds) {
      const navs = navItems[entry.fund_code]
      if (navs && navs.length >= 10) {
        const metrics = computeRiskMetricsLocal(navs)
        entry.max_drawdown_1y = metrics.max_drawdown_1y
        entry.sharpe_ratio_1y = metrics.sharpe_ratio_1y
        entry.sharpe_ratio_3y = metrics.sharpe_ratio_3y
        entry.volatility_1y = metrics.volatility_1y
        entry.calmar_ratio_1y = metrics.calmar_ratio_1y
        riskCount++
      }
    }
    if (riskCount > 0) {
      await db.screeningFunds.bulkPut(funds)
    }
    return riskCount
  } catch {
    return 0
  }
}

export function useScreeningDb() {
  async function syncFromServer(since?: string, force = false): Promise<number> {
    if (!force && isBefore9am(lastSyncTime.value)) {
      force = true
    }
    syncing.value = true
    try {
      const params: Record<string, unknown> = {}
      if (since && !force) params.since = since
      if (force) params.force = 'true'
      const res = await screeningAPI.sync(params)
      const body = res.data as { data?: { unchanged?: boolean; funds: Partial<ScreeningFund>[]; total: number; sync_time: string } }
      const data = body.data ?? { unchanged: false, funds: [], total: 0, sync_time: '' }

      if (data.unchanged) {
        if (data.sync_time) persistSyncTime(data.sync_time)
        if (!force && isRiskMetricsFresh()) return 0
        const filled = await fillMissingRiskMetrics()
        if (filled > 0) markRiskMetricsFresh()
        return filled > 0 ? 1 : 0
      }

      const funds = data.funds
      if (funds.length === 0) return 0

      // 保存现有风险指标，避免 /sync 返回 null 时覆盖已算好的值
      const oldRisk = new Map<string, ScreeningFund>()
      if (!force) {
        for (const f of await db.screeningFunds.toArray()) {
          oldRisk.set(f.fund_code, f)
        }
      }

      const entries: ScreeningFund[] = funds.map((f: Partial<ScreeningFund>) => {
        const old = oldRisk.get(f.fund_code || '')
        return {
          fund_code: f.fund_code || '',
          fund_name: f.fund_name || '',
          fund_type: f.fund_type || null,
          return_1m: f.return_1m ?? null,
          return_3m: f.return_3m ?? null,
          return_6m: f.return_6m ?? null,
          return_1y: f.return_1y ?? null,
          return_2y: f.return_2y ?? null,
          return_3y: f.return_3y ?? null,
          ytd: f.ytd ?? null,
          since_inception: f.since_inception ?? null,
          fee: f.fee ?? null,
          nav: f.nav ?? null,
          nav_date: f.nav_date ?? null,
          source: f.source ?? null,
          updated_time: f.updated_time ?? null,
          max_drawdown_1y: f.max_drawdown_1y ?? old?.max_drawdown_1y ?? null,
          sharpe_ratio_1y: f.sharpe_ratio_1y ?? old?.sharpe_ratio_1y ?? null,
          sharpe_ratio_3y: f.sharpe_ratio_3y ?? old?.sharpe_ratio_3y ?? null,
          volatility_1y: f.volatility_1y ?? old?.volatility_1y ?? null,
          calmar_ratio_1y: f.calmar_ratio_1y ?? old?.calmar_ratio_1y ?? null,
          industry_tag_name: f.industry_tag_name ?? classifyFundIndustry(f.fund_name ?? '') ?? old?.industry_tag_name ?? null,
          rank_pct_1m: null,
          rank_pct_3m: null,
          rank_pct_6m: null,
          rank_pct_1y: null,
          rank_pct_2y: null,
          rank_pct_3y: null,
          pass_4433: -1,
        }
      })

      await db.screeningFunds.clear()
      await db.screeningFunds.bulkPut(entries)

      if (force || !isRiskMetricsFresh()) {
        const filled = await fillMissingRiskMetrics(entries)
        if (filled > 0) markRiskMetricsFresh()
      }

      persistSyncTime(data.sync_time ?? new Date().toISOString())
      computed.value = false

      await compute4433()

      return entries.length
    } finally {
      syncing.value = false
    }
  }

  async function compute4433(): Promise<void> {
    const all = await db.screeningFunds.toArray()
    if (all.length === 0) return

    const groups = new Map<string, ScreeningFund[]>()
    for (const fund of all) {
      const type = fund.fund_type || '(untyped)'
      if (!groups.has(type)) groups.set(type, [])
      groups.get(type)!.push(fund)
    }

    for (const [, funds] of groups) {
      if (funds.length < 3) {
        for (const f of funds) {
          f.rank_pct_1m = null
          f.rank_pct_3m = null
          f.rank_pct_6m = null
          f.rank_pct_1y = null
          f.rank_pct_2y = null
          f.rank_pct_3y = null
          f.pass_4433 = 0
        }
        continue
      }

      const periods = ['1m', '3m', '6m', '1y', '2y', '3y'] as const

      const getReturn = (fund: ScreeningFund, period: string) => {
        switch (period) {
          case '1m': return fund.return_1m
          case '3m': return fund.return_3m
          case '6m': return fund.return_6m
          case '1y': return fund.return_1y
          case '2y': return fund.return_2y
          case '3y': return fund.return_3y
          default: return null
        }
      }

      const setRankPct = (fund: ScreeningFund, period: string, value: number | null) => {
        switch (period) {
          case '1m': fund.rank_pct_1m = value; break
          case '3m': fund.rank_pct_3m = value; break
          case '6m': fund.rank_pct_6m = value; break
          case '1y': fund.rank_pct_1y = value; break
          case '2y': fund.rank_pct_2y = value; break
          case '3y': fund.rank_pct_3y = value; break
        }
      }

      for (const period of periods) {
        const withReturn = funds
          .map((f, i) => ({ fund: f, ret: getReturn(f, period), idx: i }))
          .filter(x => x.ret !== null && Number.isFinite(x.ret))

        if (withReturn.length < 3) continue

        withReturn.sort((a, b) => (b.ret as number) - (a.ret as number))
        const total = withReturn.length
        for (let i = 0; i < total; i++) {
          const pct = (i / total) * 100
          setRankPct(withReturn[i].fund, period, pct)
        }
      }

      for (const f of funds) {
        f.pass_4433 = check4433Rule({
          rank_pct_1y: f.rank_pct_1y,
          rank_pct_2y: f.rank_pct_2y,
          rank_pct_3y: f.rank_pct_3y,
          rank_pct_6m: f.rank_pct_6m,
          rank_pct_3m: f.rank_pct_3m,
        }) ? 1 : 0
      }
    }

    await db.screeningFunds.bulkPut(all)
    computed.value = true
  }

  async function getStatus(): Promise<ScreeningStatus> {
    const all = await db.screeningFunds.toArray()
    const typeCounts: Record<string, number> = {}
    let passCount = 0
    let riskCount = 0
    let completeCount = 0
    let latestUpdate: string | null = null

    for (const fund of all) {
      const t = fund.fund_type || '(untyped)'
      typeCounts[t] = (typeCounts[t] || 0) + 1
      if (fund.pass_4433 === 1) passCount++
      if (fund.sharpe_ratio_1y !== null) riskCount++
      if (fund.fund_type && fund.fund_type !== '(untyped)'
        && fund.industry_tag_name !== null
        && fund.sharpe_ratio_1y !== null) completeCount++
      if (fund.updated_time && (!latestUpdate || fund.updated_time > latestUpdate)) {
        latestUpdate = fund.updated_time
      }
    }

    return {
      basic_count: all.length,
      complete_count: completeCount,
      pass_4433_count: passCount,
      risk_metrics_count: riskCount,
      type_counts: typeCounts,
      latest_update: latestUpdate,
      sync_time: lastSyncTime.value,
      syncing: syncing.value,
      computed: computed.value,
    }
  }

  async function queryFunds(
    filters: Record<string, unknown>,
    sortByField: string = 'return_1y',
    sortOrder: 'asc' | 'desc' = 'desc',
    page: number = 1,
    pageSize: number = 20,
  ): Promise<QueryResult> {
    const fundTypes = filters.fund_types as string[] | undefined
    const pass4433 = filters.pass_4433 === true || filters.pass_4433 === 'true' || filters.pass_4433 === 1

    let funds: ScreeningFund[]
    if (pass4433) {
      funds = await db.screeningFunds.where('pass_4433').equals(1).toArray()
    } else if (fundTypes && fundTypes.length > 0) {
      funds = await db.screeningFunds.where('fund_type').anyOf(fundTypes).toArray()
    } else {
      funds = await db.screeningFunds.toArray()
    }

    const results = funds.filter((fund) => {
      const industryTags = filters.industry_tags as string[] | undefined
      if (industryTags && industryTags.length > 0) {
        if (!fund.industry_tag_name || !industryTags.includes(fund.industry_tag_name)) return false
      }

      if (filters.return_1m_min != null && fund.return_1m != null && fund.return_1m < Number(filters.return_1m_min)) return false
      if (filters.return_1m_max != null && fund.return_1m != null && fund.return_1m > Number(filters.return_1m_max)) return false
      if (filters.return_3m_min != null && fund.return_3m != null && fund.return_3m < Number(filters.return_3m_min)) return false
      if (filters.return_3m_max != null && fund.return_3m != null && fund.return_3m > Number(filters.return_3m_max)) return false
      if (filters.return_6m_min != null && fund.return_6m != null && fund.return_6m < Number(filters.return_6m_min)) return false
      if (filters.return_6m_max != null && fund.return_6m != null && fund.return_6m > Number(filters.return_6m_max)) return false
      if (filters.return_1y_min != null && fund.return_1y != null && fund.return_1y < Number(filters.return_1y_min)) return false
      if (filters.return_1y_max != null && fund.return_1y != null && fund.return_1y > Number(filters.return_1y_max)) return false
      if (filters.return_3y_min != null && fund.return_3y != null && fund.return_3y < Number(filters.return_3y_min)) return false
      if (filters.return_3y_max != null && fund.return_3y != null && fund.return_3y > Number(filters.return_3y_max)) return false

      if (filters.rank_pct_1m_max != null && fund.rank_pct_1m != null && fund.rank_pct_1m > Number(filters.rank_pct_1m_max)) return false
      if (filters.rank_pct_3m_max != null && fund.rank_pct_3m != null && fund.rank_pct_3m > Number(filters.rank_pct_3m_max)) return false
      if (filters.rank_pct_6m_max != null && fund.rank_pct_6m != null && fund.rank_pct_6m > Number(filters.rank_pct_6m_max)) return false
      if (filters.rank_pct_1y_max != null && fund.rank_pct_1y != null && fund.rank_pct_1y > Number(filters.rank_pct_1y_max)) return false
      if (filters.rank_pct_2y_max != null && fund.rank_pct_2y != null && fund.rank_pct_2y > Number(filters.rank_pct_2y_max)) return false
      if (filters.rank_pct_3y_max != null && fund.rank_pct_3y != null && fund.rank_pct_3y > Number(filters.rank_pct_3y_max)) return false

      if (filters.sharpe_ratio_1y_min != null && fund.sharpe_ratio_1y != null && fund.sharpe_ratio_1y < Number(filters.sharpe_ratio_1y_min)) return false
      if (filters.sharpe_ratio_3y_min != null && fund.sharpe_ratio_3y != null && fund.sharpe_ratio_3y < Number(filters.sharpe_ratio_3y_min)) return false
      if (filters.calmar_ratio_1y_min != null && fund.calmar_ratio_1y != null && fund.calmar_ratio_1y < Number(filters.calmar_ratio_1y_min)) return false
      if (filters.max_drawdown_3m_max != null && fund.max_drawdown_1y != null && fund.max_drawdown_1y > Number(filters.max_drawdown_3m_max)) return false
      if (filters.max_drawdown_6m_max != null && fund.max_drawdown_1y != null && fund.max_drawdown_1y > Number(filters.max_drawdown_6m_max)) return false
      if (filters.max_drawdown_1y_max != null && fund.max_drawdown_1y != null && fund.max_drawdown_1y > Number(filters.max_drawdown_1y_max)) return false
      if (filters.max_drawdown_3y_max != null && fund.max_drawdown_1y != null && fund.max_drawdown_1y > Number(filters.max_drawdown_3y_max)) return false
      if (filters.max_drawdown_all_max != null && fund.max_drawdown_1y != null && fund.max_drawdown_1y > Number(filters.max_drawdown_all_max)) return false
      if (filters.volatility_1y_max != null && fund.volatility_1y != null && fund.volatility_1y > Number(filters.volatility_1y_max)) return false
      if (filters.volatility_3y_max != null && fund.volatility_1y != null && fund.volatility_1y > Number(filters.volatility_3y_max)) return false
      if (filters.annual_return_1y_min != null && fund.return_1y != null && fund.return_1y < Number(filters.annual_return_1y_min)) return false
      if (filters.annual_return_1y_max != null && fund.return_1y != null && fund.return_1y > Number(filters.annual_return_1y_max)) return false
      if (filters.annual_return_3y_min != null && fund.return_3y != null && fund.return_3y < Number(filters.annual_return_3y_min)) return false
      if (filters.annual_return_3y_max != null && fund.return_3y != null && fund.return_3y > Number(filters.annual_return_3y_max)) return false

      if (filters.keyword && typeof filters.keyword === 'string' && filters.keyword.trim()) {
        const kw = filters.keyword.trim().toLowerCase()
        if (!fund.fund_code.toLowerCase().includes(kw) && !fund.fund_name.toLowerCase().includes(kw)) return false
      }

      return true
    })

    results.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortByField] as number | null
      const bVal = (b as unknown as Record<string, unknown>)[sortByField] as number | null
      if (aVal === bVal) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal
    })

    const total = results.length
    const start = (page - 1) * pageSize
    return { funds: results.slice(start, start + pageSize), total, page, page_size: pageSize }
  }

  return { syncFromServer, compute4433, getStatus, queryFunds, syncing, lastSyncTime, computed }
}

function check4433Rule(ranks: {
  rank_pct_1y: number | null
  rank_pct_2y: number | null
  rank_pct_3y: number | null
  rank_pct_6m: number | null
  rank_pct_3m: number | null
}): boolean {
  if (ranks.rank_pct_1y == null || ranks.rank_pct_1y > 25) return false
  const longTermPass = (ranks.rank_pct_2y != null && ranks.rank_pct_2y <= 25) ||
    (ranks.rank_pct_3y != null && ranks.rank_pct_3y <= 25)
  if (!longTermPass) return false
  if (ranks.rank_pct_6m == null || ranks.rank_pct_6m > 33.33) return false
  if (ranks.rank_pct_3m == null || ranks.rank_pct_3m > 33.33) return false
  return true
}

export { check4433Rule }
