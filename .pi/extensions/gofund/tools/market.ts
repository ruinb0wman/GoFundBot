/**
 * Market data tools (read-only).
 *
 * Endpoints:
 *   get_market_indices    GET /api/market/indices             (sendSuccess)
 *   get_index_kline       GET /api/market/kline/:symbol       (sendSuccess; params startDate/endDate/period)
 *   get_hot_sectors       GET /api/market/sectors?limit=      (raw envelope)
 *   get_concept_sectors   GET /api/market/concept-sectors?limit= (raw envelope, flat data array)
 *   get_north_flow        GET /api/market/north-flow          (sendSuccess)
 *   get_market_breadth    GET /api/market/breadth             (sendSuccess)
 *   get_main_flow         GET /api/market/money-flow          (sendSuccess)
 *   get_gold_realtime     GET /api/market/gold/realtime       (raw envelope)
 *
 * Four tools re-shape the response so the model cannot misread the data:
 * north flow (net inflow is permanently null; only deal amount is valid),
 * breadth (limit_up/down may be null), concept sectors (flat array + event-date
 * semantics), main flow (empty date means unavailable). The mappings are copied
 * from `frontend/src/services/chatEngine/toolHandlers.ts`, which encodes several
 * hard-won data-source lessons (see AGENTS.md "Known issues").
 */

import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { apiGet, apiGetData, clampInt, jsonResult } from '../client.ts'

type AnyVal = any

/** 北向成交总额 → 亿元。DEAL_AMT 单位是百万元，所以除以 100 而不是 10000。 */
function toYi(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? +(value / 100).toFixed(2) : null
}

const limitParam = (description: string) => Type.Optional(Type.Integer({ description }))

