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
  validateToolCall,
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
import { isEmptyToolResult } from './toolResultStatus'
import { requiresApproval, type ApprovalRequest } from './toolApproval'
import { clientLogger } from '../../core/logger'
import type { AppSettings } from '../../composables/useAppSettings'

export interface ChatStreamEvent {
  event: string
  data: string
}

export interface ChatArgs {
  messages: Array<{ role: string; content: string }>
  skill?: string
  llmConfig?: { apiKey?: string; apiBase?: string; model?: string; conversationId?: string }
  strategyContext?: string
  searchSettings?: AppSettings
  /** Approval gate for code-executing tools; absent → denied (headless paths). */
  requestApproval?: (req: ApprovalRequest) => Promise<boolean>
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
  reasoning_content?: string
}

export async function* chat(args: ChatArgs): AsyncGenerator<ChatStreamEvent> {
  const { messages, skill: skillName, llmConfig, strategyContext, searchSettings, requestApproval } = args
  const apiKey = llmConfig?.apiKey || ''
  const apiBase = llmConfig?.apiBase || 'https://api.siliconflow.cn/v1'
  const model = llmConfig?.model || 'Qwen/Qwen2.5-7B-Instruct'

  if (!apiKey) {
    yield { event: 'error', data: JSON.stringify({ message: 'AI 服务未配置，请在设置中配置 AI 服务密钥' }) }
    yield { event: 'done', data: JSON.stringify({ status: 'done' }) }
    return
  }

  const config: LLMConfig = { apiKey, apiBase, model, conversationId: llmConfig?.conversationId }
  const router = new SkillRouter(apiKey, apiBase, model, llmConfig?.conversationId)
  const userMessage = messages.length > 0 ? (messages[messages.length - 1]?.content || '') : ''

  const resolvedSkill = await router.route(userMessage, skillName)

  yield {
    event: 'skill_selected',
    data: JSON.stringify({ name: resolvedSkill.name, description: resolvedSkill.description }),
  }
  clientLogger.info('chat.turn.start', {
    skill: resolvedSkill.name,
    model,
    apiBase,
    historyCount: messages.length,
  })

  const openaiMessages: LLMMessage[] = [
    { role: 'system', content: buildSystemPrompt(resolvedSkill.systemPrompt, resolvedSkill.toolNames, strategyContext) },
    ...messages.map((m) => {
      const role = (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant'
      return {
        role,
        content: m.content,
        // Thinking-mode providers (e.g. OpenCode Go's DeepSeek V4 relay) require
        // `reasoning_content` on every replayed assistant message; echo the
        // captured value or fall back to an empty string.
        ...(role === 'assistant' ? { reasoning_content: (m as { reasoning_content?: string }).reasoning_content ?? '' } : {}),
      }
    }),
  ]

  trimMessages(openaiMessages, MAX_CONTEXT_TOKENS)

  let endedWithError = false
  let streamedAnyContent = false
  let toolRounds = 0

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    let llmUsage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } = {}
    let response: StreamingResponse
    const llmStart = Date.now()
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
      response = { content: llmResponse.content, tool_calls: llmResponse.tool_calls, reasoning_content: llmResponse.reasoning_content }
      if (llmRetries > 0) {
        yield { event: 'status', data: JSON.stringify({ message: `LLM 调用失败，已自动重试 ${llmRetries} 次` }) }
      }
      if (llmResponse.usage) llmUsage = llmResponse.usage
    } catch (error) {
      endedWithError = true
      clientLogger.error('chat.llm.failed', {
        iter,
        durationMs: Date.now() - llmStart,
        error: String(error),
        model,
        apiBase,
      })
      yield { event: 'error', data: JSON.stringify({ message: `LLM 调用失败: ${String(error)}` }) }
      break
    }

    const message = response
    const nativeCalls = message?.tool_calls?.filter((tc) => tc.function?.name) ?? []
    const parsed = extractToolCalls(message?.content || '')
    const calls = normalizeToolCalls(nativeCalls, parsed.calls)

    clientLogger.info('chat.llm.call', {
      iter,
      durationMs: Date.now() - llmStart,
      contentChars: (message?.content || '').length,
      nativeCalls: nativeCalls.length,
      xmlCalls: parsed.calls.length,
      totalTokens: llmUsage.total_tokens,
    })

    if (calls.length > 0) {
      // Only count rounds that actually hit a registered tool. A model that
      // hallucinates unknown tool names for 8 rounds is a different failure and
      // keeps the generic "no valid answer" message.
      if (calls.some((c) => validateToolCall(c.name, c.args).ok)) toolRounds += 1
      openaiMessages.push({
        role: 'assistant',
        content: parsed.cleaned || null,
        reasoning_content: response.reasoning_content ?? '',
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        })),
      })

      for (const call of calls) {
        if (requiresApproval(call.name)) {
          yield {
            event: 'tool_confirm',
            data: JSON.stringify({ name: call.name, params: call.args, tool_call_id: call.id }),
          }
          const approved = requestApproval
            ? await requestApproval({ toolCallId: call.id, name: call.name, params: call.args })
            : false
          yield { event: 'tool_confirmed', data: JSON.stringify({ tool_call_id: call.id, approved }) }
          if (!approved) {
            yield {
              event: 'tool_end',
              data: JSON.stringify({ name: call.name, tool_call_id: call.id, duration_ms: 0, error: true }),
            }
            openaiMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: truncateJson({ ok: false, error: { code: 'USER_REJECTED', message: '用户未批准执行该策略代码' } }),
            })
            continue
          }
        }

        yield {
          event: 'tool_start',
          data: JSON.stringify({ name: call.name, params: call.args, tool_call_id: call.id }),
        }

        const startTime = Date.now()
        const envelope = await executeToolCall(call, searchSettings)
        const durationMs = Date.now() - startTime
        const hasError = envelope.ok === false
        // UI-only hint: the call succeeded but returned nothing usable.
        const isEmpty = envelope.ok ? isEmptyToolResult(envelope.data) : false
        if (hasError) {
          clientLogger.warn('chat.tool.error', {
            name: call.name,
            durationMs,
            message: envelope.ok === false ? envelope.error.message : '',
          })
        } else {
          clientLogger.info('chat.tool.end', { name: call.name, durationMs, empty: isEmpty })
        }

        yield {
          event: 'tool_end',
          data: JSON.stringify({ name: call.name, tool_call_id: call.id, duration_ms: durationMs, error: hasError, empty: isEmpty }),
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

        clientLogger.info('chat.stream.start', { iter })
        for await (const chunk of stream) {
          if (chunk.usage) streamUsage = chunk.usage
          if (chunk.token) {
            fullContent += chunk.token
            streamedAnyContent = true
            yield { event: 'token', data: JSON.stringify({ token: chunk.token, full: sanitizeAssistantContent(fullContent) }) }
          }
        }
        clientLogger.info('chat.stream.end', {
          iter,
          chars: fullContent.length,
          totalTokens: streamUsage.total_tokens,
        })
      } catch (error) {
        if (fullContent) {
          // The user already saw part of the answer. Keep it, but make the
          // interruption loud instead of silently stopping (and log it) —
          // previously this branch just `break`ed with no error/log at all.
          clientLogger.warn('chat.stream.interrupted', {
            iter,
            chars: fullContent.length,
            error: String(error),
            model,
            apiBase,
          })
          yield {
            event: 'status',
            data: JSON.stringify({
              message: `回答在传输中断（${String(error)}），已保留已生成内容`,
              level: 'warn',
            }),
          }
          yield { event: 'token', data: JSON.stringify({ token: '', full: fullContent }) }
          break
        }
        clientLogger.warn('chat.stream.failed', { iter, error: String(error), model, apiBase })

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
    const exhausted = toolRounds > 0
    if (exhausted) {
      clientLogger.warn('chat.loop.exhausted', { iterations: MAX_TOOL_ITERATIONS, toolRounds })
    }
    yield {
      event: 'status',
      data: JSON.stringify({
        message: exhausted
          ? `已达到工具调用轮次上限（${MAX_TOOL_ITERATIONS} 轮）仍未收尾，可缩小问题范围或重试`
          : 'AI 未能完成回答（未获取到有效数据），请重试或更换模型',
        level: exhausted ? 'warn' : 'info',
      }),
    }
  }

  clientLogger.info('chat.turn.end', { endedWithError, streamedAnyContent, toolRounds })
  yield { event: 'done', data: JSON.stringify({ status: 'done' }) }
}

export { SKILL_MAP }
