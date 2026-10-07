import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getSessions: vi.fn().mockResolvedValue({ data: [] }),
  addMessage: vi.fn().mockResolvedValue(1),
  updateSession: vi.fn().mockResolvedValue(1),
}))

vi.mock('../../services/chatApi', () => ({
  chatAPI: {
    sendMessage: mocks.sendMessage,
    getSessions: mocks.getSessions,
  },
}))
vi.mock('../../db', () => ({
  db: {
    chatMessages: { add: mocks.addMessage },
    chatSessions: { update: mocks.updateSession },
  },
}))
vi.mock('../../db/strategyMemory', () => ({
  buildActiveStrategyContext: vi.fn().mockResolvedValue(''),
}))
vi.mock('../../core/logger', () => ({
  clientLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../../composables/useLLMConfig', () => ({
  useLLMConfig: () => ({ config: { value: {} } }),
}))

import { useChatStore } from '../../stores/chatStore'

/** The user turn is persisted too, so pick the assistant record explicitly. */
function savedAssistantMessage() {
  const assistants = mocks.addMessage.mock.calls
    .map((c) => c[0])
    .filter((m) => m.role === 'assistant')
  expect(assistants).toHaveLength(1)
  return assistants[0]
}

/** Drive one full send with a scripted tool call, then let onDone persist. */
async function sendWithTool(
  store: ReturnType<typeof useChatStore>,
  cb: { empty?: boolean; error?: boolean },
) {
  mocks.sendMessage.mockImplementation(async (_messages: unknown, callbacks: any) => {
    callbacks.onToolStart({ name: 'get_market_indices', params: { a: 1 } })
    callbacks.onToolEnd({ name: 'get_market_indices', duration_ms: 220, ...cb })
    callbacks.onToken('ok', 'ok')
    await callbacks.onDone()
  })
  await store.sendMessage('今天大盘怎么样')
}

describe('chatStore tool chip persistence', () => {
  beforeEach(() => {
    mocks.sendMessage.mockReset()
    mocks.addMessage.mockClear()
    setActivePinia(createPinia())
  })

  // Regression: onDone used to read activeToolCalls *after* finalizeStream()
  // had already cleared it, so tool chips were never written to IndexedDB and
  // disappeared from the history after a reload.
  it('writes the chips (with the empty status) to the message record', async () => {
    const store = useChatStore()
    store.currentSessionId = 7

    await sendWithTool(store, { empty: true })

    const saved = savedAssistantMessage()
    expect(saved.toolName).toBe('get_market_indices')
    expect(saved.toolParamsJson).toBe(JSON.stringify({ a: 1 }))
    const chips = JSON.parse(saved.toolCallsJson)
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({ name: 'get_market_indices', status: 'empty', durationMs: 220 })
  })

  it('keeps the error status and drops chips from the in-memory timeline after finalize', async () => {
    const store = useChatStore()
    store.currentSessionId = 7

    await sendWithTool(store, { error: true })

    expect(JSON.parse(savedAssistantMessage().toolCallsJson)[0].status).toBe('error')
    // finalized message is in the timeline, pending call list is reset
    expect(store.activeToolCalls).toEqual([])
    expect(store.messages[store.messages.length - 1]?.toolCalls?.[0].status).toBe('error')
  })
})

describe('turn error finalization', () => {
  beforeEach(() => {
    mocks.sendMessage.mockReset()
    mocks.addMessage.mockClear()
    setActivePinia(createPinia())
  })

  // The engine emits `error` and then still emits `done`; onError already finalized
  // and persisted, so onDone must not write the assistant row a second time.
  it('persists a single assistant row when onError is followed by onDone', async () => {
    const store = useChatStore()
    store.currentSessionId = 7

    mocks.sendMessage.mockImplementation(async (_messages: unknown, callbacks: any) => {
      await callbacks.onError('boom')
      await callbacks.onDone()
    })

    await store.sendMessage('hi')

    expect(savedAssistantMessage().content).toBe('boom')
    expect(store.isStreaming).toBe(false)
  })
})
