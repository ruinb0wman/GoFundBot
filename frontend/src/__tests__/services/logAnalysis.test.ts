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

import { analyzeLogsWithAI } from '../../services/analysis/logAnalysis'

const RULE_RESULT = {
  total: 18,
  error_count: 3,
  warn_count: 5,
  patterns: ['规则模式1', '规则模式2'],
  suggestions: ['规则建议1'],
  critical: ['规则紧急1'],
}

const READ_PAYLOAD = {
  success: true,
  data: {
    entries: [
      { level: 'error', time: '2026-07-28T10:00:00Z', message: 'fetch failed: upstream timeout', source: 'dataservice' },
      { level: 'warn', time: '2026-07-28T10:01:00Z', message: 'slow upstream response', source: 'dataservice' },
    ],
    total: 18,
    counts: { info: 10, warn: 5, error: 3 },
  },
}

const LLM_ANALYSIS = {
  total: 999,
  error_count: 9,
  warn_count: 7,
  patterns: ['LLM pattern A'],
  suggestions: ['LLM suggestion A'],
  critical: [],
  llm_summary: 'LLM 摘要：存在超时类错误，建议优先处理。',
}

function stubFetch(readPayload: unknown = READ_PAYLOAD, analyzePayload: unknown = RULE_RESULT) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/logs/read')) {
      return { ok: true, json: async () => readPayload }
    }
    if (u.includes('/logs/analyze')) {
      expect(init?.method).toBe('POST')
      return { ok: true, json: async () => ({ success: true, data: analyzePayload }) }
    }
    return { ok: false, json: async () => ({ success: false }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('analyzeLogsWithAI', () => {
  it('LLM path returns the LLM-enhanced result with authoritative counts from the read endpoint', async () => {
    stubFetch()
    mocks.chatCompletion.mockResolvedValueOnce({ content: '正在分析日志…', tool_calls: undefined })
    mocks.chatCompletionJson.mockResolvedValueOnce(LLM_ANALYSIS)

    const result = await analyzeLogsWithAI('dataservice', '2026-07-28', {
      apiKey: 'k',
      apiBase: 'https://local/v1',
      model: 'm',
    })

    // read endpoint reached with a bounded window (limit ≤ 500)
    const readCall = vi.mocked(globalThis.fetch).mock.calls.find((c) => String(c[0]).includes('/logs/read'))
    expect(String(readCall?.[0])).toContain('limit=500')
    expect(String(readCall?.[0])).not.toContain('level=') // no single-level filter; filtered client-side

    // the model received the warn/error context
    const userPrompt = mocks.chatCompletion.mock.calls[0][1].messages[1].content
    expect(userPrompt).toContain('[error]')
    expect(userPrompt).toContain('upstream timeout')
    expect(userPrompt).toContain('数据源：dataservice')

    // counts are authoritative (file totals win over model guesses)
    expect(result.total).toBe(18)
    expect(result.error_count).toBe(3)
    expect(result.warn_count).toBe(5)
    // LLM content kept
    expect(result.llm_summary).toBe('LLM 摘要：存在超时类错误，建议优先处理。')
    expect(result.patterns).toEqual(['LLM pattern A'])
    expect(result.suggestions).toEqual(['LLM suggestion A'])
    expect(result.llm_error).toBeUndefined()
  })

  it('no API key → skips the LLM and returns the rule-engine result + llm_error', async () => {
    const fetchMock = stubFetch()
    const result = await analyzeLogsWithAI('dataservice', '2026-07-28')

    expect(mocks.chatCompletion).not.toHaveBeenCalled()
    expect(mocks.chatCompletionJson).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/logs/analyze'))).toBe(true)

    expect(result.total).toBe(18)
    expect(result.error_count).toBe(3)
    expect(result.warn_count).toBe(5)
    expect(result.patterns).toEqual(['规则模式1', '规则模式2'])
    expect(result.suggestions).toEqual(['规则建议1'])
    expect(result.critical).toEqual(['规则紧急1'])
    expect(result.llm_error).toContain('回退')
    expect(result.llm_summary).toBeUndefined()
  })

  it('LLM failure → falls back to the rule engine and flags llm_error', async () => {
    stubFetch()
    mocks.chatCompletion.mockRejectedValueOnce(new Error('upstream down'))

    const result = await analyzeLogsWithAI('dataservice', '2026-07-28', {
      apiKey: 'k',
      apiBase: 'https://local/v1',
      model: 'm',
    })

    expect(result.llm_error).toContain('回退')
    expect(result.patterns).toEqual(['规则模式1', '规则模式2'])
    expect(result.total).toBe(18)
    expect(result.llm_summary).toBeUndefined()
  })

  it('truncates the log context to 500 warn/error entries', async () => {
    const entries = Array.from({ length: 500 }, (_, i) => ({
      level: 'error',
      time: `2026-07-28T${String((i % 24)).padStart(2, '0')}:00:00Z`,
      message: `error entry ${i}`,
    }))
    stubFetch({ success: true, data: { entries, total: 500, counts: { error: 500 } } })
    mocks.chatCompletion.mockResolvedValueOnce({ content: '正在分析', tool_calls: undefined })
    mocks.chatCompletionJson.mockResolvedValueOnce(LLM_ANALYSIS)

    await analyzeLogsWithAI('dataservice', '2026-07-28', { apiKey: 'k', apiBase: 'https://local/v1', model: 'm' })

    const userPrompt = mocks.chatCompletion.mock.calls[0][1].messages[1].content
    const errorLines = userPrompt.split('\n').filter((l: string) => l.startsWith('[error]'))
    expect(errorLines).toHaveLength(500)
  })
})
