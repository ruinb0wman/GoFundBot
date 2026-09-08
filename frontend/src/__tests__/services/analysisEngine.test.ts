import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Type } from '@sinclair/typebox'

const mocks = vi.hoisted(() => ({
  chatCompletion: vi.fn(),
  chatCompletionJson: vi.fn(),
  executeTool: vi.fn(),
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
  executeTool: mocks.executeTool,
}))

import { runTask } from '../../services/analysis/analysisEngine'

const TEST_SCHEMA = Type.Object({
  ok: Type.Boolean(),
  t: Type.Optional(Type.String()),
})

const LLM_OK = { apiKey: 'test-key', apiBase: 'https://local.test/v1', model: 'test-model' }

const XML_BLOCK = (inner: string) => `<ai_tool_calls>\n${inner}\n</ai_tool_calls>`
const invokeXml = (name: string, params: string[]) => `<invoke name="${name}">${params.join('')}</invoke>`

async function collectEvents(opts: Parameters<typeof runTask>[0]) {
  const events: { event: string; data: any }[] = []
  for await (const e of runTask(opts)) {
    events.push({ event: e.event, data: JSON.parse(e.data || '{}') })
  }
  return events
}

function taskOpts(overrides: Partial<Parameters<typeof runTask>[0]> = {}) {
  return {
    systemPrompt: '测试系统提示',
    toolNames: [] as string[],
    outputSchema: TEST_SCHEMA,
    userPrompt: '测试问题',
    llmConfig: LLM_OK,
    fallback: () => ({ fallback: true }),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('tool loop through the analysis engine', () => {
  it('normalizes XML tool calls, executes with envelope, emits a schema-valid result without markup residue', async () => {
    mocks.executeTool.mockResolvedValue({ data_status: 'available', items: [{ name: '半导体', change: 3.2 }] })

    mocks.chatCompletion
      .mockResolvedValueOnce({
        content: '先查板块数据。\n' + XML_BLOCK(invokeXml('get_hot_sectors', ['<parameter name="limit">10</parameter>'])),
        tool_calls: undefined,
      })
      .mockResolvedValueOnce({ content: '{"ok":true}', tool_calls: undefined })

    const events = await collectEvents(taskOpts({ toolNames: ['get_hot_sectors'] }))

    // validated + executed once, blessed args
    expect(mocks.executeTool).toHaveBeenCalledTimes(1)
    expect(mocks.executeTool).toHaveBeenCalledWith('get_hot_sectors', { limit: 10 }, { searchSettings: undefined })

    // tool events
    expect(events.some((e) => e.event === 'tool_start' && e.data.name === 'get_hot_sectors')).toBe(true)
    const toolEnd = events.find((e) => e.event === 'tool_end')
    expect(toolEnd?.data.error).toBe(false)

    // envelope fed back to the model
    const secondMessages = mocks.chatCompletion.mock.calls[1][1].messages
    const toolMsg = secondMessages.filter((m: any) => m.role === 'tool').find((m: any) => m.content.includes('data_status'))
    expect(JSON.parse(toolMsg.content).ok).toBe(true)
    // assistant history carries no tool markup
    for (const m of secondMessages.filter((m: any) => m.role === 'assistant')) {
      expect(m.content).not.toMatch(/<ai_tool_calls|<invoke|<parameter/)
    }

    // final schema-checked result
    const result = events.find((e) => e.event === 'result')
    expect(result?.data).toEqual({ ok: true })
    expect(events[events.length - 1]?.event).toBe('done')
  })

  it('retries with INVALID_OUTPUT corrective feedback and succeeds on the next pass', async () => {
    mocks.chatCompletion
      .mockResolvedValueOnce({ content: '{"ok": 1}', tool_calls: undefined }) // schema violation: ok must be boolean
      .mockResolvedValueOnce({ content: '{"ok":true}', tool_calls: undefined })

    const events = await collectEvents(taskOpts())

    expect(mocks.chatCompletion).toHaveBeenCalledTimes(2)
    const correction = mocks.chatCompletion.mock.calls[1][1].messages.find(
      (m: any) => m.role === 'user' && m.content.includes('校验未通过'),
    )
    expect(correction).toBeTruthy()
    expect(correction.content).toContain('ok')
    const result = events.find((e) => e.event === 'result')
    expect(result?.data).toEqual({ ok: true })
  })

  it('falls back after exhausting INVALID_OUTPUT retries (2)', async () => {
    mocks.chatCompletion.mockResolvedValue({ content: '{"nope": 42}', tool_calls: undefined })

    const events = await collectEvents(taskOpts())

    expect(mocks.chatCompletion).toHaveBeenCalledTimes(3) // initial + 2 retries
    const error = events.find((e) => e.event === 'error')
    expect(error?.data.code).toBe('INVALID_OUTPUT')
    const result = events.find((e) => e.event === 'result')
    expect(result?.data).toEqual({ fallback: true })
  })

  it('skips the LLM entirely and goes straight to fallback when the key is missing', async () => {
    const events = await collectEvents(taskOpts({ llmConfig: { apiKey: '', apiBase: 'https://x/v1' } }))

    expect(mocks.chatCompletion).not.toHaveBeenCalled()
    expect(mocks.chatCompletionJson).not.toHaveBeenCalled()
    const result = events.find((e) => e.event === 'result')
    expect(result?.data).toEqual({ fallback: true })
  })

  it('runs the JSON-forcing pass when the model answers in prose', async () => {
    mocks.chatCompletion.mockResolvedValueOnce({ content: '分析完毕，结论如下', tool_calls: undefined })
    mocks.chatCompletionJson.mockResolvedValue({ ok: true })

    const events = await collectEvents(taskOpts())

    expect(mocks.chatCompletionJson).toHaveBeenCalledTimes(1)
    const result = events.find((e) => e.event === 'result')
    expect(result?.data).toEqual({ ok: true })
  })

  it('strips escaped tool markup embedded in result strings (hard sanitization boundary)', async () => {
    // JSON.parse decodes \u003c → '<'; the raw content has no literal '<' so the
    // XML parser never treats the marker as a real tool invocation.
    const content =
      '{"ok":true,"t":"\\u003cai_tool_calls\\u003e\\u003cinvoke name=\\"get_hot_sectors\\"\\u003e\\u003cparameter name=\\"limit\\"\\u003e5\\u003c/parameter\\u003e\\u003c/invoke\\u003e\\u003c/ai_tool_calls\\u003e"}'
    mocks.chatCompletion.mockResolvedValueOnce({ content, tool_calls: undefined })

    const events = await collectEvents(taskOpts())
    expect(mocks.executeTool).not.toHaveBeenCalled()

    const result = events.find((e) => e.event === 'result')
    expect(result?.data.ok).toBe(true)
    // sanitized: no tool markers survive the result boundary
    const serialized = JSON.stringify(result?.data ?? null)
    expect(serialized).not.toMatch(/<ai_tool_calls|<invoke|<parameter/)
  })
})
