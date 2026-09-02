/**
 * Frontend fund AI analysis (4 analysts + supervisor synthesis).
 * Ported from Service `aiAnalyst.ts` / `fundLegacy.routes.ts` analyze/stream.
 * Prompts are embedded as TS strings; LLM calls go through `llm.ts`.
 */

import { chatCompletionJson, type LLMConfig } from './llm'

export interface AnalystInput {
  fundCode: string
  fundName: string
  fundType?: string
  netWorthTrend?: Array<{ date: string; netWorth: number }>
  riskMetrics?: Record<string, number | null>
  holdings?: Array<{ name?: string; code?: string; ratio?: number }>
  managers?: Array<{
    name?: string
    workExperience?: number
    managedFundSize?: string
  }>
  industryTag?: string
  marketContext?: string
  pastContext?: string
  strategyContext?: string
}

export interface AnalystReport {
  analyst_role: string
  thesis: string
  score: number
  key_evidence: string[]
  risk_flags: string[]
}

export interface SupervisorOutput {
  rating: 'Strong Buy' | 'Buy' | 'Hold' | 'Underweight' | 'Sell'
  sentiment_score: number
  operation_advice: string
  summary: string
  dashboard: {
    performance_eval: string
    manager_ability: string
    position_analysis: string
    market_outlook: string
  }
  highlights: string[]
  risk_factors: string[]
  news_intel: string[]
  detailed_report: string
}

export interface FundAnalysisResult {
  fund_code: string
  fund_name: string
  reports: AnalystReport[]
  supervisor: SupervisorOutput | null
}

const PERFORMANCE_PROMPT = `你是一位基金业绩分析师。

你的任务是基于基金的收益和风险数据给出客观分析。请着重关注：
1. 收益表现——各区间收益率（近1月/3月/6月/1年）的绝对和相对表现
2. 风险调整收益——夏普比率、卡玛比率等风险调整后的回报
3. 回撤控制——最大回撤幅度和恢复能力
4. 波动率——年化波动率水平及稳定性
5. 同类排名——在同类基金中的排名百分位变化趋势

输出要求（纯 JSON，不要 markdown 包裹）：
{
    "analyst_role": "performance",
    "thesis": "业绩分析结论（200-300字）",
    "score": 0-10 的评分，
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

输出要求（纯 JSON，不要 markdown 包裹）：
{
    "analyst_role": "holding",
    "thesis": "持仓分析结论（200-300字）",
    "score": 0-10 的评分，
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

输出要求（纯 JSON，不要 markdown 包裹）：
{
    "analyst_role": "manager",
    "thesis": "经理分析结论（200-300字）",
    "score": 0-10 的评分，
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

输出要求（纯 JSON，不要 markdown 包裹）：
{
    "analyst_role": "market",
    "thesis": "市场环境分析结论（200-300字）",
    "score": 0-10 的评分，
    "key_evidence": ["证据1", "证据2", "证据3"],
    "risk_flags": ["需要关注的风险因素"]
}`

const SUPERVISOR_PROMPT = `你是一位基金研究总监。

你的团队中有四位专业分析师完成了各自维度的分析：
1. 业绩分析师——分析了基金的收益和风险指标
2. 持仓分析师——分析了基金的重仓持股和资产配置
3. 经理分析师——分析了基金经理的经验和能力
4. 市场分析师——分析了当前市场环境和行业趋势

请综合四位分析师的观点，做出客观公正的最终裁决。

输出要求（纯 JSON，不要 markdown 包裹）：
{
    "rating": "Strong Buy"/"Buy"/"Hold"/"Underweight"/"Sell"，
    "sentiment_score": 0-100，
    "operation_advice": "强烈推荐"/"建议买入"/"持有观望"/"建议减仓"/"建议卖出"，
    "summary": "综合四位分析师观点后的总结（200-300字）",
    "dashboard": {
        "performance_eval": "优秀/良好/一般/较差",
        "manager_ability": "优秀/良好/一般/较差",
        "position_analysis": "集中/均衡/分散",
        "market_outlook": "乐观/中性/谨慎"
    },
    "highlights": ["亮点1", "亮点2", "亮点3"],
    "risk_factors": ["风险1", "风险2", "风险3"],
    "news_intel": ["相关市场信息1", "相关市场信息2"],
    "detailed_report": "深度分析报告（Markdown格式，不少于500字，包含每位分析师观点引用）"
}`

