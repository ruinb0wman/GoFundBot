import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  chatCompletion: vi.fn(),
  openChatStream: vi.fn(),
  executeTool: vi.fn(),
}))

vi.mock('../../services/llm', () => ({
  chatCompletion: mocks.chatCompletion,
  openChatStream: mocks.openChatStream,
}))
vi.mock('../../services/chatEngine/toolHandlers', () => ({
  executeTool: mocks.executeTool,
}))

import { chat, SKILL_MAP } from '../../services/chatEngine'
import { TOOL_REGISTRY } from '../../services/chatEngine/toolContract'

const XML_BLOCK = (inner: string) =>
  `<ai_tool_calls>\n${inner}\n</ai_tool_calls>`

const invokeXml = (name: string, params: string[]) =>
  `<invoke name="${name}">${params.join('')}</invoke>`

const LLM_CONFIG = { apiKey: 'test-key', apiBase: 'https://local.test/v1', model: 'test-model' }

async function collectEvents(input: string) {
  const events: { event: string; data: any }[] = []
  for await (const e of chat({ messages: [{ role: 'user', content: input }], llmConfig: LLM_CONFIG })) {
    events.push({ event: e.event, data: JSON.parse(e.data || '{}') })
  }
  return events
}

function* streamChunks(tokens: string[], usage?: object) {
  let full = ''
  for (const t of tokens) {
    full += t
    yield { token: t, full }
  }
  if (usage) yield { token: '', full, usage }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('artisan skill tool subset', () => {
  it('every skill toolName is registered in the tool contract', () => {
    for (const skill of Object.values(SKILL_MAP)) {
      for (const name of skill.toolNames) {
        expect(TOOL_REGISTRY[name], `${skill.name} -> ${name}`).toBeTruthy()
      }
    }
  })
})

describe('XML tool-call normalization', () => {
  it('executes valid XML invokes, strips the block, and rejects hallucinated names with corrective feedback', async () => {
    mocks.executeTool.mockResolvedValue({ data_status: 'available', items: [{ name: '半导体', change: 3.2 }] })

    const first = {
      content: '先查板块数据。\n' + XML_BLOCK(
        invokeXml('get_hot_sectors', ['<parameter name="limit">15</parameter>']) + '\n' +
        invokeXml('get_industry_spot', ['<parameter name="industries">["半导体","军工"]</parameter>']),
      ),
      tool_calls: undefined,
    }
    const second = { content: '这是最终回答：半导体板块今日领涨 3.2%。', tool_calls: undefined }

    mocks.chatCompletion.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    mocks.openChatStream.mockImplementation(() => streamChunks(['这是最终回答：半导体板块今日领涨 3.2%。'], { total_tokens: 12 }))

    const events = await collectEvents('半导体行业怎么样')

    // valid tool executed with parsed + validated args
    expect(mocks.executeTool).toHaveBeenCalledTimes(1)
    expect(mocks.executeTool).toHaveBeenCalledWith('get_hot_sectors', { limit: 15 }, { searchSettings: undefined })

    // hallucinated tool never executed
    expect(mocks.executeTool.mock.calls.some((c) => c[0] === 'get_industry_spot')).toBe(false)

    // tool events emitted for both calls, error flag only for the hallucinated one
    const toolEnds = events.filter((e) => e.event === 'tool_end')
    expect(toolEnds).toHaveLength(2)
    const validEnd = toolEnds.find((e) => e.data.name === 'get_hot_sectors')
    const badEnd = toolEnds.find((e) => e.data.name === 'get_industry_spot')
    expect(validEnd?.data.error).toBe(false)
    expect(badEnd?.data.error).toBe(true)

    // corrective UNKNOWN_TOOL envelope is fed back to the model on the next iteration
    const secondCompletionMessages = mocks.chatCompletion.mock.calls[1][1].messages
    const toolMsgs = secondCompletionMessages.filter((m: any) => m.role === 'tool')
    const corrective = toolMsgs.find((m: any) => m.content.includes('get_industry_spot'))
    expect(corrective).toBeTruthy()
    const envelope = JSON.parse(corrective.content)
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('UNKNOWN_TOOL')
    expect(envelope.error.message).toContain('工具不存在')

    // assistant history content is clean (no markup)
    const assistantMsgs = secondCompletionMessages.filter((m: any) => m.role === 'assistant')
    for (const m of assistantMsgs) {
      expect(m.content).not.toMatch(/<ai_tool_calls|<invoke|<parameter/)
    }

    // valid tool result envelope has ok:true + data
    const okTool = toolMsgs.find((m: any) => m.content.includes('data_status'))
    expect(JSON.parse(okTool.content).ok).toBe(true)

    // streaming output is clean prose only
    const tokens = events.filter((e) => e.event === 'token')
    expect(tokens.length).toBeGreaterThan(0)
    for (const t of tokens) {
      expect(t.data.full).not.toMatch(/<ai_tool_calls|<invoke|<parameter/)
      expect(t.data.full).toContain('最终回答')
    }
    expect(events[events.length - 2]?.event).toBe('usage')
    expect(events[events.length - 1]?.event).toBe('done')
  })

  it('merges native tool_calls and strips duplicate XML', async () => {
    mocks.executeTool.mockResolvedValue({ data_status: 'available', items: [] })

    const first = {
      content: XML_BLOCK(invokeXml('get_hot_sectors', ['<parameter name="limit">5</parameter>'])),
      tool_calls: [{ id: 't1', type: 'function', function: { name: 'get_hot_sectors', arguments: '{"limit": 5}' } }],
    }
    mocks.chatCompletion.mockResolvedValueOnce(first).mockResolvedValueOnce({ content: 'ok', tool_calls: undefined })
    mocks.openChatStream.mockImplementation(() => streamChunks(['ok']))

    const events = await collectEvents('今天板块怎么样')
    expect(mocks.executeTool).toHaveBeenCalledTimes(1) // deduped
    expect(mocks.executeTool).toHaveBeenCalledWith('get_hot_sectors', { limit: 5 }, expect.anything())
    expect(events.some((e) => e.event === 'done')).toBe(true)
  })
})

describe('native tool_calls path (unchanged behavior)', () => {
  it('executes native tool_calls and streams the final answer', async () => {
    mocks.executeTool.mockResolvedValue({ indices: [{ name: '上证指数', change: 0.5 }] })

    mocks.chatCompletion
      .mockResolvedValueOnce({
        content: '',
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'get_market_indices', arguments: '{}' } }],
      })
      .mockResolvedValueOnce({ content: '上证指数涨 0.5%。', tool_calls: undefined })
    mocks.openChatStream.mockImplementation(() => streamChunks(['上证指数涨 0.5%。']))

    const events = await collectEvents('今天大盘怎么样')
    expect(mocks.executeTool).toHaveBeenCalledWith('get_market_indices', {}, { searchSettings: undefined })
    const tokens = events.filter((e) => e.event === 'token').map((e) => e.data.token).join('')
    expect(tokens).toBe('上证指数涨 0.5%。')
  })
})

describe('hallucination loop guard', () => {
  it('emits a graceful status instead of an empty reply when the model never produces valid calls', async () => {
    const hallucinated = {
      content: XML_BLOCK(invokeXml('get_industry_spot', ['<parameter name="industries">["半导体"]</parameter>'])),
      tool_calls: undefined,
    }
    mocks.chatCompletion.mockResolvedValue(hallucinated) // every iteration

    const events = await collectEvents('半导体行业怎么样')

    expect(mocks.executeTool).not.toHaveBeenCalled()
    const statusEvents = events.filter((e) => e.event === 'status')
    expect(statusEvents.some((e) => e.data.message.includes('未能完成回答'))).toBe(true)
    expect(events[events.length - 1]?.event).toBe('done')
  })
})
