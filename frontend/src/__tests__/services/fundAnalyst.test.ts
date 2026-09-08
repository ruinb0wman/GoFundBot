import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  chatCompletion: vi.fn(),
  chatCompletionJson: vi.fn(),
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

import { analyzeFund, analyzeFundStream, type AnalystInput } from '../../services/fundAnalyst'

const LLM_OK = { apiKey: 'test-key', apiBase: 'https://local.test/v1', model: 'test-model' }

const report = (role: string) => ({
  analyst_role: role,
  thesis: `${role} 分析结论：业绩稳健，持仓均衡。`,
  score: 8,
  key_evidence: ['证据一', '证据二'],
  risk_flags: ['波动放大'],
})

const SUPERVISOR = {
  rating: 'Buy',
  sentiment_score: 72,
  operation_advice: '建议买入',
  summary: '综合四位分析师观点，基金质量良好。',
  dashboard: { performance_eval: '良好', manager_ability: '良好', position_analysis: '均衡', market_outlook: '乐观' },
  highlights: ['长期业绩稳健'],
  risk_factors: ['行业集中'],
  news_intel: ['板块资金流入'],
  detailed_report: '## 深度报告\n综合四位分析师观点……',
}

function analystReportBySystemPrompt(sys: string) {
  // supervisor prompt mentions the analyst roles; check director first
  if (sys.includes('基金研究总监')) return null
  if (sys.includes('业绩分析师')) return report('performance')
  if (sys.includes('持仓分析师')) return report('holding')
  if (sys.includes('经理分析师')) return report('manager')
  if (sys.includes('市场环境分析师')) return report('market')
  return null
}

function routeBySystemPrompt(sys: string) {
  const r = analystReportBySystemPrompt(sys)
  if (r) return JSON.stringify(r)
  return JSON.stringify(SUPERVISOR)
}

const INPUT: AnalystInput = {
  fundCode: '019667',
  fundName: '测试基金',
  fundType: '混合型',
  riskMetrics: { sharpe: 1.2, maxDrawdown: -0.18 },
  holdings: [{ name: '贵州茅台', ratio: 0.08 }],
  managers: [{ name: '张三', workExperience: 8, managedFundSize: '50亿' }],
  industryTag: '白酒',
  marketContext: '今日白酒板块领涨',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('analyzeFund (4+1 engine path)', () => {
  it('runs 4 analysts in parallel then the supervisor, and assembles the full result', async () => {
    mocks.chatCompletion.mockImplementation(async (_config: any, opts: any) => {
      const sys = (opts.messages as any[]).find((m: any) => m.role === 'system')?.content ?? ''
      return { content: routeBySystemPrompt(sys), tool_calls: undefined }
    })

    const result = await analyzeFund(INPUT, LLM_OK)

    expect(result.fund_code).toBe('019667')
    expect(result.fund_name).toBe('测试基金')
    expect(result.reports).toHaveLength(4)
    expect(result.reports.map((r) => r.analyst_role)).toEqual(['performance', 'holding', 'manager', 'market'])
    expect(result.supervisor?.rating).toBe('Buy')
    expect(result.supervisor?.sentiment_score).toBe(72)

    // 4 analyst tasks + 1 supervisor task
    expect(mocks.chatCompletion).toHaveBeenCalledTimes(5)
    const supervisorSys = mocks.chatCompletion.mock.calls[4][1].messages.find(
      (m: any) => m.role === 'system',
    ).content
    expect(supervisorSys).toContain('基金研究总监')
    // supervisor prompt received the assembled analyst reports
    const supervisorUser = mocks.chatCompletion.mock.calls[4][1].messages.find((m: any) => m.role === 'user').content
    expect(supervisorUser).toContain('分析师报告')
    expect(supervisorUser).toContain('performance')
  })

  it('stream keeps the start/stage/token/result/done stage semantics', async () => {
    mocks.chatCompletion.mockImplementation(async (_config: any, opts: any) => {
      const sys = (opts.messages as any[]).find((m: any) => m.role === 'system')?.content ?? ''
      return { content: routeBySystemPrompt(sys), tool_calls: undefined }
    })

    const events: Array<{ stage: string; content: string }> = []
    for await (const ev of analyzeFundStream(INPUT, LLM_OK)) events.push(ev)

    const stages = events.map((e) => e.stage)
    expect(stages[0]).toBe('start')
    expect(stages.filter((s) => s === 'stage')).toHaveLength(5) // 4 analysts + supervisor
    expect(stages.filter((s) => s === 'token')).toHaveLength(4)
    expect(stages[stages.length - 2]).toBe('result')
    expect(stages[stages.length - 1]).toBe('done')

    const reports = events.filter((e) => e.stage === 'token').map((e) => JSON.parse(e.content))
    expect(reports.every((r) => typeof r.thesis === 'string' && typeof r.score === 'number')).toBe(true)
    const supervisor = JSON.parse(events[events.length - 2].content)
    expect(supervisor.rating).toBe('Buy')
  })

  it('degrades to structured fallback reports + null supervisor when the key is missing (no LLM calls)', async () => {
    const result = await analyzeFund(INPUT, { apiKey: '' })

    expect(mocks.chatCompletion).not.toHaveBeenCalled()
    expect(mocks.chatCompletionJson).not.toHaveBeenCalled()
    expect(result.reports).toHaveLength(4)
    expect(result.reports.every((r) => r.thesis.includes('调用异常'))).toBe(true)
    expect(result.reports.every((r) => r.score === 5)).toBe(true)
    expect(result.supervisor).toBeNull()
  })

  it('keeps the 4 reports when only the supervisor LLM call fails', async () => {
    mocks.chatCompletion.mockImplementation(async (_config: any, opts: any) => {
      const sys = (opts.messages as any[]).find((m: any) => m.role === 'system')?.content ?? ''
      const r = analystReportBySystemPrompt(sys)
      if (r) return { content: JSON.stringify(r), tool_calls: undefined }
      throw new Error('supervisor call failed')
    })

    const result = await analyzeFund(INPUT, LLM_OK)
    expect(result.reports).toHaveLength(4)
    expect(result.reports.map((r) => r.analyst_role)).toEqual(['performance', 'holding', 'manager', 'market'])
    expect(result.supervisor).toBeNull()
  })
})
