/**
 * Frontend AI chat orchestrator.
 * Ported from Service `chatService.ts`. Drives tool calling + streaming via the
 * frontend LLM client; consumes skills (skills.ts) and tools (tools.ts).
 */

import {
  chatCompletion,
  openChatStream,
  type LLMConfig,
  type LLMMessage,
  type LLMTool,
} from '../llm'
import { SKILL_MAP, SkillRouter, type Skill } from './skills'
import { TOOL_DEFINITIONS } from './tools'
import { executeTool } from './toolHandlers'
import type { AppSettings } from '../../composables/useAppSettings'

export interface ChatStreamEvent {
  event: string
  data: string
}

export interface ChatArgs {
  messages: Array<{ role: string; content: string }>
  skill?: string
  llmConfig?: { apiKey?: string; apiBase?: string; model?: string }
  strategyContext?: string
  searchSettings?: AppSettings
}

const MAX_TOOL_ITERATIONS = 8
const MAX_CONTEXT_TOKENS = 50000
const CHARS_PER_TOKEN = 3

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableLLMError(error: unknown): boolean {
  const msg = String(error).toLowerCase()
  if (/\b(40[134]|422)\b/.test(msg)) return false
  return /timeout|econn|eaddrinuse|enotfound|etimedout|fetch.*failed|network|5\d{2}|429|upstream.*request.*failed|remote.*end.*closed/.test(msg)
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
): Promise<{ value: T; retries: number }> {
  let retries = 0
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return { value: await fn(), retries }
    } catch (error) {
      if (attempt === maxRetries) throw error
      if (!isRetryableLLMError(error)) throw error
      retries++
      await sleep(1000 * (attempt + 1))
    }
  }
  throw new Error('unreachable')
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function estimateMessagesTokens(messages: LLMMessage[]): number {
  let total = 0
  for (const m of messages) {
    total += 4
    if (typeof m.content === 'string') total += estimateTokens(m.content)
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        total += estimateTokens(tc.function.name + tc.function.arguments)
      }
    }
    if (m.tool_call_id) total += estimateTokens(m.tool_call_id)
  }
  return total
}

function trimMessages(messages: LLMMessage[], maxTokens: number): void {
  while (estimateMessagesTokens(messages) > maxTokens && messages.length > 1) {
    const skip = messages.length > 0 && messages[0]?.role === 'system' ? 1 : 0
    if (messages.length <= skip + 1) break
    messages.splice(skip, 1)
  }
}

function buildToolsParam(skill: Skill | undefined): LLMTool[] {
  const toolSet = skill ? new Set(skill.toolNames) : null
  const filtered = toolSet
    ? TOOL_DEFINITIONS.filter((t) => toolSet.has(t.function.name))
    : TOOL_DEFINITIONS
  return filtered.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters as Record<string, unknown>,
    },
  }))
}

export function buildSystemPrompt(basePrompt: string, strategyContext?: string): string {
  const ctx = strategyContext?.trim()
  if (!ctx) return basePrompt
  return `${basePrompt}\n\n## 用户策略记忆\n以下为用户当前启用的投资策略，你的分析与建议需贴合用户的策略取向，但不得为迎合策略而歪曲数据。\n${ctx}`
}

function chunkBySentence(text: string, maxChunk = 50): string[] {
  const re = /[。！？\n！\n？\n。]+|.*?[，；、：\s]+|.+/g
  const result: string[] = []
  let buffer = ''
  for (const match of text.matchAll(re)) {
    const seg = match[0]
    if (buffer.length + seg.length > maxChunk && buffer.length > 0) {
      result.push(buffer)
      buffer = ''
    }
    buffer += seg
  }
  if (buffer) result.push(buffer)
  return result
}

export interface StreamingResponse {
  content: string | null
  tool_calls?: LLMMessage['tool_calls']
}

