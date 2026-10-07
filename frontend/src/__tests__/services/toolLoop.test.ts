import { describe, expect, it } from 'vitest'
import { estimateMessagesTokens, trimMessages } from '../../services/chatEngine/toolLoop'
import type { LLMMessage } from '../../services/llm'

const pad = (n: number) => 'x'.repeat(n)

/**
 * A `role:'tool'` message is only valid when its owning assistant `tool_calls`
 * message is still in the list. `trimMessages` used to splice one message at a
 * time and could orphan a pair, which providers reject with HTTP 400.
 */
function hasOrphanToolMessage(messages: LLMMessage[]): boolean {
  return messages.some(
    (m, i) =>
      m.role === 'tool' &&
      !messages
        .slice(0, i)
        .some((p) => p.role === 'assistant' && p.tool_calls?.some((c) => c.id === m.tool_call_id)),
  )
}

function groupedConversation(): LLMMessage[] {
  return [
    { role: 'system', content: 'sys' },
    { role: 'user', content: pad(400) },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'a', type: 'function', function: { name: 't', arguments: '{}' } },
        { id: 'b', type: 'function', function: { name: 't', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'a', content: pad(400) },
    { role: 'tool', tool_call_id: 'b', content: pad(400) },
    { role: 'assistant', content: 'final' },
  ]
}

describe('trimMessages', () => {
  it('never leaves a tool reply behind without its assistant tool_calls', () => {
    const messages = groupedConversation()
    const max = estimateMessagesTokens(messages) - 1
    trimMessages(messages, max)
    expect(hasOrphanToolMessage(messages)).toBe(false)
    expect(messages[0].role).toBe('system')
  })

  it('drops a tool group as a unit when the context must shrink hard', () => {
    const messages = groupedConversation()
    trimMessages(messages, 1)
    expect(hasOrphanToolMessage(messages)).toBe(false)
    // the whole group is gone, leaving only system + the final answer
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1].content).toBe('final')
  })
})
