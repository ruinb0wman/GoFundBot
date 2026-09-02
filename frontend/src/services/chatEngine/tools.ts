/**
 * Chat tool definitions (frontend). Ported from Service `chatTools.ts`.
 * Definitions only; handlers live in toolHandlers.ts.
 */

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
      parameters: { type: 'object', properties: { keyword: { type: 'string', description: '基金名称或代码关键字' } }, required: ['keyword'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fund_detail',
      description: '获取基金完整详情：基本信息、业绩、持仓、基金经理、风险指标等',
      parameters: { type: 'object', properties: { code: { type: 'string', description: '6位基金代码' } }, required: ['code'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fund_estimate',
      description: '获取基金实时估值（盘中估算净值/涨跌幅）',
      parameters: { type: 'object', properties: { code: { type: 'string', description: '6位基金代码' } }, required: ['code'] },
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
      parameters: { type: 'object', properties: { count: { type: 'integer', description: '新闻条数，默认20' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_hot_sectors',
      description: '获取热门行业板块实时行情（申万/同花顺分类），返回板块涨跌幅、领涨股、成交额等。不含概念板块。',
      parameters: { type: 'object', properties: { limit: { type: 'integer', description: '返回板块数量，默认10' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_concept_sectors',
      description: '获取概念板块行情，返回板块名称、驱动事件、成分股数量等概览数据。注意：不含个股涨跌幅。',
      parameters: { type: 'object', properties: { limit: { type: 'integer', description: '返回板块数量，默认10，最大50' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_north_flow',
      description: '获取北向资金（沪股通+深股通）流向数据。必须检查 data_status 字段，unavailable 时需查看 note 字段说明原因。',
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
      description: '获取主力资金流向（超大单/大单/中单/小单净流入）。必须检查 data_status 字段，unavailable 时需查看 note 字段说明原因。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_flash_news',
      description: '获取快讯新闻',
      parameters: { type: 'object', properties: { count: { type: 'integer', description: '新闻条数，默认20' } } },
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
      parameters: { type: 'object', properties: { fund_code: { type: 'string', description: '6位基金代码' } }, required: ['fund_code'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stock_quote',
      description: '获取个股实时行情（价格、涨跌幅、成交量等）',
      parameters: { type: 'object', properties: { code: { type: 'string', description: '6位股票代码' } }, required: ['code'] },
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
      parameters: { type: 'object', properties: { code: { type: 'string', description: '6位基金代码' } }, required: ['code'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fund_managers',
      description: '获取基金经理信息',
      parameters: { type: 'object', properties: { code: { type: 'string', description: '6位基金代码' } }, required: ['code'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_funds_by_industry',
      description: '根据行业/主题关键词查找相关基金。仅在用户明确提及具体行业/主题时调用。',
      parameters: { type: 'object', properties: { keyword: { type: 'string', description: '行业/主题关键词' } }, required: ['keyword'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_news',
      description: '通过网络搜索新闻、政策、行业动态，用于获取近期政策法规或行业新闻。'
        + ' 与快讯工具（get_market_news/get_flash_news）不同：快讯只返回今日实时消息，'
        + ' search_news 可搜索数天至一个月内的时间范围的网络信息。'
        + ' 使用场景：用户问"XX有什么政策"、"近期XX有什么行业新闻"、"XX新规"等。',
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
  {
    type: 'function',
    function: {
      name: 'get_index_kline',
      description: '获取股票指数历史K线数据（日K/周K/月K），用于分析指数历史走势、回撤幅度、修复时间等。'
        + ' 支持A股主要指数（上证 sh000001、深证 sz399001、沪深300 sh000300、创业板 sz399006、科创50 sh000688）和全球指数。'
        + ' 必须同时提供起始和结束日期。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '指数代码，A股示例：sh000300（沪深300）、sh000001（上证指数）、sz399006（创业板指）；全球指数示例：^DJI（道琼斯）、^IXIC（纳斯达克）、^HSI（恒生指数）' },
          start_date: { type: 'string', description: '起始日期 YYYY-MM-DD，必须提供' },
          end_date: { type: 'string', description: '结束日期 YYYY-MM-DD，必须提供' },
          period: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'K线周期，默认 daily' },
        },
        required: ['code', 'start_date', 'end_date'],
      },
    },
  },
]
