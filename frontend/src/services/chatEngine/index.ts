/**
 * Frontend AI chat orchestrator.
 * Ported from Service `chatService.ts`. Drives tool calling + streaming via the
 * frontend LLM client; consumes skills (skills.ts) and the tool contract
 * (toolContract.ts + toolCallParser.ts).
 *
 * Tool-call normalization: models that do not speak the native OpenAI `tool_calls`
 * protocol emit `<ai_tool_calls>` XML inside content. Both transports are normalized
 * at the boundary into one typed contract (validation → execution → `{ok,data}|{ok,error}`
 * envelope), and tool markup is stripped from every content boundary so it can never
 * leak into the chat.
 */

import {
  chatCompletion,
  openChatStream,
  type LLMConfig,
  type LLMMessage,
  type LLMTool,
} from '../llm'
import { SKILL_MAP, SkillRouter, type Skill } from './skills'
import {
  TOOL_CALL_RULES,
  listToolSpecs,
  toolSpecToOpenAI,
  toolSpecsToXml,
} from './toolContract'
import { extractToolCalls, sanitizeAssistantContent } from './toolCallParser'
import {
  MAX_CONTEXT_TOKENS,
  MAX_TOOL_ITERATIONS,
  executeToolCall,
  normalizeToolCalls,
  sleep,
  trimMessages,
  truncateJson,
  withRetry,
} from './toolLoop'
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

export { sleep } from './toolLoop'

function buildToolsParam(skill: Skill | undefined): LLMTool[] {
  return listToolSpecs(skill?.toolNames).map(toolSpecToOpenAI)
}

/**
 * System prompt = skill prompt + tool-call contract (rules + `<available_tools>` XML)
 * + optional user strategy memory. The explicit tool list is what lets the model
 * distinguish tool invocations from plain data/prose.
 */
export function buildSystemPrompt(basePrompt: string, toolNames: string[], strategyContext?: string): string {
  const parts = [basePrompt, TOOL_CALL_RULES, toolSpecsToXml(listToolSpecs(toolNames))]
  const ctx = strategyContext?.trim()
  if (ctx) {
    parts.push(`## 用户策略记忆\n以下为用户当前启用的投资策略，你的分析与建议需贴合用户的策略取向，但不得为迎合策略而歪曲数据。\n${ctx}`)
  }
  return parts.join('\n\n')
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
    { role: 'system', content: buildSystemPrompt(resolvedSkill.systemPrompt, resolvedSkill.toolNames, strategyContext) },
    ...messages.map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  trimMessages(openaiMessages, MAX_CONTEXT_TOKENS)

  let endedWithError = false
  let streamedAnyContent = false

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
      endedWithError = true
      yield { event: 'error', data: JSON.stringify({ message: `LLM 调用失败: ${String(error)}` }) }
      break
    }

    const message = response
    const nativeCalls = message?.tool_calls?.filter((tc) => tc.function?.name) ?? []
    const parsed = extractToolCalls(message?.content || '')
    const calls = normalizeToolCalls(nativeCalls, parsed.calls)

    if (calls.length > 0) {
      openaiMessages.push({
        role: 'assistant',
        content: parsed.cleaned || null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        })),
      })

      for (const call of calls) {
        yield {
          event: 'tool_start',
          data: JSON.stringify({ name: call.name, params: call.args, tool_call_id: call.id }),
        }

        const startTime = Date.now()
        const envelope = await executeToolCall(call, searchSettings)
        const durationMs = Date.now() - startTime
        const hasError = envelope.ok === false

        yield {
          event: 'tool_end',
          data: JSON.stringify({ name: call.name, tool_call_id: call.id, duration_ms: durationMs, error: hasError }),
        }

        openaiMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: truncateJson(envelope),
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
            streamedAnyContent = true
            yield { event: 'token', data: JSON.stringify({ token: chunk.token, full: sanitizeAssistantContent(fullContent) }) }
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
              streamedAnyContent = true
              yield { event: 'token', data: JSON.stringify({ token: chunk, full: sanitizeAssistantContent(fullContent) }) }
            }
          }
        } catch (fallbackError) {
          endedWithError = true
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

  if (!endedWithError && !streamedAnyContent) {
    yield {
      event: 'status',
      data: JSON.stringify({ message: 'AI 未能完成回答（未获取到有效数据），请重试或更换模型' }),
    }
  }

  yield { event: 'done', data: JSON.stringify({ status: 'done' }) }
}

export { SKILL_MAP }
