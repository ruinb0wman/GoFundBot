/**
 * 基金与快讯类工具（只读）。
 *
 * `get_fund_detail` 会压缩时间序列：旧接口整包 ~1MB，其中 >99% 是序列
 * （rank_history 等），原样塞给模型会挤掉其它所有字段。
 */
import { z } from 'zod'
import { defineAgentTool, clampInt } from './types.js'
import { composeFundDetailLegacy } from '../services/fundService.js'
import {
  getFundEstimate,
  getFundHoldings,
  getFundManagers,
  getFundNavHistory,
  searchFunds,
} from '../services/fundService.js'
import { getFlashNews } from '../services/newsService.js'

const fundCode = z.string().regex(/^\d{6}$/).describe('6 位基金代码，例如 110022')

const SERIES_FIELDS = [
  'net_worth_trend',
  'accumulated_net_worth',
  'total_return_trend',
  'rank_history',
  'ranking_trend',
  'ranking_percentage',
] as const

type AnyVal = any

/** 每个序列只留首尾一条，其余用 count 表示。 */
export function summarizeSeries(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...detail }
  const summarized: string[] = []
  for (const key of SERIES_FIELDS) {
    const value = out[key]
    if (!Array.isArray(value) || value.length === 0) continue
    if (key === 'total_return_trend') {
      out[key] = value.map((series) => {
        const points = Array.isArray((series as AnyVal)?.data) ? (series as AnyVal).data : []
        return { name: (series as AnyVal)?.name ?? '', count: points.length, first: points[0], last: points[points.length - 1] }
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
  defineAgentTool({
    name: 'search_funds',
    label: '搜索基金',
    description: '按名称或代码关键字搜索基金，返回代码、名称、类型。',
    promptSnippet: 'search_funds(keyword): 按名称/代码关键字搜索基金',
    params: z.object({ keyword: z.string().describe('基金名称或代码关键字') }),
    readOnly: true,
    handler: async (args) => searchFunds(args.keyword),
  }),

  defineAgentTool({
    name: 'get_fund_detail',
    label: '获取基金详情',
    description:
      '获取单只基金的完整详情：净值走势、区间收益、同类排名、基金经理、重仓股、资产配置、持有人结构、规模变动、申赎信息、业绩评价。结果较大，只需要净值序列时改用 get_fund_nav_history。',
    promptSnippet: 'get_fund_detail(code): 完整基金详情（业绩/持仓/经理/配置）',
    params: z.object({ code: fundCode }),
    readOnly: true,
    handler: async (args) => summarizeSeries(await composeFundDetailLegacy(args.code)),
  }),

  defineAgentTool({
    name: 'get_fund_estimate',
    label: '获取基金估值',
    description: '获取基金盘中实时估值（估算净值、估算涨跌幅、估算时间）与最近单位净值。',
    promptSnippet: 'get_fund_estimate(code): 盘中实时估值',
    params: z.object({ code: fundCode }),
    readOnly: true,
    handler: async (args) => getFundEstimate(args.code),
  }),

  defineAgentTool({
    name: 'get_fund_nav_history',
    label: '获取净值历史',
    description: '获取基金历史净值序列（单位净值、累计净值）。可用于计算回撤、波动、区间收益。',
    promptSnippet: 'get_fund_nav_history(code, start_date?, end_date?): 历史净值',
    params: z.object({
      code: fundCode,
      start_date: z.string().optional().describe('起始日期 YYYY-MM-DD（可选）'),
      end_date: z.string().optional().describe('结束日期 YYYY-MM-DD（可选）'),
    }),
    readOnly: true,
    handler: async (args) =>
      getFundNavHistory(args.code, { startDate: args.start_date, endDate: args.end_date }),
  }),

  defineAgentTool({
    name: 'get_fund_holdings',
    label: '获取基金重仓股',
    description: '获取基金重仓持股列表（股票代码、名称、占净值比例）。',
    promptSnippet: 'get_fund_holdings(code): 重仓持股',
    params: z.object({ code: fundCode }),
    readOnly: true,
    handler: async (args) => getFundHoldings(args.code),
  }),

  defineAgentTool({
    name: 'get_fund_managers',
    label: '获取基金经理',
    description: '获取基金经理信息（从业年限、管理规模、任职时间、能力评估、历史业绩）。',
    promptSnippet: 'get_fund_managers(code): 基金经理信息',
    params: z.object({ code: fundCode }),
    readOnly: true,
    handler: async (args) => getFundManagers(args.code),
  }),

  defineAgentTool({
    name: 'get_flash_news',
    label: '获取快讯新闻',
    description: '获取市场 7×24 快讯（多数据源合并去重后的今日实时消息）。',
    promptSnippet: 'get_flash_news(count?): 今日 7×24 快讯',
    params: z.object({ count: z.number().int().min(1).max(300).optional().describe('新闻条数，默认 20，最大 300') }),
    readOnly: true,
    handler: async (args) => getFlashNews(clampInt(args.count, 20, 1, 300), 1),
  }),
]
