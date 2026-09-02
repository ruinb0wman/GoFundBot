/**
 * Frontend portfolio (组合) AI diagnosis.
 * Ported from Service `portfolioAnalyst.ts` + `userData.routes.ts` /analyze.
 * LLM via `llm.ts`; fund details fetched via api.ts.
 */

import { chatCompletionJson, type LLMConfig } from './llm'
import { fundAPI } from './api'

const PORTFOLIO_PROMPT = `你是一位基金组合诊断专家，负责对用户持有的多只基金进行组合层面的分析诊断。

## 输入
你会收到用户持仓的多只基金的汇总数据（类型、权重、近期收益、重仓股等），以及"用户投资策略"段落（如有）。

## 分析维度
1. 组合表现：整体收益情况、近期表现优劣
2. 分散程度：行业/风格/基金类型是否过度集中或过度分散
3. 持仓结构：权重分配的合理性、与用户策略的匹配度
4. 市场判断：结合组合特征对后市给出定位判断

## 输出要求
只输出 JSON 对象，字段如下：
{
  "rating": "Strong Buy|Buy|Hold|Underweight|Sell 之一",
  "sentiment_score": 0-100 的整数（看多程度，50 为中性），
  "operation_advice": "一段简短的操作建议（中文）",
  "summary": "组合诊断总结（中文，2-3句）",
  "dashboard": {
    "performance_eval": "优秀|良好|一般|较差",
    "manager_ability": "高|中|低（分散程度评价）",
    "position_analysis": "合理|偏集中|偏分散（持仓结构评价）",
    "market_outlook": "乐观|中性|谨慎"
  },
  "highlights": ["组合亮点数组"],
  "risk_factors": ["风险因素数组"],
  "news_intel": [],
  "detailed_report": "详细报告（markdown，包含 ## 章节：组合表现/分散程度/持仓结构/市场判断/操作建议）"
}

## 约束
- 所有判断必须基于提供的持仓数据，不编造数据、不编造基金名称
- 若提供"用户投资策略"，操作建议应贴合用户的策略取向（投资期限、风险偏好、风格偏好等），但不得为迎合策略而歪曲数据
- 全部用中文回答
`

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
  const strategyCtx = req.strategyContext?.trim()
    ? `## 用户投资策略\n分析师给出建议时需贴合用户的策略取向，但不得为迎合策略而歪曲数据。\n${req.strategyContext.trim()}`
    : ''

  const userPrompt = [portfolioCtx, strategyCtx].filter(Boolean).join('\n\n')
  const model = llmConfig.model || DEFAULT_MODEL

  try {
    const parsed = await chatCompletionJson<Partial<PortfolioAnalysisResult>>(
      { ...llmConfig, model },
      {
        messages: [
          { role: 'system', content: PORTFOLIO_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 8192,
      },
    )
    return {
      fund_code: '',
      fund_name: '我的持仓',
      rating: typeof parsed.rating === 'string' ? parsed.rating : null,
      sentiment_score: typeof parsed.sentiment_score === 'number' ? Math.max(0, Math.min(100, parsed.sentiment_score)) : 50,
      operation_advice: parsed.operation_advice ?? '',
      summary: parsed.summary ?? '',
      dashboard: {
        performance_eval: parsed.dashboard?.performance_eval ?? '—',
        manager_ability: parsed.dashboard?.manager_ability ?? '—',
        position_analysis: parsed.dashboard?.position_analysis ?? '—',
        market_outlook: parsed.dashboard?.market_outlook ?? '—',
      },
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      risk_factors: Array.isArray(parsed.risk_factors) ? parsed.risk_factors : [],
      news_intel: Array.isArray(parsed.news_intel) ? parsed.news_intel : [],
      detailed_report: parsed.detailed_report ?? '',
    }
  } catch {
    return fallbackPortfolioResult(inputs, false)
  }
}
