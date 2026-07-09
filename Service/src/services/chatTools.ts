import { logger } from '../core/logger.js';
import { getFundBasic, getFundDetail, getFundEstimate, getFundNavHistory, getFundHoldings, getFundManagers, getFundScreeningSnapshot } from './fundService.js';
import { getMarketIndices, getMarketSectors, getMarketSectorsFromAkshare, getNorthFlow, getMarketBreadth, getMarketMoneyFlow, fetchGoldRealtime } from './marketService.js';
import { getStockReference } from './stockService.js';
import { getFlashNews } from './newsService.js';
import { runBacktest, runPython } from './pythonRunner.js';

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
      description: '获取东方财富概念板块实时行情，返回板块涨跌幅、指数点位、主力资金净流入等。',
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
  logger.info('chat tool call', { tool: name, args });
  try {
    return await handler(args);
  } catch (error) {
    logger.error('chat tool error', { tool: name, error: String(error) });
    return { error: String(error) };
  }
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
    const result = await getFundBasic(args.keyword as string);
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
    const result = await getMarketIndices();
    return toolData(result);
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

  get_concept_sectors: async (args) => {
    const limit = Math.min(Math.max((args.limit as number) || 10, 1), 50);
    const result = await getMarketSectors();
    const data = toolData(result) as unknown as Record<string, unknown>;
    const items = (data?.items as Array<Record<string, unknown>>) || [];
    items.sort((a, b) => {
      const ap = parseFloat(String(a.changePercent ?? 0));
      const bp = parseFloat(String(b.changePercent ?? 0));
      return bp - ap;
    });
    return items.slice(0, limit);
  },

  get_north_flow: async () => {
    const result = await getNorthFlow();
    return toolData(result);
  },

  get_market_breadth: async () => {
    const result = await getMarketBreadth();
    return toolData(result);
  },

  get_main_flow: async () => {
    const result = await getMarketMoneyFlow();
    return toolData(result);
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
    const result = await getFundScreeningSnapshot({});
    const data = toolData(result) as unknown as Record<string, unknown>;
    const items: Array<Record<string, unknown>> = data.items as Array<Record<string, unknown>> || [];
    const sorted = items
      .filter(f => f.return_1y !== null && f.return_1y !== undefined)
      .sort((a, b) => {
        const ra = parseFloat(String(b.return_1y ?? 0));
        const rb = parseFloat(String(a.return_1y ?? 0));
        return ra - rb;
      })
      .slice(0, 50);
    return sorted;
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
      const result = await runPython<Record<string, unknown>>('fetch_market.py', {
        args: ['--type', 'index'],
        timeoutMs: 30_000,
      });
      return result;
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
    const result = await getFundScreeningSnapshot({});
    const data = toolData(result) as unknown as Record<string, unknown>;
    const items: Array<Record<string, unknown>> = data.items as Array<Record<string, unknown>> || [];
    const kw = keyword.toLowerCase();
    const matched = items.filter(f => {
      const name = String(f.fund_name || f.name || '').toLowerCase();
      const code = String(f.fund_code || f.code || '');
      return name.includes(kw) || code.includes(kw);
    });
    return { funds: matched.slice(0, 30), total: matched.length };
  },

  get_industry_performance: async () => {
    const result = await getFundScreeningSnapshot({});
    const data = toolData(result) as unknown as Record<string, unknown>;
    const items: Array<Record<string, unknown>> = data.items as Array<Record<string, unknown>> || [];
    const byType: Record<string, { returns: number[]; count: number }> = {};
    for (const f of items) {
      const type = String(f.fund_type || '其他');
      if (!byType[type]) byType[type] = { returns: [], count: 0 };
      const r = parseFloat(String(f.return_1y ?? ''));
      if (!isNaN(r)) byType[type].returns.push(r);
      byType[type].count++;
    }
    const resultPayload: Array<Record<string, unknown>> = [];
    for (const [type, data] of Object.entries(byType)) {
      const sorted = data.returns.sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      resultPayload.push({
        industry: type,
        fund_count: data.count,
        median_return_1y: sorted.length > 0 ? sorted[mid] : null,
        positive_rate: data.returns.length > 0 ? (data.returns.filter(r => r > 0).length / data.returns.length * 100).toFixed(1) + '%' : null,
      });
    }
    return resultPayload;
  },
};
