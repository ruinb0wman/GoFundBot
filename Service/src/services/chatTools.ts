import { logger } from '../core/logger.js';
import { searchFunds, getFundDetail, getFundEstimate, getFundNavHistory, getFundHoldings, getFundManagers, getFundScreeningSnapshot } from './fundService.js';
import type { FundScreeningSnapshotItemDto } from '../types/fund.js';
import { fetchIndicesFromSina, getMarketSectorsFromAkshare, fetchGoldRealtime, getMarketIndices, getNorthFlow, getMarketBreadth, getMarketMoneyFlow } from './marketService.js';
import { getStockReference } from './stockService.js';
import { getFlashNews } from './newsService.js';
import { runBacktest } from './pythonRunner.js';
import { buildIndustryPerformanceFromScreening, filterFundsByIndustry, compute4433Ranking } from './chatIndustryTools.js';
import { searchWeb } from './searchService.js';

export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'search_funds',
      description: '根据关键字搜索基金代码和名称',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string', description: '基金名称或代码关键字' } },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fund_detail',
      description: '获取基金完整详情：基本信息、业绩、持仓、基金经理、风险指标等',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: '6位基金代码' } },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fund_estimate',
      description: '获取基金实时估值（盘中估算净值/涨跌幅）',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: '6位基金代码' } },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fund_nav_history',
      description: '获取基金历史净值数据',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '6位基金代码' },
          start_date: { type: 'string', description: '起始日期 YYYY-MM-DD（可选）' },
          end_date: { type: 'string', description: '结束日期 YYYY-MM-DD（可选）' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_indices',
      description: '获取主要股票市场指数实时行情（上证、深证、创业板等）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_news',
      description: '获取市场快讯新闻',
      parameters: {
        type: 'object',
        properties: { count: { type: 'integer', description: '新闻条数，默认20' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_hot_sectors',
      description: '获取热门行业板块实时行情（申万/同花顺分类），返回板块涨跌幅、领涨股、成交额等。不含概念板块。',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', description: '返回板块数量，默认10' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_concept_sectors',
      description: '获取概念板块行情，返回板块名称、驱动事件、成分股数量等概览数据。注意：不含个股涨跌幅。',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer', description: '返回板块数量，默认10，最大50' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_north_flow',
      description: '获取北向资金（沪股通+深股通）流向数据。必须检查 data_status 字段。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_breadth',
      description: '获取市场涨跌统计（上涨/下跌/涨停/跌停家数）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_main_flow',
      description: '获取主力资金流向（超大单/大单/中单/小单净流入）。必须检查 data_status 字段。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_flash_news',
      description: '获取快讯新闻',
      parameters: {
        type: 'object',
        properties: { count: { type: 'integer', description: '新闻条数，默认20' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_watchlist',
      description: '获取用户的基金自选列表',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screen_funds_by_4433',
      description: '按4433法则筛选符合条件的基金',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_backtest',
      description: '对指定基金运行定投回测模拟，对比不同周期和金额的收益表现',
      parameters: {
        type: 'object',
        properties: {
          fund_code: { type: 'string', description: '6位基金代码' },
          start_date: { type: 'string', description: '开始日期 YYYY-MM-DD' },
          end_date: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          amount: { type: 'number', description: '每期定投金额，默认1000' },
          investment_type: { type: 'string', description: '定投周期: monthly/weekly, 默认monthly' },
        },
        required: ['fund_code', 'start_date', 'end_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_strategy',
      description: '为指定基金推荐最优定投策略（MA均线/价值平均等方案对比）',
      parameters: {
        type: 'object',
        properties: { fund_code: { type: 'string', description: '6位基金代码' } },
        required: ['fund_code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stock_quote',
      description: '获取个股实时行情（价格、涨跌幅、成交量等）',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: '6位股票代码' } },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_anomaly',
      description: '检查市场异动（指数涨跌幅超过阈值）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_gold_realtime',
      description: '获取实时黄金价格',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fund_holdings',
      description: '获取基金重仓持股列表',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: '6位基金代码' } },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fund_managers',
      description: '获取基金经理信息',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: '6位基金代码' } },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_funds_by_industry',
      description: '根据行业/主题关键词查找相关基金。仅在用户明确提及具体行业/主题时调用。',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string', description: '行业/主题关键词' } },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_news',
      description: '通过网络搜索新闻、政策、行业动态，用于获取近期政策法规或行业新闻。'
        + ' 与快讯工具（get_market_news/get_flash_news）不同：快讯只返回今日实时消息，'
        + ' search_news 可搜索数天至一个月内的时间范围的网络信息。'
        + ' 使用场景：用户问"XX有什么政策"、"近期XX行业有什么新闻"、"XX新规"等。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，如"碳中和 政策"' },
          max_results: { type: 'integer', description: '最大结果数，默认5' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_industry_performance',
      description: '获取各行业板块的多周期业绩汇总——各行业中位收益、正收益基金占比、基金数量。',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const handler = toolHandlers[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      logger.info('chat tool call', { tool: name, args, attempt });
      return await handler(args);
    } catch (error) {
      if (attempt === maxRetries) {
        logger.error('chat tool error', { tool: name, error: String(error) });
        return { error: String(error) };
      }
      const msg = String(error).toLowerCase();
      const isRetryable = /timeout|econn|eaddrinuse|enotfound|spawn|reset|network|fetch.*failed/i.test(msg);
      if (!isRetryable) {
        logger.error('chat tool error (non-retryable)', { tool: name, error: String(error) });
        return { error: String(error) };
      }
      logger.warn('chat tool retry', { tool: name, attempt, error: String(error) });
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  throw new Error('unreachable');
}

function toolData<T>(result: { data: T } | T): T {
  return result && typeof result === 'object' && 'data' in result
    ? (result as { data: T }).data
    : (result as T);
}

function getDateRange(startDate?: string, endDate?: string): { startDate?: string; endDate?: string } {
  const range: { startDate?: string; endDate?: string } = {};
  if (startDate) range.startDate = startDate;
  if (endDate) range.endDate = endDate;
  return range;
}

const toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  search_funds: async (args) => {
    const result = await searchFunds(args.keyword as string);
    return toolData(result);
  },

  get_fund_detail: async (args) => {
    const result = await getFundDetail(args.code as string);
    return toolData(result);
  },

  get_fund_estimate: async (args) => {
    const result = await getFundEstimate(args.code as string);
    return toolData(result);
  },

  get_fund_nav_history: async (args) => {
    const result = await getFundNavHistory(
      args.code as string,
      getDateRange(args.start_date as string, args.end_date as string)
    );
    return toolData(result);
  },

  get_market_indices: async () => {
    return await fetchIndicesFromSina();
  },

  get_market_news: async (args) => {
    const count = (args.count as number) || 20;
    const result = await getFlashNews(count, 1);
    return toolData(result);
  },

  get_hot_sectors: async (args) => {
    const limit = (args.limit as number) || 10;
    const sectors = await getMarketSectorsFromAkshare(limit);
    return sectors;
  },

  get_concept_sectors: async () => {
    try {
      const result = await getMarketSectorsFromAkshare(50);
      return { data_status: 'available', items: result.items, count: result.items.length };
    } catch (error) {
      logger.error('get_concept_sectors error', { error: String(error) });
      return { data_status: 'error', items: [], note: String(error) };
    }
  },

  get_north_flow: async () => {
    try {
      const result = await getNorthFlow();
      const d = result.data;
      return {
        data_status: d.totalNetInflow != null ? 'available' : 'unavailable',
        date: d.date ?? '',
        sh_net_inflow: d.shNetInflow,
        sz_net_inflow: d.szNetInflow,
        total_net_inflow: d.totalNetInflow,
        sh_up_count: d.shUpCount,
        sh_down_count: d.shDownCount,
        sz_up_count: d.szUpCount,
        sz_down_count: d.szDownCount,
      };
    } catch (error) {
      logger.error('get_north_flow error', { error: String(error) });
      return { data_status: 'error', note: String(error) };
    }
  },

  get_market_breadth: async () => {
    try {
      const result = await getMarketBreadth();
      const d = result.data;
      return { data_status: d.total > 0 ? 'available' : 'unavailable', up_count: d.upCount, down_count: d.downCount, flat_count: d.flatCount, limit_up: d.limitUp, limit_down: d.limitDown, total: d.total };
    } catch (error) {
      logger.error('get_market_breadth error', { error: String(error) });
      return { data_status: 'error', up_count: 0, down_count: 0, flat_count: 0, limit_up: 0, limit_down: 0, total: 0, note: String(error) };
    }
  },

  get_main_flow: async () => {
    try {
      const result = await getMarketMoneyFlow();
      const d = result.data;
      return {
        data_status: d.date ? 'available' : 'unavailable',
        date: d.date ?? '',
        main_net_inflow: d.mainNetInflow,
        super_large_net_inflow: d.superLargeNetInflow,
        large_net_inflow: d.largeNetInflow,
        medium_net_inflow: d.mediumNetInflow,
        small_net_inflow: d.smallNetInflow,
      };
    } catch (error) {
      logger.error('get_main_flow error', { error: String(error) });
      return { data_status: 'error', note: String(error) };
    }
  },

  get_flash_news: async (args) => {
    const count = (args.count as number) || 20;
    const result = await getFlashNews(count, 1);
    return toolData(result);
  },

  get_watchlist: async () => {
    return { message: '自选列表信息存储在前端本地（IndexedDB），请在页面上查看和管理自选基金' };
  },

  screen_funds_by_4433: async () => {
    const result = await getFundScreeningSnapshot({ pageSize: 500 });
    const data = toolData(result) as { items?: FundScreeningSnapshotItemDto[] };
    const items = data?.items ?? [];
    if (items.length === 0) return { funds: [], message: '暂未获取到基金数据，请稍后重试', method: '4433' };
    return { funds: compute4433Ranking(items), method: '4433', total_screened: items.length };
  },

  run_backtest: async (args) => {
    const result = await runBacktest({
      fund_code: args.fund_code,
      start_date: args.start_date,
      end_date: args.end_date,
      amount: args.amount ?? 1000,
      investment_type: args.investment_type ?? 'monthly',
    });
    return result;
  },

  suggest_strategy: async (args) => {
    const result = await runBacktest({
      fund_code: args.fund_code,
      amount: 1000,
      investment_type: 'monthly',
    });
    return result;
  },

  get_stock_quote: async (args) => {
    const result = await getStockReference(args.code as string);
    return toolData(result);
  },

  get_market_anomaly: async () => {
    try {
      const result = await getMarketIndices();
      return { anomalies: [], indices: result.data.items };
    } catch (error) {
      return { anomalies: [], error: String(error) };
    }
  },

  get_gold_realtime: async () => {
    return await fetchGoldRealtime();
  },

  get_fund_holdings: async (args) => {
    const result = await getFundHoldings(args.code as string);
    return toolData(result);
  },

  get_fund_managers: async (args) => {
    const result = await getFundManagers(args.code as string);
    return toolData(result);
  },

  get_funds_by_industry: async (args) => {
    const keyword = args.keyword as string;
    try {
      const result = await getFundScreeningSnapshot({ pageSize: 500 });
      const data = toolData(result) as { items?: FundScreeningSnapshotItemDto[] };
      const items = data?.items ?? [];
      return filterFundsByIndustry(items, keyword);
    } catch (error) {
      logger.error('get_funds_by_industry error', { error: String(error) });
      return { funds: [], total: 0, message: `查询失败: ${String(error)}` };
    }
  },

  search_news: async (args) => {
    const query = args.query as string;
    const maxResults = (args.max_results as number) || 5;
    if (!query) return { error: 'query is required' };
    try {
      const result = await searchWeb(query, maxResults);
      if (result.success && result.results) {
        return { query, results: result.results, provider: result.provider ?? 'search' };
      }
      return { query, results: [], error: result.error ?? '搜索未返回结果' };
    } catch (error) {
      logger.error('search_news error', { error: String(error) });
      return { query, results: [], error: String(error) };
    }
  },
  get_industry_performance: async () => {
    try {
      const result = await getFundScreeningSnapshot({ pageSize: 500 });
      const data = toolData(result) as { items?: FundScreeningSnapshotItemDto[] };
      const items = data?.items ?? [];
      if (items.length === 0) return { items: [], summary: { total: 0 }, error: '暂未获取到基金数据，请稍后重试' };
      return buildIndustryPerformanceFromScreening(items);
    } catch (error) {
      logger.error('get_industry_performance error', { error: String(error) });
      return { items: [], summary: { total: 0 }, error: String(error) };
    }
  },
};
