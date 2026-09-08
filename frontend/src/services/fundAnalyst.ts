/**
 * Frontend fund AI analysis (4 analysts + supervisor synthesis).
 *
 * Public API and stream stage semantics (`start/stage/token/result/done`) are
 * unchanged; internally each analyst and the supervisor now run through the
 * shared analysis engine (`analysis/analysisEngine.ts`) — same tool-call
 * normalization / validation / `{ok,data}|{ok,error}` envelope / schema-checked
 * structured output as chat. The 4 analysts run in parallel (each with a tool
 * subset), the supervisor serially with the full tool set.
 */

import type { LLMConfig } from './llm'
import { runTask } from './analysis/analysisEngine'
import { FUND_ANALYSIS_SCENARIO } from './analysis/analysisScenarios'
import { AnalystReportSchema, SupervisorOutputSchema } from './analysis/scenarioTypes'

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

const DEFAULT_ANALYST_MODEL = 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B'

function buildFundInfo(input: AnalystInput): string {
  return `代码：${input.fundCode}\n名称：${input.fundName}\n类型：${input.fundType ?? '未知'}`
}

/** Analyst failure report, same shape as the legacy catch branch. */
function analystFallback(role: string): () => AnalystReport {
  return () => ({
    analyst_role: role,
    thesis: `${role}分析师调用异常，分析未完成`,
    score: 5,
    key_evidence: [`${role}分析师：LLM API 调用失败`],
    risk_flags: [],
  })
}

function buildPerfExtra(input: AnalystInput): string {
  return [
    input.riskMetrics ? `风险指标：${JSON.stringify(input.riskMetrics, null, 2)}` : '',
    input.netWorthTrend ? `净值数据：${input.netWorthTrend.length} 个数据点` : '',
    `行业标签：${input.industryTag ?? '未知'}`,
  ].filter(Boolean).join('\n')
}

function buildHoldingExtra(input: AnalystInput): string {
  return input.holdings
    ? `持仓数据：\n${input.holdings.map((h) => `- ${h.name ?? h.code ?? '未知'}: ${h.ratio ? (h.ratio * 100).toFixed(2) + '%' : '未知'}`).join('\n')}`
    : '暂无持仓数据'
}

function buildManagerExtra(input: AnalystInput): string {
  return input.managers
    ? `经理信息：\n${input.managers.map((m) => `- ${m.name ?? '未知'}：从业${m.workExperience ?? '未知'}年，管理规模${m.managedFundSize ?? '未知'}`).join('\n')}`
    : '暂无经理信息'
}

function buildMarketExtra(input: AnalystInput): string {
  return [
    input.marketContext ?? `行业标签：${input.industryTag ?? '未知'}`,
    input.pastContext ?? '',
  ].filter(Boolean).join('\n\n')
}

function analystUserPrompt(fundInfo: string, extra: string): string {
  return `基金信息：\n${fundInfo}\n\n详细数据：\n${extra}\n\n请进行分析并输出JSON。`
}

/** Run one analyst task through the engine and return the validated report. */
async function runAnalyst(
  role: string,
  analystPrompt: string,
  toolNames: string[],
  userPrompt: string,
  config: LLMConfig,
  strategyContext: string | undefined,
): Promise<AnalystReport> {
  let report: AnalystReport | null = null
  const gen = runTask({
    systemPrompt: analystPrompt,
    toolNames,
    outputSchema: AnalystReportSchema,
    userPrompt,
    llmConfig: config,
    model: config.model || DEFAULT_ANALYST_MODEL,
    strategyContext,
    fallback: analystFallback(role),
  })
  for await (const ev of gen) {
    if (ev.event === 'result') {
      try {
        report = JSON.parse(ev.data)
      } catch {
        // keep null → fallback below
      }
    }
  }
  return report ?? analystFallback(role)()
}

/** Run the supervisor pass through the engine (full tool set, serial). */
async function runSupervisor(
  reports: AnalystReport[],
  fundInfo: string,
  config: LLMConfig,
  strategyContext: string | undefined,
): Promise<SupervisorOutput | null> {
  const reportsStr = reports
    .map(
      (r) =>
        `### ${r.analyst_role}\n评分：${r.score}/10\n核心论点：${r.thesis}\n关键证据：${r.key_evidence.join(', ')}`,
    )
    .join('\n\n')

  const userPrompt = `基金信息：\n${fundInfo}\n\n分析师报告：\n${reportsStr}\n\n请综合四位分析师观点，输出最终裁决JSON。`

  let supervisor: SupervisorOutput | null = null
  const gen = runTask({
    systemPrompt: FUND_ANALYSIS_SCENARIO.systemPrompt,
    toolNames: FUND_ANALYSIS_SCENARIO.toolNames,
    outputSchema: SupervisorOutputSchema,
    userPrompt,
    llmConfig: config,
    model: config.model || DEFAULT_ANALYST_MODEL,
    strategyContext,
    fallback: () => null,
  })
  for await (const ev of gen) {
    if (ev.event === 'result') {
      try {
        supervisor = JSON.parse(ev.data)
      } catch {
        // keep null
      }
    }
  }
  return supervisor
}

export async function* analyzeFundStream(
  input: AnalystInput,
  llmConfig?: LLMConfig,
): AsyncGenerator<{ stage: string; content: string }> {
  const config: LLMConfig = llmConfig || { apiKey: '', apiBase: 'https://api.siliconflow.cn/v1' }
  yield { stage: 'start', content: `开始分析 ${input.fundName}` }

  const fundInfo = buildFundInfo(input)
  const strategyContext = input.strategyContext
  const analysts = FUND_ANALYSIS_SCENARIO.analysts ?? []

  for (const a of analysts) {
    yield { stage: 'stage', content: `${a.role}分析师工作中...` }
  }

  const extras: Record<string, string> = {
    performance: buildPerfExtra(input),
    holding: buildHoldingExtra(input),
    manager: buildManagerExtra(input),
    market: buildMarketExtra(input),
  }

  const tasks = analysts.map((a) =>
    runAnalyst(a.role, a.analystPrompt, a.toolNames, analystUserPrompt(fundInfo, extras[a.role] ?? ''), config, strategyContext),
  )
  const reports = await Promise.all(tasks)

  for (const r of reports) {
    yield { stage: 'token', content: JSON.stringify(r) }
  }

  yield { stage: 'stage', content: '总监合成最终报告...' }
  const supervisor = await runSupervisor(reports, fundInfo, config, strategyContext)
  yield { stage: 'result', content: JSON.stringify(supervisor) }

  yield { stage: 'done', content: '' }
}

export async function analyzeFund(input: AnalystInput, llmConfig?: LLMConfig): Promise<FundAnalysisResult> {
  const reports: AnalystReport[] = []
  let supervisor: SupervisorOutput | null = null
  for await (const ev of analyzeFundStream(input, llmConfig)) {
    if (ev.stage === 'token') {
      try {
        const r = JSON.parse(ev.content) as AnalystReport
        if (r && typeof r === 'object' && typeof r.analyst_role === 'string') reports.push(r)
      } catch {
        // ignore malformed report
      }
    } else if (ev.stage === 'result') {
      try {
        supervisor = JSON.parse(ev.content)
      } catch {
        // keep null
      }
    }
  }
  return {
    fund_code: input.fundCode,
    fund_name: input.fundName,
    reports,
    supervisor,
  }
}
