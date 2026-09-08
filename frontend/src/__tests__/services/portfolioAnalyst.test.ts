import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  chatCompletion: vi.fn(),
  chatCompletionJson: vi.fn(),
  getFundDetail: vi.fn(),
}))

vi.mock('../../services/llm', () => ({
  chatCompletion: mocks.chatCompletion,
  chatCompletionJson: mocks.chatCompletionJson,
  extractJson: (raw: string) => {
    const stripped = raw.trim()
    if (stripped.startsWith('{')) return stripped
    const jsonMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) return jsonMatch[1].trim()
    const objMatch = stripped.match(/\{[\s\S]*\}/)
    if (objMatch) return objMatch[0]
    return stripped
  },
}))
vi.mock('../../services/chatEngine/toolHandlers', () => ({
  executeTool: vi.fn(),
}))
vi.mock('../../services/api', () => ({
  fundAPI: { getFundDetail: mocks.getFundDetail },
}))

import { analyzePortfolio, type PortfolioAnalysisRequest } from '../../services/portfolioAnalyst'

const LLM_OK = { apiKey: 'test-key', apiBase: 'https://local.test/v1', model: 'test-model' }

const PORTFOLIO_LLM = {
  fund_code: '',
  fund_name: '我的持仓',
  rating: 'Hold',
  sentiment_score: 55,
  operation_advice: '均衡配置，关注白酒板块回撤风险。',
  summary: '组合整体均衡，单一行业暴露偏高。',
  dashboard: { performance_eval: '良好', manager_ability: '中', position_analysis: '偏集中', market_outlook: '中性' },
  highlights: ['分散在三类资产'],
  risk_factors: ['白酒行业集中度高'],
  news_intel: [],
  detailed_report: '## 组合表现\n组合近3月整体跑平。\n## 操作建议\n建议逢高降低行业集中度。',
}

function detailFor(code: string) {
  return {
    data: {
      data: {
        sections: {
          basic: { data: { code, name: `基金${code}`, type: '股票型' } },
          performance: { data: { return1m: 0.02, return3m: 0.06 } },
          holdings: { data: { items: [{ stockName: '贵州茅台', ratio: 0.09 }] } },
        },
      },
    },
  }
}

const REQ: PortfolioAnalysisRequest = {
  funds: [
    { code: '019667', weight_pct: 60 },
    { code: '005827', weight_pct: 40 },
  ],
  strategyContext: '长期持有，偏好均衡配置',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('analyzePortfolio (engine path)', () => {
  it('prefetches fund details and returns the schema-validated diagnosis', async () => {
    mocks.getFundDetail.mockImplementation(async (code: string) => detailFor(code))
    mocks.chatCompletion.mockResolvedValueOnce({ content: JSON.stringify(PORTFOLIO_LLM), tool_calls: undefined })

    const result = await analyzePortfolio(REQ, LLM_OK)

    // one detail fetch per fund, parallel
    expect(mocks.getFundDetail).toHaveBeenCalledTimes(2)
    expect(mocks.getFundDetail).toHaveBeenCalledWith('019667')
    expect(mocks.getFundDetail).toHaveBeenCalledWith('005827')

    // the model received the prefetched portfolio context + strategy (strategy in system prompt)
    const messages = mocks.chatCompletion.mock.calls[0][1].messages as any[]
    const userPrompt = messages.find((m: any) => m.role === 'user').content
    expect(userPrompt).toContain('基金019667')
    expect(userPrompt).toContain('近1月+2.00%')
    const systemPrompt = messages.find((m: any) => m.role === 'system').content
    expect(systemPrompt).toContain('长期持有，偏好均衡配置')

    expect(result.fund_code).toBe('')
    expect(result.fund_name).toBe('我的持仓')
    expect(result.rating).toBe('Hold')
    expect(result.sentiment_score).toBe(55)
    expect(result.operation_advice).toContain('均衡配置')
    expect(result.dashboard.position_analysis).toBe('偏集中')
    expect(result.highlights).toEqual(['分散在三类资产'])
    expect(result.risk_factors).toEqual(['白酒行业集中度高'])
  })

  it('returns fallbackPortfolioResult with missingKey hint when no API key is configured', async () => {
    const result = await analyzePortfolio(REQ, { apiKey: '' })

    expect(mocks.chatCompletion).not.toHaveBeenCalled()
    expect(mocks.getFundDetail).not.toHaveBeenCalled()
    expect(result.rating).toBeNull()
    expect(result.operation_advice).toContain('未配置')
    expect(result.summary).toContain('2 只基金')
  })

  it('returns the generic fallback when the LLM call fails', async () => {
    mocks.getFundDetail.mockImplementation(async (code: string) => detailFor(code))
    mocks.chatCompletion.mockRejectedValueOnce(new Error('upstream down'))

    const result = await analyzePortfolio(REQ, LLM_OK)

    expect(result.operation_advice).toContain('生成失败')
    expect(result.rating).toBeNull()
    expect(result.sentiment_score).toBe(50)
  })

  it('empty fund list short-circuits without LLM or detail fetches', async () => {
    const result = await analyzePortfolio({ funds: [] }, LLM_OK)
    expect(mocks.chatCompletion).not.toHaveBeenCalled()
    expect(mocks.getFundDetail).not.toHaveBeenCalled()
    expect(result.rating).toBeNull()
  })
})
