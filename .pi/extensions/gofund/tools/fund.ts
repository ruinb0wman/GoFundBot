/**
 * Fund data tools (read-only).
 *
 * Endpoints:
 *   search_funds         GET /api/fund/search?q=          (legacy route, data = [{CODE,NAME,TYPE,PINYIN}])
 *   get_fund_detail      GET /api/fund/:code              (legacy aggregate: chart + performance + holdings + managers)
 *   get_fund_estimate    GET /api/funds/:code/estimate
 *   get_fund_nav_history GET /api/funds/:code/nav-history (params startDate/endDate)
 *   get_fund_holdings    GET /api/funds/:code/holdings
 *   get_fund_managers    GET /api/funds/:code/managers
 */

import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { apiGetData, jsonResult } from '../client.ts'

const fundCode = Type.String({ description: '6 位基金代码，例如 110022', pattern: '^\\d{6}$' })
const optionalDate = (description: string) => Type.Optional(Type.String({ description }))

type AnyVal = any

/**
 * The legacy detail route returns ~1 MB, and >99% of it is time series
 * (rank_history ~300k, the NAV/return/ranking arrays ~150-170k each). Sending
 * that verbatim blows the result cap and hides every other section, so keep the
 * first/last point of each series and point at get_fund_nav_history instead.
 */
const SERIES_FIELDS = [
  'net_worth_trend',
  'accumulated_net_worth',
  'total_return_trend',
  'rank_history',
  'ranking_trend',
  'ranking_percentage',
] as const

function summarizeSeries(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...detail }
  const summarized: string[] = []
  for (const key of SERIES_FIELDS) {
    const value = out[key]
    if (!Array.isArray(value) || value.length === 0) continue
    if (key === 'total_return_trend') {
      // [{ name, data: [[timestamp, value], ...] }, ...] — keep one line per series.
      out[key] = value.map((series) => {
        const points = Array.isArray((series as AnyVal)?.data) ? (series as AnyVal).data : []
        return {
          name: (series as AnyVal)?.name ?? '',
          count: points.length,
          first: points[0],
          last: points[points.length - 1],
        }
      })
      summarized.push(key)
      continue
    }
    if (value.length <= 2) continue
    out[key] = { count: value.length, first: value[0], last: value[value.length - 1] }
    summarized.push(key)
  }
  if (summarized.length > 0) {
    out._series_note =
      `为控制体积，以下时间序列只保留了首尾各一条：${summarized.join(', ')}。` +
      `完整净值序列请用 get_fund_nav_history(code, start_date, end_date)。`
  }
  return out
}

export const fundTools = [
  defineTool({
    name: 'search_funds',
    label: '搜索基金',
    description: '按名称或代码关键字搜索基金，返回代码、名称、类型。',
    promptSnippet: 'search_funds(keyword): 按名称/代码关键字搜索基金',
    parameters: Type.Object({
      keyword: Type.String({ description: '基金名称或代码关键字' }),
    }),
    async execute(_toolCallId, params) {
      const data = await apiGetData('/api/fund/search', { q: params.keyword })
      return jsonResult(data, '/api/fund/search')
    },
  }),

  defineTool({
    name: 'get_fund_detail',
    label: '获取基金详情',
    description:
      '获取单只基金的完整详情：净值走势、区间收益、同类排名、基金经理、重仓股、资产配置、持有人结构、规模变动、申赎信息、业绩评价。结果较大，只需要净值序列时改用 get_fund_nav_history。',
    promptSnippet: 'get_fund_detail(code): 完整基金详情（业绩/持仓/经理/配置）',
    parameters: Type.Object({
      code: fundCode,
    }),
    async execute(_toolCallId, params) {
      const data = await apiGetData(`/api/fund/${encodeURIComponent(params.code)}`)
      const detail = data && typeof data === 'object' ? summarizeSeries(data as Record<string, unknown>) : data
      return jsonResult(detail, `/api/fund/${params.code}`)
    },
  }),

  defineTool({
    name: 'get_fund_estimate',
    label: '获取基金估值',
    description: '获取基金盘中实时估值（估算净值、估算涨跌幅、估算时间）与最近单位净值。',
    promptSnippet: 'get_fund_estimate(code): 盘中实时估值',
    parameters: Type.Object({
      code: fundCode,
    }),
    async execute(_toolCallId, params) {
      const data = await apiGetData(`/api/funds/${encodeURIComponent(params.code)}/estimate`)
      return jsonResult(data, `/api/funds/${params.code}/estimate`)
    },
  }),

  defineTool({
    name: 'get_fund_nav_history',
    label: '获取净值历史',
    description: '获取基金历史净值序列（单位净值、累计净值）。可用于计算回撤、波动、区间收益。',
    promptSnippet: 'get_fund_nav_history(code, start_date?, end_date?): 历史净值',
    parameters: Type.Object({
      code: fundCode,
      start_date: optionalDate('起始日期 YYYY-MM-DD（可选）'),
      end_date: optionalDate('结束日期 YYYY-MM-DD（可选）'),
    }),
    async execute(_toolCallId, params) {
      const data = await apiGetData(`/api/funds/${encodeURIComponent(params.code)}/nav-history`, {
        startDate: params.start_date,
        endDate: params.end_date,
      })
      return jsonResult(data, `/api/funds/${params.code}/nav-history`)
    },
  }),

  defineTool({
    name: 'get_fund_holdings',
    label: '获取基金重仓股',
    description: '获取基金重仓持股列表（股票代码、名称、占净值比例）。',
    promptSnippet: 'get_fund_holdings(code): 重仓持股',
    parameters: Type.Object({
      code: fundCode,
    }),
    async execute(_toolCallId, params) {
      const data = await apiGetData(`/api/funds/${encodeURIComponent(params.code)}/holdings`)
      return jsonResult(data, `/api/funds/${params.code}/holdings`)
    },
  }),

  defineTool({
    name: 'get_fund_managers',
    label: '获取基金经理',
    description: '获取基金经理信息（从业年限、管理规模、任职时间、能力评估、历史业绩）。',
    promptSnippet: 'get_fund_managers(code): 基金经理信息',
    parameters: Type.Object({
      code: fundCode,
    }),
    async execute(_toolCallId, params) {
      const data = await apiGetData(`/api/funds/${encodeURIComponent(params.code)}/managers`)
      return jsonResult(data, `/api/funds/${params.code}/managers`)
    },
  }),
]
