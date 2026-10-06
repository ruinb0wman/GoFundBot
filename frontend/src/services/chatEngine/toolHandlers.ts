/**
 * Chat tool handlers (frontend). Ported from Service `chatTools.ts`.
 * Tools call the Node API via api.ts and perform local computation
 * (4433 / industry / search) in-browser.
 */

import api from '../api'
import { db } from '../../db'
import { listPositions } from '../../db/positions'
import { sleep } from './toolLoop'
import { searchWeb } from '../searchService'
import { backtestToolHandlers } from './toolHandlersBacktest'
import type { ToolContext } from './toolContext'
import {
  buildIndustryPerformanceFromScreening,
  compute4433Ranking,
  filterFundsByIndustry,
  type ScreeningLikeItem,
} from '../industryClassifier'

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
  ...backtestToolHandlers,
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

  get_concept_sectors: async (args) => {
    const rawLimit = Number(args.limit)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 10
    try {
      const res = await api.get(`/market/concept-sectors?limit=${limit}`)
      // 该路由的 data 是扁平数组（与 /market/sectors 一致），不是 {items: [...]}
      const body = (unpack(res) ?? {}) as Record<string, any>
      const items = Array.isArray(body.data) ? body.data : []
      return {
        data_status: items.length > 0 ? 'available' : 'unavailable',
        date: body.data_date ?? '',
        source: body.source ?? '',
        count: items.length,
        items,
        note: items.length > 0
          ? 'items 按当日涨跌幅降序；event 为同花顺概念简介的驱动事件，event_date 为数据源标注的事件日期（可能早于当日，不要当作行情日期）。'
          : (body.error || '概念板块数据本次未取到，请勿据此判断概念板块表现。'),
      }
    } catch (error) {
      return { data_status: 'error', items: [], count: 0, note: String(error) }
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

  get_portfolio_holdings: async () => {
    const rows = await listPositions()
    if (rows.length === 0) {
      return { holdings: [], total_cost: 0, message: '本地（IndexedDB）暂无持仓记录，请先在「估值与持仓 → 持仓管理」页添加持仓' }
    }
    const holdings = await Promise.all(
      rows.map(async (row) => {
        let nav: number | null = null
        try {
          const res = await api.get(`/funds/${row.fundCode}/estimate`)
          const d = unpack(res)?.data ?? unpack(res) ?? {}
          const value = Number(d.estimatedNav ?? d.nav)
          nav = Number.isFinite(value) && value > 0 ? value : null
        } catch {
          // fall back to the cost basis below
        }
        const marketValue = nav != null ? row.shares * nav : null
        return {
          fund_code: row.fundCode,
          fund_name: row.fundName ?? '',
          purchase_date: row.purchaseDate ?? '',
          shares: row.shares,
          cost: row.cost,
          nav,
          market_value: marketValue,
          cost_value: row.shares * row.cost,
        }
      }),
    )
    const totalCost = holdings.reduce((sum, h) => sum + h.cost_value, 0)
    const totalMarket = holdings.reduce((sum, h) => sum + (h.market_value ?? h.cost_value), 0)
    return {
      holdings: holdings.map((h) => ({
        ...h,
        market_value: h.market_value != null ? +h.market_value.toFixed(2) : null,
        weight_pct: totalMarket > 0 ? +((((h.market_value ?? h.cost_value) / totalMarket) * 100).toFixed(2)) : 0,
      })),
      total_cost: +totalCost.toFixed(2),
      total_market_value: +totalMarket.toFixed(2),
      count: holdings.length,
      note: '来自本地 IndexedDB 的**当前持仓**（权重按最新估值，估值失败时用成本价）。回测组合需另给目标权重。',
    }
  },

  screen_funds_by_4433: async () => {
    const items = await localScreeningItems()
    if (items.length === 0) return { funds: [], message: '暂未获取到基金数据，请稍后重试', method: '4433' }
    return { funds: compute4433Ranking(items), method: '4433', total_screened: items.length }
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
