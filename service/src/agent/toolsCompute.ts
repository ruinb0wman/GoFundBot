/**
 * 计算与用户数据类工具：回测（`packages/core` 引擎同源同值）、筛选查询、策略记忆。
 *
 * 参数沿用**聊天时代的 snake_case**（core `toolArgs.ts` 负责映射），
 * 所以这里的 schema 基本是 core 的类型照抄一份 —— 改动时两边一起改。
 */
import { z } from 'zod'
import { defineAgentTool } from './types.js'
import {
  compareBacktestStrategies,
  runFixedInvestmentBacktest,
  runPortfolioBacktestForArgs,
} from '../services/backtestService.js'
import { getScreeningStatus, queryScreening, enrichScreening, syncScreening } from '../services/screeningService.js'
import { compactDashboard, getResearchDashboard } from '../services/researchService.js'
import {
  addStrategy,
  createStrategyScript,
  deleteStrategyScript,
  listStrategies,
  listStrategyScripts,
  recordScriptRun,
  removeStrategy,
  updateStrategy,
} from '../services/userDataService.js'
import { runStrategyCodeSampled } from '../sandbox/runStrategyCode.js'

const percent = (description: string) => z.number().optional().describe(description)

/** `ToolArgs`（core）里与单基金回测相关的那部分。 */
const backtestArgs = {
  fund_code: z.string().regex(/^\d{6}$/).describe('6 位基金代码'),
  start_date: z.string().optional().describe('起始日期 YYYY-MM-DD，默认三年前'),
  end_date: z.string().optional().describe('结束日期 YYYY-MM-DD，默认今天'),
  amount: z.number().positive().optional().describe('每期投入金额（元），默认 1000'),
  initial_amount: z.number().nonnegative().optional().describe('期初一次性投入（元）'),
  fee_rate: percent('手续费率，小数（0.0015 = 0.15%），默认 0.0015'),
  take_profit_rate: z.number().nullable().optional().describe('止盈阈值，小数（0.2 = 20%）'),
  stop_loss_rate: z.number().nullable().optional().describe('止损阈值，小数（负数，-0.15 = -15%）'),
  investment_type: z
    .enum(['daily', 'weekly', 'monthly'])
    .optional()
    .describe('定投频率：daily 每日 / weekly 每周 / monthly 每月（默认 monthly）'),
  day: z.number().int().min(1).max(31).nullable().optional().describe('每月/每周的定投日序号'),
  dca_rule: z.enum(['equal', 'value_averaging']).optional().describe('定投规则：equal 等额 / value_averaging 价值平均'),
  target_growth: percent('价值平均的目标增长率（小数，0.01 = 每月市值增长 1%）'),
  ma_window: z.number().int().min(2).max(400).optional().describe('均线偏离策略的均线天数（如 250）'),
  ma_factor: percent('均线偏离策略的加码倍数（小数，0.5 = 偏离时多投 50%）'),
}

const portfolioArgs = {
  assets: z
    .array(
      z.object({
        fund_code: z.string().regex(/^\d{6}$/).optional().describe('基金代码；不填则该腿是现金'),
        weight: z.number().positive().describe('权重（小数 0.6 或百分数 60 都行，同一次调用保持一致）'),
        annual_rate: percent('现金腿的年化收益率（小数，0.02 = 2%）'),
        name: z.string().optional(),
      })
    )
    .min(1)
    .describe('资产列表（至少 1 个；不含 fund_code 的腿按现金处理）'),
  start_date: z.string().optional().describe('起始日期 YYYY-MM-DD，默认三年前'),
  end_date: z.string().optional().describe('结束日期 YYYY-MM-DD，默认今天'),
  initial_amount: z.number().positive().optional().describe('期初投入（元）'),
  contribution_amount: z.number().positive().optional().describe('定期注水金额（元）'),
  contribution_period: z.enum(['monthly', 'quarterly', 'yearly']).optional().describe('注水频率'),
  rebalance_frequency: z.enum(['none', 'monthly', 'quarterly', 'yearly']).optional().describe('再平衡频率，默认 none'),
  rebalance_threshold: percent('阈值再平衡的偏离阈值（小数，0.05 = 5%）'),
  fee_rate: percent('手续费率（小数），默认 0.0015'),
}

