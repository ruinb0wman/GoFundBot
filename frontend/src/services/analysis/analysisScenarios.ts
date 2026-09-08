/**
 * AI analysis scenario registry.
 *
 * Every analysis scenario = a Skill (system prompt + tool subset) + a structured
 * output contract (TypeBox) + an orchestration pipeline + a structured fallback.
 * All scenarios run through the same engine loop (`analysisEngine.ts`) and share
 * the chat tool-call contract, so validation / envelope / sanitization boundaries
 * are identical everywhere.
 *
 * - fund_analysis      → 4 tool-capable analysts parallel + supervisor (full set)
 * - portfolio_diagnosis→ single task with market/fund tools
 * - log_analysis       → self-contained task (no tools; Schema + fallback only)
 */

import {
  FundAnalysisResultSchema,
  LogAnalysisSchema,
  PortfolioAnalysisResultSchema,
} from './scenarioTypes'
import type { Skill } from '../chatEngine/skills'
import type { TObject } from '@sinclair/typebox'

export interface AnalysisAnalystSpec {
  /** Stable role key (performance | holding | manager | market). */
  role: string
  analystPrompt: string
  toolNames: string[]
}

export interface AnalysisScenario extends Skill {
  id: 'fund_analysis' | 'portfolio_diagnosis' | 'log_analysis'
  /** Structured-output contract (see scenarioTypes.ts). */
  outputSchema: TObject
  /** 'multi-analyst' = analysts[] parallel + supervisor pass; 'single' = one task. */
  pipeline: 'multi-analyst' | 'single'
  /** Only for fund_analysis: 4 tool-capable analysts. */
  analysts?: AnalysisAnalystSpec[]
  /** Human-readable fallback summary used in the UI / logs. */
  fallback?: (ctx?: unknown) => unknown | Promise<unknown>
}

const OUTPUT_RULE = `## 结构化输出
最终必须只输出一个 JSON 对象：不写 markdown 代码块、不加包裹说明、不混入任何解释文字或 XML/工具标记。JSON 字段必须与给出的 Schema 完全一致（字段名、类型、枚举值）。如果调用了工具，必须在拿到工具结果并核实数据后才最终输出；禁止编造工具未返回的数值。`

const ANALYST_TOOL_USAGE = `如需实时数据（行情、净值、持仓、经理、新闻、板块、资金流等），可调用下方列出的工具获取后再分析；工具不可用或数据不足时，基于用户提供的数据分析并如实说明，不得编造。`

const PERFORMANCE_PROMPT = `你是一位基金业绩分析师。

你的任务是基于基金的收益和风险数据给出客观分析。请着重关注：
1. 收益表现——各区间收益率（近1月/3月/6月/1年）的绝对和相对表现
2. 风险调整收益——夏普比率、卡玛比率等风险调整后的回报
3. 回撤控制——最大回撤幅度和恢复能力
4. 波动率——年化波动率水平及稳定性
5. 同类排名——在同类基金中的排名百分位变化趋势

${ANALYST_TOOL_USAGE}

${OUTPUT_RULE}
{
  "analyst_role": "performance",
  "thesis": "业绩分析结论（200-300字）",
  "score": 0-10 的数字，
  "key_evidence": ["证据1", "证据2", "证据3"],
  "risk_flags": ["需要关注的风险因素"]
}`

const HOLDING_PROMPT = `你是一位基金持仓分析师。

你的任务是基于基金的持仓数据给出客观分析。请着重关注：
1. 持仓集中度——前十大重仓股占比、行业集中程度
2. 重仓股质量——前五大持仓股的基本面和行业地位
3. 行业分布——行业覆盖广度、与当前市场风格匹配度
4. 资产配置——股票/债券/现金仓位比例
5. 持仓稳定性——调仓频率和历史风格一致性

${ANALYST_TOOL_USAGE}

${OUTPUT_RULE}
{
  "analyst_role": "holding",
  "thesis": "持仓分析结论（200-300字）",
  "score": 0-10 的数字，
  "key_evidence": ["证据1", "证据2", "证据3"],
  "risk_flags": ["需要关注的风险因素"]
}`

const MANAGER_PROMPT = `你是一位基金经理分析师。

你的任务是基于基金经理的信息给出客观分析。请着重关注：
1. 从业经验——基金经理的从业年限、任职稳定性
2. 管理规模——管理基金数量和总规模、规模扩张速度
3. 历史业绩——管理的其他基金的历史表现和同类排名
4. 投资风格——风格稳定性、是否频繁换股/换行业
5. 团队实力——基金经理团队支持、投研资源

${ANALYST_TOOL_USAGE}

${OUTPUT_RULE}
{
  "analyst_role": "manager",
  "thesis": "经理分析结论（200-300字）",
  "score": 0-10 的数字，
  "key_evidence": ["证据1", "证据2", "证据3"],
  "risk_flags": ["需要关注的风险因素"]
}`

