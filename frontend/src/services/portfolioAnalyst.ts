/**
 * Frontend portfolio (组合) AI diagnosis.
 *
 * Public API (`analyzePortfolio` / `fallbackPortfolioResult`) is unchanged;
 * internally the LLM pass now runs through the shared analysis engine
 * (`analysis/analysisEngine.ts`) with the `portfolio_diagnosis` scenario
 * (market-side tools + `get_fund_detail`/`get_fund_estimate`), schema-validated
 * structured output, and the same degradation contract as elsewhere.
 */

import type { LLMConfig } from './llm'
import { runTask } from './analysis/analysisEngine'
import { PORTFOLIO_DIAGNOSIS_SCENARIO } from './analysis/analysisScenarios'
import { PortfolioAnalysisResultSchema } from './analysis/scenarioTypes'
import { fundAPI } from './api'

export interface PortfolioFundInput {
  code: string
  share?: number
  cost?: number
  weight_pct?: number
}

export interface PortfolioAnalysisRequest {
  funds: PortfolioFundInput[]
  strategyContext?: string
}

export interface PortfolioAnalysisResult {
  fund_code: string
  fund_name: string
  rating: string | null
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

const MAX_FUNDS = 20
const DEFAULT_MODEL = 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B'

function formatWeight(input: PortfolioFundInput): string {
  if (input.weight_pct != null && input.weight_pct > 0) {
    return `权重${input.weight_pct.toFixed(1)}%`
  }
  return ''
}

function buildPortfolioContext(inputs: PortfolioFundInput[], details: Map<string, any>): string {
  const lines = inputs.map((f) => {
    const detail = details.get(f.code)
    const basic = detail?.sections?.basic?.data
    const perf = detail?.sections?.performance?.data
    const holdings = detail?.sections?.holdings?.data?.items?.slice(0, 5) ?? []
    const parts = [
      `- ${basic?.name ?? f.code}（${f.code}）${basic?.type ?? ''}`,
      formatWeight(f),
      perf?.return1m != null ? `近1月${perf.return1m >= 0 ? '+' : ''}${(perf.return1m * 100).toFixed(2)}%` : '',
      perf?.return3m != null ? `近3月${perf.return3m >= 0 ? '+' : ''}${(perf.return3m * 100).toFixed(2)}%` : '',
      holdings.length > 0
        ? `重仓：${holdings.map((h: any) => `${h.stockName ?? h.stockCode}${h.ratio != null ? ` ${(h.ratio * 100).toFixed(1)}%` : ''}`).join('、')}`
        : '',
    ].filter(Boolean)
    return parts.join(' · ')
  })
  return lines.length > 0 ? `## 持仓明细\n${lines.join('\n')}` : '暂无持仓明细'
}

export function fallbackPortfolioResult(inputs: PortfolioFundInput[], missingKey = false): PortfolioAnalysisResult {
  const count = inputs.length
  const reason = missingKey
    ? 'AI 服务未配置：请先在设置中配置 AI 服务密钥，再进行组合诊断。'
    : 'AI 组合诊断生成失败，请稍后重试。'
  return {
    fund_code: '',
    fund_name: '我的持仓',
    rating: null,
    sentiment_score: 50,
    operation_advice: reason,
    summary: `共 ${count} 只基金，数据已汇总，但未能生成完整诊断。${reason}`,
    dashboard: {
      performance_eval: '—',
      manager_ability: '—',
      position_analysis: '—',
      market_outlook: '—',
    },
    highlights: [],
    risk_factors: [],
    news_intel: [],
    detailed_report: `## 组合概况\n共持有 ${count} 只基金。\n\n## 提示\n${reason}`,
  }
}

export async function analyzePortfolio(
  req: PortfolioAnalysisRequest,
  llmConfig?: LLMConfig,
): Promise<PortfolioAnalysisResult> {
  const inputs = (req.funds ?? []).slice(0, MAX_FUNDS)
  if (inputs.length === 0) {
    return fallbackPortfolioResult([], false)
  }

  if (!llmConfig?.apiKey) {
    return fallbackPortfolioResult(inputs, true)
  }

  // Fetch fund details in parallel, tolerating individual failures.
  const settled = await Promise.allSettled(inputs.map((f) => fundAPI.getFundDetail(f.code)))
  const details = new Map<string, any | null>()
  settled.forEach((s, i) => {
    const code = inputs[i]?.code ?? ''
    details.set(code, s.status === 'fulfilled' ? s.value?.data?.data ?? null : null)
  })

  const portfolioCtx = buildPortfolioContext(inputs, details)
  const userPrompt = [portfolioCtx].filter(Boolean).join('\n\n')
  const config: LLMConfig = {
    apiKey: llmConfig.apiKey,
    apiBase: llmConfig.apiBase,
    model: llmConfig.model || DEFAULT_MODEL,
  }

  let result: PortfolioAnalysisResult | null = null
  const gen = runTask({
    systemPrompt: PORTFOLIO_DIAGNOSIS_SCENARIO.systemPrompt,
    toolNames: PORTFOLIO_DIAGNOSIS_SCENARIO.toolNames,
    outputSchema: PortfolioAnalysisResultSchema,
    userPrompt,
    llmConfig: config,
    model: config.model,
    strategyContext: req.strategyContext,
    fallback: () => fallbackPortfolioResult(inputs, false),
  })
  for await (const ev of gen) {
    if (ev.event === 'result') {
      try {
        result = JSON.parse(ev.data)
      } catch {
        // keep null
      }
    }
  }

  return result ?? fallbackPortfolioResult(inputs, false)
}