/** 筛选过滤条件（键名与 `/api/screening/query` 一致，前端筛选面板同款）。 */
const screenFilters = z
  .object({
    fund_types: z.array(z.string()).optional().describe('基金类型（精确匹配 fund_type）'),
    industry_tags: z.array(z.string()).optional().describe('行业标签（如 医药医疗 / 科技 / 固收）'),
    pass_4433: z.boolean().optional().describe('只看通过 4433 法则的基金'),
    keyword: z.string().optional().describe('基金代码或名称关键字'),
    return_1y_min: z.number().optional(),
    return_1y_max: z.number().optional(),
    return_3y_min: z.number().optional(),
    return_3y_max: z.number().optional(),
    sharpe_ratio_1y_min: z.number().optional().describe('近一年夏普下限（先做筛选富化才有值）'),
    calmar_ratio_1y_min: z.number().optional(),
    max_drawdown_1y_max: z.number().optional().describe('近一年最大回撤上限（负数，如 -10 表示不超过 -10%）'),
    volatility_1y_max: z.number().optional(),
    rank_pct_1y_max: z.number().optional().describe('近一年同类排名百分位上限（25 = 前 25%）'),
  })
  .partial()

export const computeTools = [
  defineAgentTool({
    name: 'run_backtest',
    label: '基金定投回测',
    description:
      '对单只基金做定投/价值平均/均线偏离回测，返回投入、市值、收益率、年化、最大回撤、夏普与抽样净值曲线。'
      + '间隔用 investment_type（daily/weekly/monthly）+ day 指定。费率、止盈止损用小数（0.2 = 20%）。'
      + '不传日期默认最近三年。',
    promptSnippet: 'run_backtest(fund_code, ...): 单基金定投回测（月投/周投/价值平均/均线偏离）',
    params: z.object(backtestArgs),
    readOnly: true,
    handler: async (args) => runFixedInvestmentBacktest(args),
  }),

  defineAgentTool({
    name: 'run_portfolio_backtest',
    label: '组合回测',
    description:
      '多资产组合回测：资产权重 + 可选定期注水 + 日历/阈值再平衡 + 现金腿（资产不填 fund_code 即现金），'
      + '返回 TWR 年化、最大回撤、各腿期末权重与抽样净值曲线。',
    promptSnippet: 'run_portfolio_backtest(assets, ...): 组合回测（权重/再平衡/注水/现金腿）',
    params: z.object(portfolioArgs),
    readOnly: true,
    handler: async (args) => runPortfolioBacktestForArgs(args),
  }),

  defineAgentTool({
    name: 'compare_backtest_strategies',
    label: '对比回测策略',
    description: '对同一只基金跑多种定投策略（每日/每周/每月/价值平均/均线偏离/一次性）并给出推荐与理由。',
    promptSnippet: 'compare_backtest_strategies(fund_code, ...): 多策略对比 + 推荐',
    params: z.object(backtestArgs),
    readOnly: true,
    handler: async (args) => compareBacktestStrategies(args),
  }),

  defineAgentTool({
    name: 'screen_funds',
    label: '筛选基金',
    description:
      '在本地基金库（约 3300 只，含风险指标/行业标签/4433 排名）里筛选、排序、分页。'
      + '数据由 service 维护，先看 get_screening_status 了解富化覆盖度；没有风险指标的基金其 sharpe_ratio_1y 为 null。',
    promptSnippet: 'screen_funds(filters, sort_by?, ...): 基金筛选（4433/行业/收益/回撤/夏普）',
    params: z.object({
      filters: screenFilters.optional(),
      sort_by: z
        .string()
        .optional()
        .describe('排序字段，默认 return_1y（常用 sharpe_ratio_1y / max_drawdown_1y / return_3m）'),
      sort_order: z.enum(['asc', 'desc']).optional().describe('排序方向，默认 desc'),
      page: z.number().int().min(1).optional().describe('页码，默认 1'),
      page_size: z.number().int().min(1).max(200).optional().describe('每页条数，默认 20'),
    }),
    readOnly: true,
    handler: async (args) =>
      queryScreening({
        filters: args.filters,
        sortByField: args.sort_by,
        sortOrder: args.sort_order,
        page: args.page,
        pageSize: args.page_size,
      }),
  }),

  defineAgentTool({
    name: 'get_screening_status',
    label: '筛选数据状态',
    description:
      '查询基金筛选库的状态：总数、已算风险指标数、待富化数、4433 通过数、类型分布与最近同步时间。'
      + '看到 risk_metrics_pending > 0 时说明部分基金还没有夏普/回撤值（需要先富化）。',
    promptSnippet: 'get_screening_status(): 筛选库覆盖度与同步时间',
    params: z.object({}),
    readOnly: true,
    handler: async () => getScreeningStatus(),
  }),

  defineAgentTool({
    name: 'refresh_screening',
    label: '刷新筛选库',
    description:
      '刷新本地基金筛选库：拉最新快照 + 重算 4433 排名，并可选跑一批风险指标富化（夏普/回撤等）。'
      + '会联网刷新（只写缓存，不动用户数据），冷启动全量约 3 分钟，所以默认只做一批（enrich_limit，300 只）；'
      + '返回后看 risk_metrics_pending，>0 就再调一次。retry=true 会把上次取数失败的基金重新标记为待算。',
    promptSnippet: 'refresh_screening(force?, enrich_limit?, retry?): 刷新筛选库/富化风险指标',
    params: z.object({
      force: z.boolean().optional().describe('true = 忽略快照时间，强制重新同步（默认 false，快照没变就跳过）'),
      enrich_limit: z
        .number()
        .int()
        .min(0)
        .max(2000)
        .optional()
        .describe('本批富化多少只基金，默认 300；0 = 只同步排名不富化'),
      retry: z.boolean().optional().describe('true = 重试上次取不到净值的基金（risk_attempted 归零）'),
    }),
    readOnly: true,
    async handler(args) {
      const sync = await syncScreening({ force: args.force, enrichLimit: 0 });
      const enrich =
        args.enrich_limit === 0 ? null : await enrichScreening({ limit: args.enrich_limit, retry: args.retry });
      return { sync, enrich, status: getScreeningStatus() };
    },
  }),

  defineAgentTool({
    name: 'get_research_dashboard',
    label: '投研看板',
    description:
      '一次性拿到投研看板的四个板块：基金市场统计（总数/风险指标覆盖/4433 通过率/收益中位数）、'
      + '基金看板（各类型数量与中位收益）、ETF 每日跟踪、行业表现。'
      + '比自己去 screen_funds 逐项统计更省事，数字与前端 /research 页面一致。',
    promptSnippet: 'get_research_dashboard(limit?): 投研看板（市场统计/基金看板/ETF/行业表现）',
    params: z.object({
      limit: z.number().int().min(1).max(50).optional().describe('每个榜单取前几名，默认 5'),
      etf_limit: z.number().int().min(1).max(500).optional().describe('ETF 明细取多少行（默认 10；明细已默认精简）'),
      include_items: z
        .boolean()
        .optional()
        .describe('true = 返回完整看板（含每张卡片的 top 基金与全部 ETF 行，可能超长被截断）'),
    }),
    readOnly: true,
    async handler(args) {
      const dashboard = await getResearchDashboard({ limit: args.limit, etfLimit: args.etf_limit ?? 80 });
      return args.include_items ? dashboard : compactDashboard(dashboard, args.etf_limit ?? 10);
    },
  }),

  defineAgentTool({
    name: 'list_strategies',
    label: '读取策略记忆',
    description:
      '读取用户在 GoFundBot「策略研究」里保存的投资策略（标题、正文、标签、是否启用）。'
      + '需要结合用户策略分析持仓/基金时先读它。',
    promptSnippet: 'list_strategies(): 用户的策略记忆（投资目标/纪律）',
    params: z.object({}),
    readOnly: true,
    handler: async () => ({ strategies: listStrategies() }),
  }),

  defineAgentTool({
    name: 'save_strategy',
    label: '写入策略记忆',
    description:
      '保存或更新一条策略记忆（写入 service SQLite，前端 /strategy 页面可见）。'
      + '**这是写操作**：必须先把内容给用户看过并得到明确同意；'
      + '第一次调用只会返回 CONFIRM_REQUIRED 与确认令牌，带上该令牌再调一次才真正写入。',
    promptSnippet: 'save_strategy(title, content, tags?, active?, id?): 写入策略记忆（需用户确认）',
    params: z.object({
      id: z.number().int().positive().optional().describe('要更新的策略 id（来自 list_strategies）；不填则新建'),
      title: z.string().min(1).max(40).describe('策略标题（≤40 字）'),
      content: z.string().min(1).describe('策略正文：投资目标、资金分配、买卖纪律、风险管理'),
      tags: z.array(z.string()).optional().describe('标签，例如 ["定投", "长期持有"]'),
      active: z.boolean().optional().describe('是否启用（启用的策略会注入 AI 提示词），默认 true'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, active, id, ...rest } = args
      const patch = { ...rest, active: active === false ? 0 : 1 }
      if (id) {
        const updated = updateStrategy(id, patch)
        if (!updated) return { error: `策略 ${id} 不存在（用 list_strategies 查 id）` }
        return { saved: updated }
      }
      return { saved: addStrategy({ ...patch, source: 'ai-draft' }) }
    },
  }),

  defineAgentTool({
    name: 'delete_strategy',
    label: '删除策略记忆',
    description:
      '删除一条策略记忆（前端 /strategy 页面同步消失）。**破坏性写入**：'
      + '第一次调用只返回 CONFIRM_REQUIRED 与令牌，必须先把要删的标题给用户看过并取得明确同意，再带 __confirm_token 重调。',
    promptSnippet: 'delete_strategy(id): 删除策略记忆（需用户确认）',
    params: z.object({
      id: z.number().int().positive().describe('要删除的策略 id（来自 list_strategies）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, id } = args;
      const target = listStrategies().find((strategy) => strategy.id === id);
      if (!target) return { error: `策略 ${id} 不存在（用 list_strategies 查 id）` };
      removeStrategy(id);
      return { deleted: { id, title: target.title }, strategies: listStrategies() };
    },
  }),

  defineAgentTool({
    name: 'list_strategy_scripts',
    label: '列出已保存的回测方案',
    description:
      '列出用户保存的「策略代码」回测方案（名称、代码、上次运行结果）。要用某个方案回测时，'
      + '把它的名称传给 run_strategy_code 的 script_name（比让模型重新生成代码更省事）。',
    promptSnippet: 'list_strategy_scripts(): 已保存的回测方案（名称/代码/上次结果）',
    params: z.object({}),
    readOnly: true,
    handler: async () => ({ scripts: listStrategyScripts() }),
  }),

  defineAgentTool({
    name: 'run_strategy_code',
    label: '代码回测（自由策略）',
    description:
      '执行一段「自由策略代码」并回测：代码是模块，`prepare(sdk)` 声明固定标的池（`sdk.screen()` 可筛本地基金库），'
      + '`onDay(s)` 逐日返回 { buy|sell|rebalance|sellAll }（按基金代码）。'
      + '返回抽样后的组合结果（投入/市值/收益率/TWR/回撤/各腿权重 + 少量 checkpoint），与页面 /backtest 同源同值。'
      + '**这是执行类操作**：代码在隔离 worker 里跑（5s 超时、无网络），但仍需用户确认 —— '
      + '第一次调用返回 CONFIRM_REQUIRED 与令牌，先把代码给用户看并取得同意，再用同样参数 + 令牌重调。',
    promptSnippet: 'run_strategy_code(code|script_name, ...): 跑自由策略代码回测（需用户确认）',
    params: z.object({
      code: z.string().optional().describe('策略代码（与 script_name 二选一）'),
      script_name: z.string().optional().describe('已保存方案的名称（与 code 二选一，见 list_strategy_scripts）'),
      start_date: z.string().optional().describe('覆盖方案声明的开始日期 YYYY-MM-DD'),
      end_date: z.string().optional().describe('覆盖方案声明的结束日期 YYYY-MM-DD'),
      initial_amount: z.number().nonnegative().optional().describe('覆盖期初投入（元）'),
      fee_rate: percent('覆盖手续费率（小数，0.0015 = 0.15%）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    async handler(args) {
      const { __confirm_token: _token, script_name, code, ...overrides } = args;
      let source = code?.trim() ?? '';
      let saved: { id: number; name: string } | null = null;

      if (script_name) {
        const found = listStrategyScripts().find((script) => script.name === script_name);
        if (!found) {
          const names = listStrategyScripts().map((script) => script.name).join('、') || '（还没有保存过方案）';
          return { error: `没有名为「${script_name}」的回测方案。可用：${names}` };
        }
        source = found.code;
        saved = { id: found.id, name: found.name };
      }
      if (!source) return { error: '需要提供 code 或 script_name' };

      const result = await runStrategyCodeSampled(source, overrides, saved?.name ?? '自定义策略代码');
      if ('error' in result) return result;
      if (saved) recordScriptRun(saved.id, result.summary);
      return saved ? { script: saved.name, ...result } : result;
    },
  }),

  defineAgentTool({
    name: 'save_strategy_script',
    label: '保存回测方案',
    description:
      '把一段策略代码存成命名方案（写 service SQLite，前端 /backtest 页面可见，之后可用 `run_strategy_code(script_name=...)` 重跑）。'
      + '**写操作**：第一次调用返回 CONFIRM_REQUIRED 与令牌，用户确认后用同样参数 + 令牌重调。',
    promptSnippet: 'save_strategy_script(name, code): 保存回测方案（需用户确认）',
    params: z.object({
      name: z.string().min(1).max(60).describe('方案名（唯一，页面下拉里显示）'),
      code: z.string().min(1).describe('策略代码'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, name, code } = args;
      if (listStrategyScripts().some((script) => script.name === name)) {
        return { error: `方案名「${name}」已存在，换一个名字（或让用户在页面上改）` };
      }
      return { saved: createStrategyScript({ name, code, source: 'ai' }) };
    },
  }),

  defineAgentTool({
    name: 'delete_strategy_script',
    label: '删除回测方案',
    description:
      '删除一个已保存的回测方案（前端 /backtest 页面下拉里同步消失）。**破坏性写入**：'
      + '第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。',
    promptSnippet: 'delete_strategy_script(id): 删除回测方案（需用户确认）',
    params: z.object({
      id: z.number().int().positive().describe('要删除的方案 id（来自 list_strategy_scripts）'),
      __confirm_token: z.string().optional().describe('服务端下发的确认令牌（第一次调用后获得）'),
    }),
    readOnly: false,
    handler: async (args) => {
      const { __confirm_token: _token, id } = args;
      const target = listStrategyScripts().find((script) => script.id === id);
      if (!target) return { error: `方案 ${id} 不存在（用 list_strategy_scripts 查 id）` };
      deleteStrategyScript(id);
      return { deleted: { id, name: target.name }, scripts: listStrategyScripts() };
    },
  }),
]