export async function* chat(args: ChatArgs): AsyncGenerator<ChatStreamEvent> {
  const { messages, skill: skillName, llmConfig, strategyContext, searchSettings } = args
  const apiKey = llmConfig?.apiKey || ''
  const apiBase = llmConfig?.apiBase || 'https://api.siliconflow.cn/v1'
  const model = llmConfig?.model || 'Qwen/Qwen2.5-7B-Instruct'

  if (!apiKey) {
    yield { event: 'error', data: JSON.stringify({ message: 'AI 服务未配置，请在设置中配置 AI 服务密钥' }) }
    yield { event: 'done', data: JSON.stringify({ status: 'done' }) }
    return
  }

  const config: LLMConfig = { apiKey, apiBase, model }
  const router = new SkillRouter(apiKey, apiBase, model)
  const userMessage = messages.length > 0 ? (messages[messages.length - 1]?.content || '') : ''

  const resolvedSkill = await router.route(userMessage, skillName)

  yield {
    event: 'skill_selected',
    data: JSON.stringify({ name: resolvedSkill.name, description: resolvedSkill.description }),
  }

  const openaiMessages: LLMMessage[] = [
    { role: 'system', content: buildSystemPrompt(resolvedSkill.systemPrompt, strategyContext) },
    ...messages.map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  trimMessages(openaiMessages, MAX_CONTEXT_TOKENS)

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    let llmUsage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } = {}
    let response: StreamingResponse
    try {
      const { value: llmResponse, retries: llmRetries } = await withRetry(() =>
        chatCompletion(config, {
          messages: openaiMessages,
          tools: buildToolsParam(resolvedSkill),
          tool_choice: 'auto',
          temperature: 0.3,
          max_tokens: 4096,
        }),
      )
      response = { content: llmResponse.content, tool_calls: llmResponse.tool_calls }
      if (llmRetries > 0) {
        yield { event: 'status', data: JSON.stringify({ message: `LLM 调用失败，已自动重试 ${llmRetries} 次` }) }
      }
      if (llmResponse.usage) llmUsage = llmResponse.usage
    } catch (error) {
      yield { event: 'error', data: JSON.stringify({ message: `LLM 调用失败: ${String(error)}` }) }
      break
    }

    const message = response

    if (message?.tool_calls && message.tool_calls.length > 0) {
      const toolCalls = message.tool_calls

      openaiMessages.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      })

      for (const tc of toolCalls) {
        let callArgs: Record<string, unknown>
        try {
          callArgs = JSON.parse(tc.function.arguments)
        } catch {
          callArgs = {}
        }

        yield {
          event: 'tool_start',
          data: JSON.stringify({ name: tc.function.name, params: callArgs, tool_call_id: tc.id }),
        }

        const startTime = Date.now()
        const result = await executeTool(tc.function.name, callArgs, { searchSettings })
        const durationMs = Date.now() - startTime

        const hasError = result && typeof result === 'object' && 'error' in (result as Record<string, unknown>)

        yield {
          event: 'tool_end',
          data: JSON.stringify({ name: tc.function.name, tool_call_id: tc.id, duration_ms: durationMs, error: hasError }),
        }

        let resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        if (resultStr.length > 4000) {
          resultStr = resultStr.slice(0, 4000) + '... (truncated)'
        }

        openaiMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultStr,
        })
      }

      trimMessages(openaiMessages, MAX_CONTEXT_TOKENS)
    } else {
      const content = message?.content || ''
      let fullContent = ''
      let streamUsage = llmUsage

      trimMessages(openaiMessages, MAX_CONTEXT_TOKENS)

      try {
        const { value: stream, retries: streamRetries } = await withRetry(
          () => openChatStream(config, {
            messages: openaiMessages,
            temperature: 0.3,
            max_tokens: 4096,
          }),
        )
        if (streamRetries > 0) {
          yield { event: 'status', data: JSON.stringify({ message: `LLM 调用失败，已自动重试 ${streamRetries} 次` }) }
        }

        for await (const chunk of stream) {
          if (chunk.usage) streamUsage = chunk.usage
          if (chunk.token) {
            fullContent += chunk.token
            yield { event: 'token', data: JSON.stringify({ token: chunk.token, full: fullContent }) }
          }
        }
      } catch (error) {
        if (fullContent) {
          yield { event: 'token', data: JSON.stringify({ token: '', full: fullContent }) }
          break
        }

        try {
          const { value: fallbackResponse, retries: fallbackRetries } = await withRetry(
            () => chatCompletion(config, { messages: openaiMessages, temperature: 0.3, max_tokens: 4096 }),
            1,
          )
          if (fallbackRetries > 0) {
            yield { event: 'status', data: JSON.stringify({ message: `LLM 调用失败，已自动重试 ${fallbackRetries} 次` }) }
          }
          const text = fallbackResponse.content || ''
          streamUsage = fallbackResponse.usage ?? streamUsage
          if (text) {
            for (const chunk of chunkBySentence(text, 50)) {
              fullContent += chunk
              yield { event: 'token', data: JSON.stringify({ token: chunk, full: fullContent }) }
            }
          }
        } catch (fallbackError) {
          yield { event: 'error', data: JSON.stringify({ message: `LLM 调用失败: ${String(fallbackError)}` }) }
          break
        }
      }

      if (streamUsage.total_tokens) {
        yield { event: 'usage', data: JSON.stringify(streamUsage) }
      }
      break
    }
  }

  yield { event: 'done', data: JSON.stringify({ status: 'done' }) }
}

export { SKILL_MAP }