const MARKET_PROMPT = `你是一位市场环境分析师。

你的任务是基于当前市场数据和基金行业属性给出客观分析。请着重关注：
1. 市场情绪——今日快讯反映的市场整体情绪和关注焦点
2. 热点板块——涨幅领先和资金流入最多的行业板块
3. 行业相关性——基金持仓行业与当前市场热点的匹配程度
4. 政策环境——近期重要政策对基金持仓行业的影响
5. 宏观背景——利率、汇率、经济数据等宏观因素

${ANALYST_TOOL_USAGE}

${OUTPUT_RULE}
{
  "analyst_role": "market",
  "thesis": "市场环境分析结论（200-300字）",
  "score": 0-10 的数字，
  "key_evidence": ["证据1", "证据2", "证据3"],
  "risk_flags": ["需要关注的风险因素"]
}`

const SUPERVISOR_PROMPT = `你是一位基金研究总监。

你的团队中有四位专业分析师完成了各自维度的分析：
1. 业绩分析师——分析了基金的收益和风险指标
2. 持仓分析师——分析了基金的重仓持股和资产配置
3. 经理分析师——分析了基金经理的经验和能力
4. 市场分析师——分析了当前市场环境和行业趋势

请综合四位分析师的观点，做出客观公正的最终裁决。需要核对实时数据（行情、板块、资金流等）时可调用可用工具，但不得编造。

${OUTPUT_RULE}
{
  "rating": "Strong Buy"|"Buy"|"Hold"|"Underweight"|"Sell"，
  "sentiment_score": 0-100 的数字，
  "operation_advice": "强烈推荐"|"建议买入"|"持有观望"|"建议减仓"|"建议卖出"，
  "summary": "综合四位分析师观点后的总结（200-300字）",
  "dashboard": {
    "performance_eval": "优秀"|"良好"|"一般"|"较差",
    "manager_ability": "优秀"|"良好"|"一般"|"较差",
    "position_analysis": "集中"|"均衡"|"分散",
    "market_outlook": "乐观"|"中性"|"谨慎"
  },
  "highlights": ["亮点1", "亮点2", "亮点3"],
  "risk_factors": ["风险1", "风险2", "风险3"],
  "news_intel": ["相关市场信息1", "相关市场信息2"],
  "detailed_report": "深度分析报告（Markdown，不少于500字，引用每位分析师观点）"
}`

const PORTFOLIO_PROMPT = `你是一位基金组合诊断专家，负责对用户持有的多只基金进行组合层面的分析诊断。

## 输入
你会收到用户持仓的多只基金的汇总数据（类型、权重、近期收益、重仓股等），以及"用户投资策略"段落（如有）。

## 分析维度
1. 组合表现：整体收益情况、近期表现优劣
2. 分散程度：行业/风格/基金类型是否过度集中或过度分散
3. 持仓结构：权重分配的合理性、与用户策略的匹配度
4. 市场判断：结合组合特征对后市给出定位判断

## 约束
- 所有判断必须基于提供的持仓数据，不编造数据、不编造基金名称
- 如提供"用户投资策略"，操作建议应贴合用户的策略取向，但不得为迎合策略而歪曲数据
- 全部用中文回答
- 如需补充市场数据（指数、板块、资金流等）可调用可用工具

${OUTPUT_RULE}
{
  "fund_code": "",
  "fund_name": "我的持仓",
  "rating": "Strong Buy"|"Buy"|"Hold"|"Underweight"|"Sell",
  "sentiment_score": 0-100 的数字（看多程度，50 为中性）,
  "operation_advice": "简短的操作建议（中文）",
  "summary": "组合诊断总结（中文，2-3句）",
  "dashboard": {
    "performance_eval": "优秀"|"良好"|"一般"|"较差",
    "manager_ability": "高"|"中"|"低",
    "position_analysis": "合理"|"偏集中"|"偏分散",
    "market_outlook": "乐观"|"中性"|"谨慎"
  },
  "highlights": ["组合亮点数组"],
  "risk_factors": ["风险因素数组"],
  "news_intel": [],
  "detailed_report": "详细报告（markdown，包含 ## 章节：组合表现/分散程度/持仓结构/市场判断/操作建议）"
}`

const LOG_ANALYSIS_PROMPT = `你是一位日志分析专家，擅长从服务日志中定位错误模式并给出可执行的优化建议。

## 输入
你会收到指定数据源/日期的一段日志（JSONL 中的 warn/error 级别条目，含时间、级别、消息与上下文）。

## 分析维度
1. 错误模式——按消息聚类，找出出现最多的错误及其根因线索（超时/网络/限流/解析/代码缺陷/参数校验等）
2. 影响评估——错误与警告的规模、是否集中在某个时段或模块
3. 优化建议——针对每种模式给出具体、可执行的修复建议（超时、代理、限流、容错、空值判断等）
4. 紧急事项——需要立即处理的问题（崩溃、未捕获异常、内存溢出等）

## 约束
- 所有结论必须基于提供的日志条目，不编造不存在的错误
- 全部用中文回答

${OUTPUT_RULE}
{
  "total": 日志总数,
  "error_count": 错误条数,
  "warn_count": 警告条数,
  "patterns": ["错误模式1", "错误模式2"],
  "suggestions": ["优化建议1", "优化建议2"],
  "critical": ["需立即处理的问题（无则空数组）"],
  "llm_summary": "一段 150-250 字的日志分析总结（现象、主要根因、建议优先级）"
}`