const DEFAULT_ANALYST_MODEL = 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B'

/** Build a "user strategy" section appended to analyst prompts, if provided. */
export function strategyNote(ctx?: string): string {
  const trimmed = ctx?.trim()
  if (!trimmed) return ''
  return `## 用户投资策略\n分析师给出评价与建议时需贴合用户的策略取向（投资期限、风险偏好、风格偏好等），但不得为迎合策略而歪曲数据。\n${trimmed}`
}

function clampScore(score: unknown): number {
  return typeof score === 'number' ? score : 5
}

async function callAnalyst(
  role: string,
  systemPrompt: string,
  fundInfo: string,
  extra: string,
  llmConfig: LLMConfig,
): Promise<AnalystReport> {
  const userPrompt = `基金信息：\n${fundInfo}\n\n详细数据：\n${extra}\n\n请进行分析并输出JSON。`
  try {
    const parsed = await chatCompletionJson<Partial<AnalystReport>>(
      { ...llmConfig, model: llmConfig.model || DEFAULT_ANALYST_MODEL },
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      },
    )
    return {
      analyst_role: role,
      thesis: parsed.thesis ?? '',
      score: clampScore(parsed.score),
      key_evidence: Array.isArray(parsed.key_evidence) ? parsed.key_evidence : [],
      risk_flags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags : [],
    }
  } catch {
    return {
      analyst_role: role,
      thesis: `${role}分析师调用异常，分析未完成`,
      score: 5,
      key_evidence: [`${role}分析师：LLM API 调用失败`],
      risk_flags: [],
    }
  }
}

