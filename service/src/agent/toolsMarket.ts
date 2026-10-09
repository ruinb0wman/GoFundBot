/**
 * 市场类工具（只读）。口径与踩坑说明的原版在 `.pi/extensions/gofund/tools/market.ts`
 * 与 `frontend/src/services/chatEngine/toolHandlers.ts`（后者随前端 AI 删除，见 AGENTS.md「Known issues」）。
 */
import { z } from 'zod'
import { defineAgentTool, unwrapServiceResult, toYi } from './types.js'
import {
  fetchGoldRealtime,
  getAVolume7Days,
  getMarketBreadth,
  getMarketConceptSectorsFromAkshare,
  getMarketIndices,
  getMarketKline,
  getMarketMoneyFlow,
  getMarketSectorConstituents,
  getMarketSectorsFromAkshare,
  getNorthFlow,
} from '../services/marketService.js'

const limit = (description: string) => z.number().int().min(1).max(120).optional().describe(description)

export const marketTools = [
  defineAgentTool({
    name: 'get_market_indices',
    label: '获取指数行情',
    description: '获取主要股指实时行情（上证、深证、创业板、沪深300、科创50、恒生等）。',
    promptSnippet: 'get_market_indices(): 主要指数实时行情',
    params: z.object({}),
    readOnly: true,
    handler: async () => getMarketIndices(),
  }),

  defineAgentTool({
    name: 'get_index_kline',
    label: '获取指数K线',
    description:
      '获取指数历史 K 线（日/周/月），用于分析历史走势、回撤幅度与修复时间。'
      + 'A 股用 sh/sz 前缀：sh000001（上证）、sz399001（深证）、sh000300（沪深300）、sz399006（创业板）、sh000688（科创50）；'
      + '海外指数用代码且不加 ^：DJI（道琼斯）、SPX（标普500）、NDX（纳斯达克100）、HSI（恒生）、N225、FTSE、GDAXI、FCHI、SENSEX；'
      + '加密货币用 BTC / ETH / SOL / BNB。美股/港股指数走腾讯源，秒回；日经/欧股/印度等腾讯未收录的走 Yahoo 兜底，'
      + '当前网络下常取不到（返回空 kline，不是 0）。其 date 字段为 YYYYMMDD。起始与结束日期必须同时提供。'
      + '**A 股个股请用 `get_stock_kline`**（本工具按指数口径包装，个股也能传但不推荐）。',
    promptSnippet: 'get_index_kline(code, start_date, end_date, period?): 指数历史K线（A股 sh/sz 或海外 DJI/HSI）',
    params: z.object({
      code: z
        .string()
        .describe('指数代码：A 股 sh000300 / sz399006；海外 DJI / SPX / HSI（不要加 ^ 前缀）'),
      start_date: z.string().describe('起始日期 YYYY-MM-DD（必填）'),
      end_date: z.string().describe('结束日期 YYYY-MM-DD（必填）'),
      period: z.enum(['daily', 'weekly', 'monthly']).optional().describe('K 线周期，默认 daily'),
    }),
    readOnly: true,
    async handler(args) {
      // `getMarketKline` 返回 ServiceResult<KlineDto[]> —— 必须走 unwrapServiceResult，
      // 否则拿到的是信封对象，`data?.items` 恒为 undefined（曾经返回空 K 线）。
      const items = unwrapServiceResult(
        await getMarketKline(args.code, {
          startDate: args.start_date,
          endDate: args.end_date,
          period: args.period ?? 'daily',
        })
      )
      return {
        code: args.code,
        start_date: args.start_date,
        end_date: args.end_date,
        kline: items,
        count: items.length,
      }
    },
  }),

  defineAgentTool({
    name: 'get_hot_sectors',
    label: '获取行业板块',
    description:
      '获取行业板块实时行情（同花顺行业分类，按涨跌幅降序）：涨跌幅、主力净流入、换手率。数据源降级时 code 可能为空串，此时成分股接口不可用。概念板块请用 get_concept_sectors。',
    promptSnippet: 'get_hot_sectors(limit?): 行业板块实时行情',
    params: z.object({ limit: limit('返回板块数量，默认 10，最大 120') }),
    readOnly: true,
    handler: async (args) => getMarketSectorsFromAkshare(args.limit ?? 10),
  }),

  defineAgentTool({
    name: 'get_concept_sectors',
    label: '获取概念板块',
    description:
      '获取概念板块行情（同花顺资金流，按当日涨跌幅降序）：板块涨跌幅、主力净流入、成分股数量、领涨股，以及同花顺概念简介的驱动事件 event。注意 event_date 是数据源标注的事件日期，可能早于当日，不要当作行情日期；data_status 为 unavailable 时不要编造概念板块表现。',
    promptSnippet: 'get_concept_sectors(limit?): 概念板块行情（涨跌幅/净流入/驱动事件）',
    params: z.object({ limit: limit('返回板块数量，默认 10，最大 50') }),
    readOnly: true,
    async handler(args) {
      const body = (unwrapServiceResult(await getMarketConceptSectorsFromAkshare(args.limit ?? 10)) ?? {}) as unknown as Record<string, unknown>
      // 该路由的 data 是扁平数组（与 /market/sectors 同款信封）。
      const items = Array.isArray(body?.data) ? body.data : []
      return {
        data_status: items.length > 0 ? 'available' : 'unavailable',
        date: body?.data_date ?? '',
        source: body?.source ?? '',
        count: items.length,
        items,
        note:
          items.length > 0
            ? 'items 按当日涨跌幅降序；event 为同花顺概念简介的驱动事件，event_date 为数据源标注的事件日期（可能早于当日，不要当作行情日期）。'
            : body?.error || '概念板块数据本次未取到，请勿据此判断概念板块表现。',
      }
    },
  }),

  defineAgentTool({
    name: 'get_north_flow',
    label: '获取北向资金',
    description:
      '获取北向资金数据。注意：自 2024-08-19 起沪深港通不再披露北向资金净流入，data_status 恒为 unavailable，*_net_inflow 恒为 null；可用的是当日成交总额（*_deal_amount_yi，单位亿元）。必须先阅读 note 字段再作答，不要把 null 解读为 0。',
    promptSnippet: 'get_north_flow(): 北向资金成交总额（净流入已停止披露）',
    params: z.object({}),
    readOnly: true,
    async handler() {
      const d = (unwrapServiceResult(await getNorthFlow()) ?? {}) as unknown as Record<string, unknown>
      const hasDealAmount = d.totalDealAmount != null
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
    },
  }),

  defineAgentTool({
    name: 'get_market_breadth',
    label: '获取涨跌统计',
    description:
      '获取市场涨跌统计：沪深两市合计的上涨/下跌/平盘家数（scope 字段标注口径），以及涨停/跌停家数（limit_up/limit_down 可能为 null，不代表 0）。',
    promptSnippet: 'get_market_breadth(): 沪深两市涨跌家数 + 涨跌停家数',
    params: z.object({}),
    readOnly: true,
    async handler() {
      const d = (unwrapServiceResult(await getMarketBreadth()) ?? {}) as unknown as Record<string, unknown>
      const hasLimitCounts = d.limitUp != null || d.limitDown != null
      // service 是权威（DTO 自带 data_status），这里只保留一个兼容回退
      const total = Number(d.total ?? 0)
      const dataStatus =
        d.data_status === 'available' || d.data_status === 'unavailable'
          ? d.data_status
          : total > 0
            ? 'available'
            : 'unavailable'
      return {
        data_status: dataStatus,
        scope: d.scope ?? '沪深两市',
        date: d.date ?? '',
        up_count: d.upCount,
        down_count: d.downCount,
        flat_count: d.flatCount,
        limit_up: d.limitUp ?? null,
        limit_down: d.limitDown ?? null,
        total: d.total,
        note:
          dataStatus === 'available'
            ? hasLimitCounts
              ? undefined
              : '涨停/跌停家数本次未取到，仅涨跌家数有效'
            : d.error
              ? `涨跌家数本次未取到：${String(d.error)}`
              : '涨跌家数本次未取到（数据源异常或尚未更新），请勿据此判断市场涨跌结构',
      }
    },
  }),

  defineAgentTool({
    name: 'get_main_flow',
    label: '获取主力资金',
    description:
      '获取沪深两市主力资金流向（超大单/大单/中单/小单净流入）。必须检查 data_status，unavailable 时不要编造数值。',
    promptSnippet: 'get_main_flow(): 主力资金分单规模净流入',
    params: z.object({}),
    readOnly: true,
    async handler() {
      const d = (unwrapServiceResult(await getMarketMoneyFlow()) ?? {}) as unknown as Record<string, unknown>
      return {
        data_status: d.date ? 'available' : 'unavailable',
        date: d.date ?? '',
        main_net_inflow: d.mainNetInflow,
        super_large_net_inflow: d.superLargeNetInflow,
        large_net_inflow: d.largeNetInflow,
        medium_net_inflow: d.mediumNetInflow,
        small_net_inflow: d.smallNetInflow,
      }
    },
  }),

  defineAgentTool({
    name: 'get_gold_realtime',
    label: '获取贵金属报价',
    description: '获取贵金属实时报价（黄金 T+D、国际黄金、国际白银）：最新价、涨跌额、涨跌幅、开高低收、单位。',
    promptSnippet: 'get_gold_realtime(): 贵金属实时报价',
    params: z.object({}),
    readOnly: true,
    handler: async () => fetchGoldRealtime(),
  }),

  defineAgentTool({
    name: 'get_stock_kline',
    label: '个股K线',
    description:
      '获取 A 股个股历史 K 线（日/周/月，可选前/后复权）：涨跌幅、开高低收、成交量额。'
      + '代码写 `sh600519` / `sz000001`，或直接写 6 位代码（自动补前缀）。'
      + '指数走势用 `get_index_kline`；海外/加密标的也能传，但本工具按 A 股口径描述。',
    promptSnippet: 'get_stock_kline(code, start_date, end_date, period?, adjust?): 个股K线',
    params: z.object({
      code: z.string().describe('A 股代码：sh600519 / sz000001 / 600519'),
      start_date: z.string().describe('起始日期 YYYY-MM-DD（必填）'),
      end_date: z.string().describe('结束日期 YYYY-MM-DD（必填）'),
      period: z.enum(['daily', 'weekly', 'monthly']).optional().describe('K 线周期，默认 daily'),
      adjust: z.enum(['none', 'qfq', 'hfq']).optional().describe('复权：none 不复权 / qfq 前复权 / hfq 后复权（默认 none）'),
    }),
    readOnly: true,
    async handler(args) {
      const items = unwrapServiceResult(
        await getMarketKline(args.code, {
          startDate: args.start_date,
          endDate: args.end_date,
          period: args.period ?? 'daily',
          adjust: args.adjust ?? 'none',
        })
      )
      return {
        code: args.code,
        start_date: args.start_date,
        end_date: args.end_date,
        adjust: args.adjust ?? 'none',
        kline: items,
        count: items.length,
      }
    },
  }),

  defineAgentTool({
    name: 'get_a_volume_7days',
    label: '近7日A股成交量',
    description:
      '获取沪深两市最近 7 个交易日的成交额（亿元）。**必须看 `success`**：取不到数据时 `success: false` 且 `data: []`，'
      + '不要把它当成「成交额 0」。指数 K 线失败也会导致这里为空。',
    promptSnippet: 'get_a_volume_7days(): 近7日A股成交额',
    params: z.object({}),
    readOnly: true,
    async handler() {
      const result = await getAVolume7Days()
      return {
        data_status: result.success && result.data.length > 0 ? 'available' : 'unavailable',
        update_time: result.update_time,
        note: result.data.length === 0 ? '未取到成交量数据（不是 0）' : undefined,
        data: result.data,
      }
    },
  }),

  defineAgentTool({
    name: 'get_sector_constituents',
    label: '板块成分股',
    description:
      '获取某个行业板块的成分股列表（代码、名称、涨跌幅、成交额等）。`sector_code` 来自 `get_hot_sectors`。'
      + '**两个已知限制**：① 行业板块走同花顺降级时 `code` 是空串，此时无法使用；'
      + '② 上游是 eastmoney 的板块成分股接口，被反爬封锁时整条链路不可用（返回 `PROVIDER_UNAVAILABLE`）——'
      + '遇到这两种情况就如实告知用户，**不要编造成分股**。',
    promptSnippet: 'get_sector_constituents(sector_code): 板块成分股',
    params: z.object({
      sector_code: z.string().min(1).describe('板块代码（来自 get_hot_sectors 的 code；空串表示该数据源不支持）'),
    }),
    readOnly: true,
    async handler(args) {
      if (!args.sector_code.trim()) {
        return { data_status: 'unavailable', note: '板块 code 为空（同花顺降级数据没有 code），无法查成分股。' }
      }
      const data = unwrapServiceResult(await getMarketSectorConstituents(args.sector_code))
      return {
        data_status: data.items.length > 0 ? 'available' : 'unavailable',
        sector_code: data.sectorCode,
        sector_name: data.sectorName,
        count: data.items.length,
        items: data.items,
      }
    },
  }),
]
