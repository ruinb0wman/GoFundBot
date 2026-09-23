/**
 * Chat tool handlers (frontend). Ported from Service `chatTools.ts`.
 * Tools call the Node API via api.ts and perform local computation
 * (4433 / industry / search) in-browser.
 */

import api from '../api'
import { db } from '../../db'
import { sleep } from './toolLoop'
import { searchWeb } from '../searchService'
import {
  buildIndustryPerformanceFromScreening,
  compute4433Ranking,
  filterFundsByIndustry,
  type ScreeningLikeItem,
} from '../industryClassifier'
import type { AppSettings } from '../../composables/useAppSettings'

export interface ToolContext {
  searchSettings?: AppSettings
}

type AnyVal = any

function unpack(res: AnyVal): any {
  return res?.data ?? res
}

function toolData(result: any): unknown {
  return result && typeof result === 'object' && 'data' in result ? result.data : result
}

/** 北向成交总额 → 亿元。注意 DEAL_AMT 单位是百万元，所以除以 100 而不是 10000 */
function toYi(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? +(value / 100).toFixed(2) : null
}

function getDateRange(startDate?: string, endDate?: string): Record<string, string> {
  const range: Record<string, string> = {}
  if (startDate) range.startDate = startDate
  if (endDate) range.endDate = endDate
  return range
}

async function localScreeningItems(): Promise<ScreeningLikeItem[]> {
  const funds = await db.screeningFunds.toArray()
  return funds as unknown as ScreeningLikeItem[]
}