async function callSupervisor(
  reports: AnalystReport[],
  fundInfo: string,
  llmConfig: LLMConfig,
  strategyContext?: string,
): Promise<SupervisorOutput | null> {
  const reportsStr = reports
    .map(
      (r) =>
        `### ${r.analyst_role}\n评分：${r.score}/10\n核心论点：${r.thesis}\n关键证据：${r.key_evidence.join(', ')}`,
    )
    .join('\n\n')

  const strategyCtx = strategyNote(strategyContext)
  const userPrompt = `基金信息：\n${fundInfo}\n\n分析师报告：\n${reportsStr}\n\n${strategyCtx}\n\n请综合四位分析师观点，输出最终裁决JSON。`

  try {
    return await chatCompletionJson<SupervisorOutput>(
      { ...llmConfig, model: llmConfig.model || DEFAULT_ANALYST_MODEL },
      {
        messages: [
          { role: 'system', content: SUPERVISOR_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 8192,
      },
    )
  } catch {
    return null
  }
}

function buildFundInfo(input: AnalystInput): string {
  return `代码：${input.fundCode}\n名称：${input.fundName}\n类型：${input.fundType ?? '未知'}`
}

export async function analyzeFund(input: AnalystInput, llmConfig?: LLMConfig): Promise<FundAnalysisResult> {
  const config = llmConfig || { apiKey: '', apiBase: 'https://api.siliconflow.cn/v1' }
  const fundInfo = buildFundInfo(input)

  const perfExtra = [
    input.riskMetrics ? `风险指标：${JSON.stringify(input.riskMetrics, null, 2)}` : '',
    input.netWorthTrend ? `净值数据：${input.netWorthTrend.length} 个数据点` : '',
    `行业标签：${input.industryTag ?? '未知'}`,
    strategyNote(input.strategyContext),
  ].filter(Boolean).join('\n')

  const holdingExtra = [
    input.holdings
      ? `持仓数据：\n${input.holdings.map((h) => `- ${h.name ?? h.code ?? '未知'}: ${h.ratio ? (h.ratio * 100).toFixed(2) + '%' : '未知'}`).join('\n')}`
      : '暂无持仓数据',
    strategyNote(input.strategyContext),
  ].filter(Boolean).join('\n')

  const managerExtra = [
    input.managers
      ? `经理信息：\n${input.managers.map((m) => `- ${m.name ?? '未知'}：从业${m.workExperience ?? '未知'}年，管理规模${m.managedFundSize ?? '未知'}`).join('\n')}`
      : '暂无经理信息',
    strategyNote(input.strategyContext),
  ].filter(Boolean).join('\n')

  const marketExtra = [
    input.marketContext ?? `行业标签：${input.industryTag ?? '未知'}`,
    input.pastContext ?? '',
    strategyNote(input.strategyContext),
  ].filter(Boolean).join('\n\n')

  const [perfReport, holdingReport, managerReport, marketReport] = await Promise.all([
    callAnalyst('performance', PERFORMANCE_PROMPT, fundInfo, perfExtra, config),
    callAnalyst('holding', HOLDING_PROMPT, fundInfo, holdingExtra, config),
    callAnalyst('manager', MANAGER_PROMPT, fundInfo, managerExtra, config),
    callAnalyst('market', MARKET_PROMPT, fundInfo, marketExtra, config),
  ])

  const reports = [perfReport, holdingReport, managerReport, marketReport]
  const supervisor = await callSupervisor(reports, fundInfo, config, input.strategyContext)

  return {
    fund_code: input.fundCode,
    fund_name: input.fundName,
    reports,
    supervisor,
  }
}

export async function* analyzeFundStream(
  input: AnalystInput,
  llmConfig?: LLMConfig,
): AsyncGenerator<{ stage: string; content: string }> {
  const config = llmConfig || { apiKey: '', apiBase: 'https://api.siliconflow.cn/v1' }
  yield { stage: 'start', content: `开始分析 ${input.fundName}` }

  const fundInfo = buildFundInfo(input)

  yield { stage: 'stage', content: 'performance分析师工作中...' }
  const perfExtra = [
    input.riskMetrics ? JSON.stringify(input.riskMetrics, null, 2) : '暂无风险数据',
    strategyNote(input.strategyContext),
  ].filter(Boolean).join('\n')
  const perfReport = await callAnalyst('performance', PERFORMANCE_PROMPT, fundInfo, perfExtra, config)
  yield { stage: 'token', content: JSON.stringify(perfReport) }

  yield { stage: 'stage', content: 'holding分析师工作中...' }
  const holdingExtra = [
    input.holdings ? JSON.stringify(input.holdings) : '暂无持仓数据',
    strategyNote(input.strategyContext),
  ].filter(Boolean).join('\n')
  const holdingReport = await callAnalyst('holding', HOLDING_PROMPT, fundInfo, holdingExtra, config)
  yield { stage: 'token', content: JSON.stringify(holdingReport) }

  yield { stage: 'stage', content: 'manager分析师工作中...' }
  const managerExtra = [
    input.managers ? JSON.stringify(input.managers) : '暂无经理信息',
    strategyNote(input.strategyContext),
  ].filter(Boolean).join('\n')
  const managerReport = await callAnalyst('manager', MANAGER_PROMPT, fundInfo, managerExtra, config)
  yield { stage: 'token', content: JSON.stringify(managerReport) }

  yield { stage: 'stage', content: 'market分析师工作中...' }
  const marketExtra = [
    input.marketContext ?? `行业标签：${input.industryTag ?? '未知'}`,
    input.pastContext ?? '',
    strategyNote(input.strategyContext),
  ].filter(Boolean).join('\n\n')
  const marketReport = await callAnalyst('market', MARKET_PROMPT, fundInfo, marketExtra, config)
  yield { stage: 'token', content: JSON.stringify(marketReport) }

  yield { stage: 'stage', content: '总监合成最终报告...' }
  const reports = [perfReport, holdingReport, managerReport, marketReport]
  const supervisor = await callSupervisor(reports, fundInfo, config, input.strategyContext)
  yield { stage: 'result', content: JSON.stringify(supervisor) }

  yield { stage: 'done', content: '' }
}
