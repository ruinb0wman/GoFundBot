/**
 * Chat tool definitions (the `TOOL_DEFS` array).
 *
 * Split out of `toolContract.ts` to stay under the 500-line lint cap — the registry,
 * OpenAI/XML derivation and runtime validation live there and import from here.
 */

import { Type, type TObject } from '@sinclair/typebox'

export interface ToolSpec {
  name: string
  label: string
  description: string
  /** One-line snippet surfaced in the system prompt tool list (same idea as pi `promptSnippet`). */
  promptSnippet?: string
  /** TypeBox object schema; properties.each carry `description` for model + validation. */
  parameters: TObject
}

function enumOf(...values: string[]) {
  return Type.Union(values.map((v) => Type.Literal(v)))
}

const str = (description: string) => Type.String({ description })
const optStr = (description: string) => Type.Optional(Type.String({ description }))
const int = (description: string) => Type.Optional(Type.Integer({ description }))
const num = (description: string) => Type.Optional(Type.Number({ description }))
export const TOOL_DEFS: ToolSpec[] = [
  {
    name: 'search_funds',
    label: '搜索基金',
    description: '根据关键字搜索基金代码和名称',
    promptSnippet: 'search_funds(keyword): 按名称/代码关键字搜索基金',
    parameters: Type.Object({
      keyword: str('基金名称或代码关键字'),
    }),
  },
  {
    name: 'get_fund_detail',
    label: '获取基金详情',
    description: '获取基金完整详情：基本信息、业绩、持仓、基金经理、风险指标等',
    promptSnippet: 'get_fund_detail(code): 完整基金详情（业绩/持仓/经理/风险）',
    parameters: Type.Object({
      code: str('6位基金代码'),
    }),
  },
  {
    name: 'get_fund_estimate',
    label: '获取基金估值',
    description: '获取基金实时估值（盘中估算净值/涨跌幅）',
    promptSnippet: 'get_fund_estimate(code): 盘中实时估值',
    parameters: Type.Object({
      code: str('6位基金代码'),
    }),
  },
  {
    name: 'get_fund_nav_history',
    label: '获取净值历史',
    description: '获取基金历史净值数据',
    promptSnippet: 'get_fund_nav_history(code, start_date?, end_date?): 历史净值',
    parameters: Type.Object({
      code: str('6位基金代码'),
      start_date: optStr('起始日期 YYYY-MM-DD（可选）'),
      end_date: optStr('结束日期 YYYY-MM-DD（可选）'),
    }),
  },
  {
    name: 'get_market_indices',
    label: '获取指数行情',
    description: '获取主要股票市场指数实时行情（上证、深证、创业板等）',
    promptSnippet: 'get_market_indices(): 主要指数实时行情',
    parameters: Type.Object({}),
  },
  {
    name: 'get_market_news',
    label: '获取市场快讯',
    description: '获取市场快讯新闻',
    promptSnippet: 'get_market_news(count?): 今日实时快讯',
    parameters: Type.Object({
      count: int('新闻条数，默认20'),
    }),
  },
  {
    name: 'get_hot_sectors',
    label: '获取热门板块',
    description: '获取热门行业板块实时行情（同花顺行业分类）。返回板块涨跌幅、主力净流入；数据源降级时 code 可能为空。不含概念板块（概念板块用 get_concept_sectors）。',
    promptSnippet: 'get_hot_sectors(limit?): 热门行业板块实时行情',
    parameters: Type.Object({
      limit: int('返回板块数量，默认10'),
    }),
  },
  {
    name: 'get_concept_sectors',
    label: '获取概念板块',
    description:
      '获取概念板块行情（同花顺资金流，按当日涨跌幅降序）：板块涨跌幅、主力净流入、成分股数量、领涨股，以及同花顺概念简介的驱动事件 event。注意：event_date 是数据源标注的事件日期，可能早于当日，不要当作行情日期；数据源不可用时 data_status 为 unavailable（items 为空），此时不要编造概念板块表现。',
    promptSnippet: 'get_concept_sectors(limit?): 概念板块行情（涨跌幅/净流入/驱动事件）',
    parameters: Type.Object({
      limit: int('返回板块数量，默认10，最大50'),
    }),
  },
  {
    name: 'get_north_flow',
    label: '获取北向资金',
    description: '获取北向资金数据。注意：自 2024-08-19 起沪深港通不再披露北向资金净流入，data_status 恒为 unavailable，*_net_inflow 恒为 null；可用的是当日成交总额（*_deal_amount_yi，亿元）。必须先阅读 note 字段再作答，不要把 null 解读为 0。',
    promptSnippet: 'get_north_flow(): 北向资金成交总额（净流入已停止披露）',
    parameters: Type.Object({}),
  },
  {
    name: 'get_market_breadth',
    label: '获取涨跌统计',
    description: '获取市场涨跌统计：沪深两市合计的上涨/下跌/平盘家数（scope 字段标注口径），以及涨停/跌停家数（limit_up/limit_down 可能为 null）。',
    promptSnippet: 'get_market_breadth(): 沪深两市涨跌家数 + 涨跌停家数',
    parameters: Type.Object({}),
  },
  {
    name: 'get_main_flow',
    label: '获取主力资金',
    description: '获取主力资金流向（超大单/大单/中单/小单净流入）。必须检查 data_status 字段，unavailable 时需查看 note 字段说明原因。',
    promptSnippet: 'get_main_flow(): 主力资金流向分单规模',
    parameters: Type.Object({}),
  },
  {
    name: 'get_flash_news',
    label: '获取快讯新闻',
    description: '获取快讯新闻',
    promptSnippet: 'get_flash_news(count?): 7×24 快讯',
    parameters: Type.Object({
      count: int('新闻条数，默认20'),
    }),
  },
  {
    name: 'get_watchlist',
    label: '获取自选列表',
    description: '获取用户的基金自选列表',
    promptSnippet: 'get_watchlist(): 用户自选列表',
    parameters: Type.Object({}),
  },
  {
    name: 'get_portfolio_holdings',
    label: '获取我的持仓',
    description:
      '读取用户保存在本地的基金持仓（代码/份额/成本/最新估值/当前权重）。' +
      '注意：这是**当前持仓**，不是回测需要的目标权重；回测组合请用 run_portfolio_backtest 并显式给出目标权重。',
    promptSnippet: 'get_portfolio_holdings(): 我的持仓（本地 IndexedDB）',
    parameters: Type.Object({}),
  },
  {
    name: 'screen_funds_by_4433',
    label: '4433筛选基金',
    description: '按4433法则筛选符合条件的基金',
    promptSnippet: 'screen_funds_by_4433(): 按4433法则筛选',
    parameters: Type.Object({}),
  },
  {
    name: 'run_backtest',
    label: '运行定投回测',
    description: '对指定基金运行定投回测（月/周/日/一次性），支持止盈止损、手续费、初始资金与定投方式（等额/价值平均/均线偏离）',
    promptSnippet: 'run_backtest(fund_code, start_date?, end_date?, amount?, investment_type?, day?, take_profit_rate?, stop_loss_rate?, dca_rule?): 定投回测',
    parameters: Type.Object({
      fund_code: str('6位基金代码'),
      start_date: optStr('开始日期 YYYY-MM-DD，缺省为三年前'),
      end_date: optStr('结束日期 YYYY-MM-DD，缺省为今天'),
      amount: num('每期定投金额（元），默认1000；一次性买入时为本金'),
      initial_amount: num('初始资金（元），默认0'),
      fee_rate: num('手续费率（小数，0.0015 表示 0.15%），默认 0.0015'),
      take_profit_rate: num('止盈率（小数，0.2 表示涨 20% 卖出），可选'),
      stop_loss_rate: num('止损率（小数，0.1 表示跌 10% 卖出），可选'),
      investment_type: Type.Optional(enumOf('monthly', 'weekly', 'daily', 'lump_sum')),
      day: int('定投日：每月几号填 1-31；每周周几填 0-4（0=周一）。缺省为周期首个交易日'),
      dca_rule: Type.Optional(enumOf('fixed', 'value_averaging', 'ma_deviation')),
      target_growth: num('价值平均的目标增速（小数，0 表示目标市值按每期等额递增）'),
      ma_window: int('均线偏离的均线天数，默认250'),
      ma_factor: num('均线偏离的最大加减码比例（小数，0.5 表示 ±50%），默认0.5'),
    }),
  },
  {
    name: 'run_strategy_code',
    label: '运行自定义策略代码',
    description:
      '用 JavaScript 写一个**模块**并回测：固定池 + 逐日决策。只在没有现成方案能表达你的想法时使用：' +
      '现成的每月/每周/一次性/价值平均/均线偏离方案请用 run_backtest，组合再平衡/注水用 run_portfolio_backtest，避免小题大做。' +
      '模块必须定义两个函数：' +
      '① function prepare(sdk) → { start?, end?, assets: [110022, ...], initialAmount?, feeRate? }；' +
      'assets 是基金代码字符串数组（省略 start/end 默认近三年），可用 sdk.screen({ sharpe_ratio_1y?, type?, ... }) 从本地基金库筛选；' +
      '最多一个现金腿，写成 CASH 或 CASH:0.02（年化 2%），在 onDay 里用 cash（或 CASH）寻址。' +
      '② function onDay(s) → { buy?: [{code, amount}], sell?: [{code, amount}], rebalance?: {code: 权重}, sellAll?: true }；按**基金代码**寻址（不是下标）。' +
      's = { i, date, codes, nav(code), navs(code)（截至今日，无未来）, ma(code,n), pctChange(code,n), weight(code), ' +
      'shares, values, cash, invested, value, returnRate(), args:{start,end,initialAmount,feeRate} }。' +
      'buy 是追加外部资金（计入累计投入）；sell 卖出换现金（留在组合）；rebalance 用持仓+现金内部调仓（按总和归一化）；sellAll 清仓并停止。' +
      '禁止使用 fetch/网络/存储等任何外部能力，只能使用 s/sdk 提供的数据。用户确认后才会执行。' +
      '如果用户想重跑某个已保存方案，传 script_name（先用 list_strategy_scripts 查名字），此时无需再传 code。',
    promptSnippet:
      'run_strategy_code(code 或 script_name, start_date?, end_date?, initial_amount?, fee_rate?): 自写策略代码并回测，或按名称运行已保存方案（需用户确认）',
    parameters: Type.Object({
      script_name: optStr('运行已保存方案：方案名称（与 code 二选一，重复时返回候选）'),
      code: Type.Optional(
        Type.String({
          maxLength: 8000,
          description:
            "策略模块，必须含 prepare(sdk) 与 onDay(s)。例：function prepare(sdk){ return { assets: ['110022'] } } function onDay(s){ const ma = s.ma('110022', 60); return { buy: [{ code: '110022', amount: s.nav('110022') < ma ? 2000 : 500 }] } }",
        }),
      ),
      start_date: optStr('覆盖 prepare() 里的开始日期 YYYY-MM-DD（可选）'),
      end_date: optStr('覆盖 prepare() 里的结束日期 YYYY-MM-DD（可选）'),
      initial_amount: num('覆盖初始资金（元，可选）'),
      fee_rate: num('覆盖手续费率（小数，0.0015 表示 0.15%，可选）'),
    }),
  },
  {
    name: 'compare_backtest_strategies',
    label: '对比定投策略',
    description: '对同一只基金并行回测多种定投方案（每月/每周/一次性/价值平均/均线偏离）并给出推荐',
    promptSnippet: 'compare_backtest_strategies(fund_code, start_date?, end_date?, amount?): 多策略回测对比与推荐',
    parameters: Type.Object({
      fund_code: str('6位基金代码'),
      start_date: optStr('开始日期 YYYY-MM-DD，缺省为三年前'),
      end_date: optStr('结束日期 YYYY-MM-DD，缺省为今天'),
      amount: num('每期定投金额（元），默认1000'),
      fee_rate: num('手续费率（小数），默认 0.0015'),
      take_profit_rate: num('止盈率（小数），可选'),
      stop_loss_rate: num('止损率（小数），可选'),
    }),
  },
  {
    name: 'run_portfolio_backtest',
    label: '组合回测',
    description:
      '对多资产组合（多只基金按目标权重）做历史回测，支持定期/阈值再平衡与定期注水，返回组合年化/回撤/夏普与各资产表现。' +
      '单只基金请用 run_backtest；这里是组合层面，至少需要 2 个资产。' +
      '现金腿不填 fund_code、改填 annual_rate（货币基金没有单位净值序列）。权重按总和归一化，传百分数(25)或小数(0.25)均可。',
    promptSnippet:
      'run_portfolio_backtest(assets, start_date?, end_date?, initial_amount?, contribution_amount?, contribution_period?, rebalance_frequency?, rebalance_threshold?, fee_rate?): 多资产组合再平衡回测',
    parameters: Type.Object({
      assets: Type.Array(
        Type.Object({
          fund_code: optStr('6位基金代码；现金腿留空'),
          weight: Type.Number({ description: '目标权重，如 25（百分数）或 0.25；按所有资产总和归一化' }),
          annual_rate: num('仅现金腿：年化收益率小数，如 0.02 表示 2%'),
          name: optStr('资产名称，可选'),
        }),
        { description: '资产列表，至少 2 项' },
      ),
      start_date: optStr('开始日期 YYYY-MM-DD，缺省为三年前'),
      end_date: optStr('结束日期 YYYY-MM-DD，缺省为今天'),
      initial_amount: num('期初一次性投入（元），默认 0'),
      contribution_amount: num('每期注水金额（元），可选'),
      contribution_period: Type.Optional(enumOf('monthly', 'quarterly', 'yearly')),
      rebalance_frequency: Type.Optional(enumOf('none', 'monthly', 'quarterly', 'yearly')),
      rebalance_threshold: num('权重偏离阈值（小数，0.05 表示偏离 5 个百分点即触发），可选'),
      fee_rate: num('手续费率（小数，0.0015=0.15%），买卖双向，默认 0.0015'),
    }),
  },
  {
    name: 'suggest_strategy',
    label: '推荐定投策略',
    description: '为指定基金推荐最优定投策略（MA均线/价值平均等方案对比）',
    promptSnippet: 'suggest_strategy(fund_code): 最优定投策略推荐',
    parameters: Type.Object({
      fund_code: str('6位基金代码'),
    }),
  },
  {
    name: 'get_stock_quote',
    label: '获取个股行情',
    description: '获取个股实时行情（价格、涨跌幅、成交量等）',
    promptSnippet: 'get_stock_quote(code): 个股实时行情',
    parameters: Type.Object({
      code: str('6位股票代码'),
    }),
  },
  {
    name: 'get_market_anomaly',
    label: '检查市场异动',
    description: '检查市场异动（指数涨跌幅超过阈值）',
    promptSnippet: 'get_market_anomaly(): 指数异动检查',
    parameters: Type.Object({}),
  },
  {
    name: 'get_gold_realtime',
    label: '获取黄金价格',
    description: '获取实时黄金价格',
    promptSnippet: 'get_gold_realtime(): 实时金价',
    parameters: Type.Object({}),
  },
  {
    name: 'get_fund_holdings',
    label: '获取基金持仓',
    description: '获取基金重仓持股列表',
    promptSnippet: 'get_fund_holdings(code): 重仓持股',
    parameters: Type.Object({
      code: str('6位基金代码'),
    }),
  },
  {
    name: 'get_fund_managers',
    label: '获取基金经理',
    description: '获取基金经理信息',
    promptSnippet: 'get_fund_managers(code): 基金经理信息',
    parameters: Type.Object({
      code: str('6位基金代码'),
    }),
  },
  {
    name: 'get_funds_by_industry',
    label: '查询行业基金',
    description: '根据行业/主题关键词查找相关基金。仅在用户明确提及具体行业/主题时调用。',
    promptSnippet: 'get_funds_by_industry(keyword): 按行业/主题找基金',
    parameters: Type.Object({
      keyword: str('行业/主题关键词'),
    }),
  },
  {
    name: 'search_news',
    label: '网络搜索新闻',
    description: '通过网络搜索新闻、政策、行业动态，用于获取近期政策法规或行业新闻。'
      + ' 与快讯工具（get_market_news/get_flash_news）不同：快讯只返回今日实时消息，'
      + ' search_news 可搜索数天至一个月内的时间范围的网络信息。'
      + ' 使用场景：用户问"XX有什么政策"、"近期XX有什么行业新闻"、"XX新规"等。',
    promptSnippet: 'search_news(query, max_results?): 网络搜索新闻/政策/行业动态',
    parameters: Type.Object({
      query: str('搜索关键词，如"碳中和 政策"'),
      max_results: int('最大结果数，默认5'),
    }),
  },
  {
    name: 'get_industry_performance',
    label: '获取行业业绩',
    description: '获取各行业板块的多周期业绩汇总——各行业中位收益、正收益基金占比、基金数量。',
    promptSnippet: 'get_industry_performance(): 各行业多周期业绩汇总',
    parameters: Type.Object({}),
  },
  {
    name: 'get_index_kline',
    label: '获取指数K线',
    description: '获取股票指数历史K线数据（日K/周K/月K），用于分析指数历史走势、回撤幅度、修复时间等。'
      + ' 支持A股主要指数（上证 sh000001、深证 sz399001、沪深300 sh000300、创业板 sz399006、科创50 sh000688）和全球指数。'
      + ' 必须同时提供起始和结束日期。',
    promptSnippet: 'get_index_kline(code, start_date, end_date, period?): 指数历史K线',
    parameters: Type.Object({
      code: str('指数代码，A股示例：sh000300（沪深300）、sh000001（上证指数）、sz399006（创业板指）；全球指数示例：^DJI（道琼斯）、^IXIC（纳斯达克）、^HSI（恒生指数）'),
      start_date: str('起始日期 YYYY-MM-DD，必须提供'),
      end_date: str('结束日期 YYYY-MM-DD，必须提供'),
      period: Type.Optional(enumOf('daily', 'weekly', 'monthly')),
    }),
  },
  {
    name: 'list_strategy_scripts',
    label: '列出已保存回测方案',
    description: '列出用户在本机保存的回测方案（名称 / 上次运行摘要）。想运行某个已保存方案时先调用它拿到 name。',
    promptSnippet: 'list_strategy_scripts(): 已保存的回测方案列表',
    parameters: Type.Object({}),
  },
  {
    name: 'save_strategy_script',
    label: '保存回测方案',
    description:
      '把一段策略代码保存为回测方案（用户可在「回测」页看到并运行）。保存本身不执行代码；若要立即看结果请用 run_strategy_code。',
    promptSnippet: 'save_strategy_script(name, code): 保存方案',
    parameters: Type.Object({
      name: str('方案名称（用于之后按名称运行）'),
      code: Type.String({ maxLength: 8000, description: '策略模块，契约同 run_strategy_code（prepare + onDay）' }),
    }),
  },
]