export const marketTools = [
  defineTool({
    name: 'get_market_indices',
    label: '获取指数行情',
    description: '获取主要股指实时行情（上证、深证、创业板、沪深300、科创50、恒生等）。',
    promptSnippet: 'get_market_indices(): 主要指数实时行情',
    parameters: Type.Object({}),
    async execute(_toolCallId) {
      const data = await apiGetData('/api/market/indices')
      return jsonResult(data, '/api/market/indices')
    },
  }),

  defineTool({
    name: 'get_index_kline',
    label: '获取指数K线',
    description:
      '获取指数历史 K 线（日/周/月），用于分析历史走势、回撤幅度与修复时间。'
      + 'A 股用 sh/sz 前缀：sh000001（上证）、sz399001（深证）、sh000300（沪深300）、sz399006（创业板）、sh000688（科创50）；'
      + '海外指数用代码且不加 ^：DJI（道琼斯）、SPX（标普500）、NDX（纳斯达克100）、HSI（恒生）、N225、FTSE、GDAXI、FCHI、SENSEX。'
      + '海外指数走 Yahoo，可能较慢；其 date 字段为 YYYYMMDD。起始与结束日期必须同时提供。',
    promptSnippet: 'get_index_kline(code, start_date, end_date, period?): 指数历史K线（A股 sh/sz 或海外 DJI/HSI）',
    parameters: Type.Object({
      code: Type.String({
        description: '指数代码：A 股 sh000300 / sz399006；海外 DJI / SPX / HSI（不要加 ^ 前缀）',
      }),
      start_date: Type.String({ description: '起始日期 YYYY-MM-DD（必填）' }),
      end_date: Type.String({ description: '结束日期 YYYY-MM-DD（必填）' }),
      period: Type.Optional(
        Type.Union([Type.Literal('daily'), Type.Literal('weekly'), Type.Literal('monthly')], {
          description: 'K 线周期，默认 daily',
        })
      ),
    }),
    async execute(_toolCallId, params) {
      const data = await apiGetData(`/api/market/kline/${encodeURIComponent(params.code)}`, {
        startDate: params.start_date,
        endDate: params.end_date,
        period: params.period ?? 'daily',
      })
      const items = Array.isArray(data) ? data : ((data as AnyVal)?.items ?? [])
      return jsonResult(
        {
          code: params.code,
          start_date: params.start_date,
          end_date: params.end_date,
          kline: items,
          count: items.length,
        },
        `/api/market/kline/${params.code}`
      )
    },
  }),

  defineTool({
    name: 'get_hot_sectors',
    label: '获取行业板块',
    description:
      '获取行业板块实时行情（同花顺行业分类，按涨跌幅降序）：涨跌幅、主力净流入、换手率。数据源降级时 code 可能为空串，此时成分股接口不可用。概念板块请用 get_concept_sectors。',
    promptSnippet: 'get_hot_sectors(limit?): 行业板块实时行情',
    parameters: Type.Object({
      limit: limitParam('返回板块数量，默认 10，最大 120'),
    }),
    async execute(_toolCallId, params) {
      const body = (await apiGet('/api/market/sectors', { limit: clampInt(params.limit, 10, 1, 120) })) as AnyVal
      return jsonResult(body, '/api/market/sectors')
    },
  }),

  defineTool({
    name: 'get_concept_sectors',
    label: '获取概念板块',
    description:
      '获取概念板块行情（同花顺资金流，按当日涨跌幅降序）：板块涨跌幅、主力净流入、成分股数量、领涨股，以及同花顺概念简介的驱动事件 event。注意 event_date 是数据源标注的事件日期，可能早于当日，不要当作行情日期；data_status 为 unavailable 时不要编造概念板块表现。',
    promptSnippet: 'get_concept_sectors(limit?): 概念板块行情（涨跌幅/净流入/驱动事件）',
    parameters: Type.Object({
      limit: limitParam('返回板块数量，默认 10，最大 50'),
    }),
    async execute(_toolCallId, params) {
      const body = (await apiGet('/api/market/concept-sectors', {
        limit: clampInt(params.limit, 10, 1, 50),
      })) as AnyVal
      // 该路由的 data 是扁平数组（与 /market/sectors 同款信封）。
      const items = Array.isArray(body?.data) ? body.data : []
      return jsonResult(
        {
          data_status: items.length > 0 ? 'available' : 'unavailable',
          date: body?.data_date ?? '',
          source: body?.source ?? '',
          count: items.length,
          items,
          note:
            items.length > 0
              ? 'items 按当日涨跌幅降序；event 为同花顺概念简介的驱动事件，event_date 为数据源标注的事件日期（可能早于当日，不要当作行情日期）。'
              : body?.error || '概念板块数据本次未取到，请勿据此判断概念板块表现。',
        },
        '/api/market/concept-sectors'
      )
    },
  }),

  defineTool({
    name: 'get_north_flow',
    label: '获取北向资金',
    description:
      '获取北向资金数据。注意：自 2024-08-19 起沪深港通不再披露北向资金净流入，data_status 恒为 unavailable，*_net_inflow 恒为 null；可用的是当日成交总额（*_deal_amount_yi，单位亿元）。必须先阅读 note 字段再作答，不要把 null 解读为 0。',
    promptSnippet: 'get_north_flow(): 北向资金成交总额（净流入已停止披露）',
    parameters: Type.Object({}),
    async execute(_toolCallId) {
      const body = (await apiGet('/api/market/north-flow')) as AnyVal
      const d = (body?.data ?? body ?? {}) as Record<string, unknown>
      const hasDealAmount = d.totalDealAmount != null
      return jsonResult(
        {
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
        },
        '/api/market/north-flow'
      )
    },
  }),

  defineTool({
    name: 'get_market_breadth',
    label: '获取涨跌统计',
    description:
      '获取市场涨跌统计：沪深两市合计的上涨/下跌/平盘家数（scope 字段标注口径），以及涨停/跌停家数（limit_up/limit_down 可能为 null，不代表 0）。',
    promptSnippet: 'get_market_breadth(): 沪深两市涨跌家数 + 涨跌停家数',
    parameters: Type.Object({}),
    async execute(_toolCallId) {
      const body = (await apiGet('/api/market/breadth')) as AnyVal
      const d = (body?.data ?? body ?? {}) as Record<string, unknown>
      const hasLimitCounts = d.limitUp != null || d.limitDown != null
      const total = Number(d.total ?? 0)
      return jsonResult(
        {
          data_status: total > 0 ? 'available' : 'unavailable',
          scope: d.scope ?? '沪深两市',
          date: d.date ?? '',
          up_count: d.upCount,
          down_count: d.downCount,
          flat_count: d.flatCount,
          limit_up: d.limitUp ?? null,
          limit_down: d.limitDown ?? null,
          total: d.total,
          note:
            total > 0
              ? hasLimitCounts
                ? undefined
                : '涨停/跌停家数本次未取到，仅涨跌家数有效'
              : '涨跌家数本次未取到（数据源异常或尚未更新），请勿据此判断市场涨跌结构',
        },
        '/api/market/breadth'
      )
    },
  }),

  defineTool({
    name: 'get_main_flow',
    label: '获取主力资金',
    description:
      '获取沪深两市主力资金流向（超大单/大单/中单/小单净流入）。必须检查 data_status，unavailable 时不要编造数值。',
    promptSnippet: 'get_main_flow(): 主力资金分单规模净流入',
    parameters: Type.Object({}),
    async execute(_toolCallId) {
      const d = (await apiGetData('/api/market/money-flow')) as Record<string, unknown>
      return jsonResult(
        {
          data_status: d.date ? 'available' : 'unavailable',
          date: d.date ?? '',
          main_net_inflow: d.mainNetInflow,
          super_large_net_inflow: d.superLargeNetInflow,
          large_net_inflow: d.largeNetInflow,
          medium_net_inflow: d.mediumNetInflow,
          small_net_inflow: d.smallNetInflow,
        },
        '/api/market/money-flow'
      )
    },
  }),

  defineTool({
    name: 'get_gold_realtime',
    label: '获取贵金属报价',
    description: '获取贵金属实时报价（黄金 T+D、国际黄金、国际白银）：最新价、涨跌额、涨跌幅、开高低收、单位。',
    promptSnippet: 'get_gold_realtime(): 贵金属实时报价',
    parameters: Type.Object({}),
    async execute(_toolCallId) {
      const body = (await apiGet('/api/market/gold/realtime')) as AnyVal
      return jsonResult(body, '/api/market/gold/realtime')
    },
  }),
]