/** Full tool set for the fund supervisor (可调全集). */
const FULL_TOOL_NAMES = [
  'search_funds', 'get_fund_detail', 'get_fund_estimate', 'get_fund_nav_history',
  'get_market_indices', 'get_market_news', 'get_hot_sectors', 'get_concept_sectors',
  'get_north_flow', 'get_market_breadth', 'get_main_flow', 'get_flash_news',
  'get_watchlist', 'screen_funds_by_4433', 'run_backtest', 'suggest_strategy',
  'get_stock_quote', 'get_market_anomaly', 'get_gold_realtime', 'get_fund_holdings',
  'get_fund_managers', 'get_funds_by_industry', 'get_industry_performance',
  'search_news', 'get_index_kline',
]

/** Market-side tool subset for portfolio diagnosis. */
const PORTFOLIO_TOOL_NAMES = [
  'get_market_indices', 'get_hot_sectors', 'get_north_flow', 'get_market_breadth',
  'get_main_flow', 'get_market_news', 'get_flash_news', 'get_index_kline',
  'get_industry_performance', 'get_fund_detail', 'get_fund_estimate',
]

/** Log analysis fallback: Node rule engine result + llm_error marker. */
async function logAnalysisFallback(ctx?: unknown): Promise<Record<string, unknown>> {
  const c = (ctx ?? {}) as { source?: string; date?: string; counts?: Record<string, number> }
  const source = c.source ?? 'dataservice'
  const date = c.date ?? ''
  const counts = c.counts ?? {}
  let rule: Record<string, unknown> | null = null
  try {
    const res = await fetch('/api/logs/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, date }),
    })
    const json = await res.json()
    if (json.success) rule = json.data ?? null
  } catch {
    // rule engine unavailable
  }
  const sum = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0)
  return {
    total: rule?.total ?? sum,
    error_count: rule?.error_count ?? (counts.error ?? 0),
    warn_count: rule?.warn_count ?? (counts.warn ?? 0),
    patterns: Array.isArray(rule?.patterns) ? rule.patterns : [],
    suggestions: Array.isArray(rule?.suggestions) ? rule.suggestions : [],
    critical: Array.isArray(rule?.critical) ? rule.critical : [],
    llm_error: 'AI 分析不可用（未配置密钥或模型调用失败），已回退到规则引擎结果',
  }
}

export const ANALYSIS_SCENARIOS: Record<string, AnalysisScenario> = {
  fund_analysis: {
    id: 'fund_analysis',
    name: 'fund_analysis',
    description: '基金深度分析：4 位分析师并行 + 总监合成',
    keywords: [],
    systemPrompt: SUPERVISOR_PROMPT,
    outputSchema: FundAnalysisResultSchema,
    pipeline: 'multi-analyst',
    toolNames: FULL_TOOL_NAMES,
    analysts: [
      { role: 'performance', analystPrompt: PERFORMANCE_PROMPT, toolNames: ['get_fund_nav_history', 'get_fund_estimate', 'get_index_kline'] },
      { role: 'holding', analystPrompt: HOLDING_PROMPT, toolNames: ['get_fund_holdings', 'get_fund_detail'] },
      { role: 'manager', analystPrompt: MANAGER_PROMPT, toolNames: ['get_fund_managers', 'get_fund_detail'] },
      { role: 'market', analystPrompt: MARKET_PROMPT, toolNames: ['get_market_news', 'get_hot_sectors', 'get_concept_sectors', 'get_index_kline', 'get_north_flow', 'get_main_flow', 'search_news'] },
    ],
  },
  portfolio_diagnosis: {
    id: 'portfolio_diagnosis',
    name: 'portfolio_diagnosis',
    description: '组合诊断：持仓汇总 + 市场面工具',
    keywords: [],
    systemPrompt: PORTFOLIO_PROMPT,
    outputSchema: PortfolioAnalysisResultSchema,
    pipeline: 'single',
    toolNames: PORTFOLIO_TOOL_NAMES,
  },
  log_analysis: {
    id: 'log_analysis',
    name: 'log_analysis',
    description: '日志 AI 分析：错误模式 + 优化建议（规则引擎降级）',
    keywords: [],
    systemPrompt: LOG_ANALYSIS_PROMPT,
    outputSchema: LogAnalysisSchema,
    pipeline: 'single',
    toolNames: [],
    fallback: logAnalysisFallback,
  },
}

export const FUND_ANALYSIS_SCENARIO = ANALYSIS_SCENARIOS.fund_analysis
export const PORTFOLIO_DIAGNOSIS_SCENARIO = ANALYSIS_SCENARIOS.portfolio_diagnosis
export const LOG_ANALYSIS_SCENARIO = ANALYSIS_SCENARIOS.log_analysis