const toolHandlers: Record<string, (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>> = {
  search_funds: async (args) => {
    const res = await api.get(`/fund/search?q=${encodeURIComponent(String(args.keyword ?? ''))}`)
    return toolData(unpack(res))
  },

  get_fund_detail: async (args) => {
    const res = await api.get(`/fund/${args.code}`)
    return toolData(unpack(res))
  },

  get_fund_estimate: async (args) => {
    const res = await api.get(`/funds/${args.code}/estimate`)
    return toolData(unpack(res))
  },

  get_fund_nav_history: async (args) => {
    const res = await api.get(`/funds/${args.code}/nav-history`, {
      params: getDateRange(args.start_date as string, args.end_date as string),
    })
    return toolData(unpack(res))
  },

  get_market_indices: async () => {
    const res = await api.get('/market/indices')
    return unpack(res)?.data ?? unpack(res)
  },

  get_market_news: async (args) => {
    const count = (args.count as number) || 20
    const res = await api.get(`/news/flash?count=${count}&page=1`)
    return toolData(unpack(res))
  },

  get_hot_sectors: async (args) => {
    const limit = (args.limit as number) || 10
    const res = await api.get(`/market/sectors?limit=${limit}`)
    return unpack(res)?.data ?? unpack(res)
  },

  get_concept_sectors: async () => {
    try {
      const res = await api.get('/market/sectors?limit=50')
      const items = unpack(res)?.data?.items ?? unpack(res)?.items ?? []
      return { data_status: 'available', items, count: items.length }
    } catch (error) {
      return { data_status: 'error', items: [], note: String(error) }
    }
  },

  get_north_flow: async () => {
    try {
      const res = await api.get('/market/north-flow')
      const d = unpack(res)?.data ?? unpack(res) ?? {}
      const hasDealAmount = d.totalDealAmount != null
      // data_status 恒为 unavailable：净流入自 2024-08-19 起停止披露，
      // 若报 available 会让模型把 null 当成 0。成交总额放在字段与 note 里。
      return {
        data_status: 'unavailable',
        date: d.date ?? '',
        net_inflow_available: false,
        sh_net_inflow: null,
        sz_net_inflow: null,
        total_net_inflow: null,
        total_deal_amount_yi: toYi(d.totalDealAmount),
        sh_deal_amount_yi: toYi(d.shDealAmount),
        sz_deal_amount_yi: toYi(d.szDealAmount),
        note: hasDealAmount
          ? '自 2024-08-19 起沪深港通不再披露北向资金净流入（*_net_inflow 恒为 null，不要解读为 0）；仅公布当日成交总额。以上 *_deal_amount_yi 即最新交易日的北向成交总额（单位：亿元）。'
          : '北向资金数据暂不可用（净流入自 2024-08-19 起停止披露，成交总额也尚未更新）。',
      }
    } catch (error) {
      return { data_status: 'error', note: String(error) }
    }
  },

  get_market_breadth: async () => {
    try {
      const res = await api.get('/market/breadth')
      const d = unpack(res)?.data ?? unpack(res) ?? {}
      const hasLimitCounts = d.limitUp != null || d.limitDown != null
      return {
        data_status: d.total > 0 ? 'available' : 'unavailable',
        scope: d.scope ?? '沪深两市',
        date: d.date ?? '',
        up_count: d.upCount, down_count: d.downCount, flat_count: d.flatCount,
        limit_up: d.limitUp ?? null, limit_down: d.limitDown ?? null, total: d.total,
        note: d.total > 0
          ? (hasLimitCounts ? undefined : '涨停/跌停家数本次未取到，仅涨跌家数有效')
          : '涨跌家数本次未取到（数据源异常或尚未更新），请勿据此判断市场涨跌结构',
      }
    } catch (error) {
      return { data_status: 'error', up_count: 0, down_count: 0, flat_count: 0, limit_up: null, limit_down: null, total: 0, note: String(error) }
    }
  },

  get_main_flow: async () => {
    try {
      const res = await api.get('/market/money-flow')
      const d = unpack(res)?.data ?? unpack(res) ?? {}
      return {
        data_status: d.date ? 'available' : 'unavailable',
        date: d.date ?? '',
        main_net_inflow: d.mainNetInflow,
        super_large_net_inflow: d.superLargeNetInflow,
        large_net_inflow: d.largeNetInflow,
        medium_net_inflow: d.mediumNetInflow,
        small_net_inflow: d.smallNetInflow,
      }
    } catch (error) {
      return { data_status: 'error', note: String(error) }
    }
  },

  get_flash_news: async (args) => {
    const count = (args.count as number) || 20
    const res = await api.get(`/news/flash?count=${count}&page=1`)
    return toolData(unpack(res))
  },

  get_watchlist: async () => {
    return { message: '自选列表信息存储在前端本地（IndexedDB），请在页面上查看和管理自选基金' }
  },

  screen_funds_by_4433: async () => {
    const items = await localScreeningItems()
    if (items.length === 0) return { funds: [], message: '暂未获取到基金数据，请稍后重试', method: '4433' }
    return { funds: compute4433Ranking(items), method: '4433', total_screened: items.length }
  },

  run_backtest: async (args) => {
    const res = await api.post('/backtest/fixed-investment', {
      fundCode: args.fund_code,
      startDate: args.start_date,
      endDate: args.end_date,
      amount: (args.amount as number) ?? 1000,
      investmentType: (args.investment_type as string) ?? 'monthly',
    })
    return unpack(res)?.data ?? unpack(res)
  },

  suggest_strategy: async (args) => {
    const res = await api.post('/backtest/strategy-suggest', { fundCode: args.fund_code })
    return unpack(res)?.data ?? unpack(res)
  },

  get_stock_quote: async (args) => {
    const res = await api.get(`/stocks/${args.code}/reference`)
    return toolData(unpack(res))
  },

  get_market_anomaly: async () => {
    try {
      const res = await api.get('/market/indices')
      const indices = unpack(res)?.data?.items ?? unpack(res)?.items ?? []
      return { anomalies: [], indices }
    } catch (error) {
      return { anomalies: [], error: String(error) }
    }
  },

  get_gold_realtime: async () => {
    const res = await api.get('/market/gold/realtime')
    return unpack(res)?.data ?? unpack(res)
  },

  get_fund_holdings: async (args) => {
    const res = await api.get(`/funds/${args.code}/holdings`)
    return toolData(unpack(res))
  },

  get_fund_managers: async (args) => {
    const res = await api.get(`/funds/${args.code}/managers`)
    return toolData(unpack(res))
  },

  get_funds_by_industry: async (args) => {
    const keyword = args.keyword as string
    try {
      const items = await localScreeningItems()
      return filterFundsByIndustry(items, keyword)
    } catch (error) {
      return { funds: [], total: 0, message: `查询失败: ${String(error)}` }
    }
  },

  search_news: async (args, ctx) => {
    const query = args.query as string
    const maxResults = (args.max_results as number) || 5
    if (!query) return { error: 'query is required' }
    try {
      const result = await searchWeb(query, maxResults, ctx.searchSettings)
      if (result.success && result.results) {
        return { query, results: result.results, provider: result.provider ?? 'search' }
      }
      return { query, results: [], error: result.error ?? '搜索未返回结果' }
    } catch (error) {
      return { query, results: [], error: String(error) }
    }
  },

  get_industry_performance: async () => {
    try {
      const items = await localScreeningItems()
      if (items.length > 0) {
        return buildIndustryPerformanceFromScreening(items)
      }
      return { items: [], summary: { total: 0 }, error: '暂未获取到基金数据，请稍后重试' }
    } catch (error) {
      return { items: [], summary: { total: 0 }, error: String(error) }
    }
  },

  get_index_kline: async (args) => {
    const code = args.code as string
    const startDate = args.start_date as string
    const endDate = args.end_date as string
    if (!code || !startDate || !endDate) {
      return { error: '缺少必要参数: code, start_date, end_date' }
    }
    try {
      const res = await api.get(`/market/kline/${code}`, {
        params: { startDate, endDate, period: (args.period as string) || 'daily' },
      })
      const data = unpack(res)?.data ?? unpack(res)
      const items = Array.isArray(data) ? data : (data?.items ?? [])
      return { code, start_date: startDate, end_date: endDate, kline: items, count: items.length }
    } catch (error) {
      return { code, start_date: startDate, end_date: endDate, kline: [], error: String(error) }
    }
  },
}

/** Execute a named tool with retry, mirroring Service `chatTools.executeTool`. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const handler = toolHandlers[name]
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`)
  }

  const maxRetries = 2
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await handler(args, ctx)
    } catch (error) {
      if (attempt === maxRetries) {
        return { error: String(error) }
      }
      const msg = String(error).toLowerCase()
      const isRetryable = /timeout|econn|eaddrinuse|enotfound|spawn|reset|network|fetch.*failed/i.test(msg)
      if (!isRetryable) {
        return { error: String(error) }
      }
      await sleep(1500)
    }
  }
  throw new Error('unreachable')
}
