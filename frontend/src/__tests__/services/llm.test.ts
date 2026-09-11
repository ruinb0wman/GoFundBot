import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ nativeFetch: vi.fn() }))
vi.mock('../../services/httpClient', () => ({ nativeFetch: mocks.nativeFetch }))

import {
  chatCompletion,
  chatCompletionStream,
  pickReasoningContent,
  type LLMConfig,
} from '../../services/llm'

const CONFIG: LLMConfig = { apiKey: 'test-key', apiBase: 'https://local.test/v1', model: 'test-model' }

function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

const data = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`

describe('pickReasoningContent', () => {
  it('prefers reasoning_content over reasoning / reasoning_text', () => {
    expect(pickReasoningContent({ reasoning_content: 'a', reasoning: 'b', reasoning_text: 'c' })).toBe('a')
    expect(pickReasoningContent({ reasoning: 'b', reasoning_text: 'c' })).toBe('b')
    expect(pickReasoningContent({ reasoning_text: 'c' })).toBe('c')
  })

  it('returns undefined when no non-empty reasoning field exists', () => {
    expect(pickReasoningContent({ reasoning_content: '' })).toBeUndefined()
    expect(pickReasoningContent(undefined)).toBeUndefined()
  })
})

describe('chatCompletion', () => {
  it('captures reasoning_content from the assistant message', async () => {
    mocks.nativeFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '你好', reasoning_content: '深度思考中', tool_calls: null } }],
          usage: { total_tokens: 5 },
        }),
        { status: 200 },
      ),
    )

    const result = await chatCompletion(CONFIG, { messages: [{ role: 'user', content: 'hi' }] })

    expect(result.content).toBe('你好')
    expect(result.reasoning_content).toBe('深度思考中')
  })
})

describe('chatCompletionStream', () => {
  it('accumulates reasoning_content deltas and keeps them off the visible content', async () => {
    mocks.nativeFetch.mockResolvedValue(
      sseResponse([
        data({ choices: [{ delta: { reasoning_content: '思考片段一' } }] }),
        data({ choices: [{ delta: { reasoning_content: '片段二' } }] }),
        data({ choices: [{ delta: { content: '最终答案' } }] }),
        'data: [DONE]\n\n',
      ]),
    )

    const chunks: Array<{ token: string; reasoning?: string }> = []
    for await (const chunk of chatCompletionStream(CONFIG, { messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push({ token: chunk.token, reasoning: chunk.reasoning })
    }

    expect(chunks[0]).toEqual({ token: '', reasoning: '思考片段一' })
    expect(chunks[1]).toEqual({ token: '', reasoning: '思考片段一片段二' })
    expect(chunks[2]).toEqual({ token: '最终答案', reasoning: '思考片段一片段二' })
    expect(chunks.map((c) => c.token).join('')).toBe('最终答案')
  })

  it('does not double-count reasoning when both fields are present in one delta', async () => {
    mocks.nativeFetch.mockResolvedValue(
      sseResponse([
        data({ choices: [{ delta: { reasoning_content: 'a', reasoning: 'b' } }] }),
        'data: [DONE]\n\n',
      ]),
    )

    const chunks: Array<{ reasoning?: string }> = []
    for await (const chunk of chatCompletionStream(CONFIG, { messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push({ reasoning: chunk.reasoning })
    }

    expect(chunks[0]?.reasoning).toBe('a')
  })
})
