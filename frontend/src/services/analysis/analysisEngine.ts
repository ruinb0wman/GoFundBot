/**
 * AI analysis engine — shared structured-output loop for every analysis scenario.
 *
 * One task = system prompt (skill + tool contract XML + strategy memory) →
 * chatCompletion with the scenario's tool subset → native/XML normalization →
 * validation → `{ok,data}|{ok,error}` envelope → corrective feedback → when no
 * tool calls remain, a structured finish pass (parse inline JSON or force
 * `response_format: json_object`) → `Value.Check(outputSchema)`, with
 * `INVALID_OUTPUT` corrections retried (max 2) → `scenario.fallback()` on final
 * failure or missing API key. Every string that reaches an event boundary is
 * sanitized so tool markup can never leak into results.
 */

import { chatCompletion, chatCompletionJson, extractJson, type LLMConfig, type LLMMessage, type LLMResponse } from '../llm'
import { buildSystemPrompt } from '../chatEngine'
import {
  MAX_CONTEXT_TOKENS,
  MAX_TOOL_ITERATIONS,
  executeToolCall,
  normalizeToolCalls,
  trimMessages,
  truncateJson,
  withRetry,
} from '../chatEngine/toolLoop'
import { listToolSpecs, toolSpecToOpenAI } from '../chatEngine/toolContract'
import { extractToolCalls, sanitizeAssistantContent } from '../chatEngine/toolCallParser'
import { schemaErrors } from './scenarioTypes'
import type { AnalysisScenario } from './analysisScenarios'
import type { TObject } from '@sinclair/typebox'
import type { AppSettings } from '../../composables/useAppSettings'

export interface AnalysisStreamEvent {
  event: 'start' | 'stage' | 'tool_start' | 'tool_end' | 'status' | 'result' | 'done' | 'error'
  data: string
}

export interface RunTaskOptions {
  systemPrompt: string
  toolNames: string[]
  outputSchema: TObject
  userPrompt: string
  llmConfig: LLMConfig
  /** Optional model override (analysts default to a stronger model). */
  model?: string
  strategyContext?: string
  searchSettings?: AppSettings
  /** Structured fallback used when the LLM path is skipped or exhausted. */
  fallback?: (ctx?: unknown) => unknown | Promise<unknown>
  fallbackCtx?: unknown
}

export interface RunScenarioOptions {
  scenario: AnalysisScenario
  userPrompt: string
  llmConfig: LLMConfig
  strategyContext?: string
  searchSettings?: AppSettings
  fallback?: (ctx?: unknown) => unknown | Promise<unknown>
  fallbackCtx?: unknown
}

const MAX_INVALID_OUTPUT_RETRIES = 2

function tryParseJson(text: string): unknown | undefined {
  if (!text.trim()) return undefined
  try {
    return JSON.parse(extractJson(text))
  } catch {
    return undefined
  }
}

/** Walk every string leaf and strip tool markup (hard boundary guarantee). */
function sanitizeJsonStrings(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeAssistantContent(value)
  if (Array.isArray(value)) return value.map((v) => sanitizeJsonStrings(v))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeJsonStrings(v)
    }
    return out
  }
  return value
}

async function resolveFallback(
  maybeFallback: ((ctx?: unknown) => unknown | Promise<unknown>) | undefined,
  ctx: unknown,
): Promise<unknown> {
  if (!maybeFallback) return null
  try {
    return await maybeFallback(ctx)
  } catch {
    return null
  }
}

function buildConfig(opts: RunTaskOptions): LLMConfig {
  return {
    apiKey: opts.llmConfig.apiKey,
    apiBase: opts.llmConfig.apiBase,
    model: opts.model || opts.llmConfig.model,
  }
}

/**
 * Run one structured task: tool loop + schema-validated JSON finish.
 * Yields `start → (tool_start/tool_end/status)* → result → done`, or
 * `error → result(fallback) → done` on LLM failure / missing key.
 */
export async function* runTask(opts: RunTaskOptions): AsyncGenerator<AnalysisStreamEvent> {
  const config = buildConfig(opts)
  const fallback = opts.fallback
  const ctx = opts.fallbackCtx

  yield { event: 'start', data: JSON.stringify({}) }

  if (!config.apiKey) {
    yield { event: 'result', data: JSON.stringify(await resolveFallback(fallback, ctx)) }
    yield { event: 'done', data: JSON.stringify({ status: 'done' }) }
    return
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: buildSystemPrompt(opts.systemPrompt, opts.toolNames, opts.strategyContext) },
    { role: 'user', content: opts.userPrompt },
  ]
  const tools = listToolSpecs(opts.toolNames).map(toolSpecToOpenAI)

  let invalidOutputRetries = 0

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    let response: LLMResponse
    try {
      const { value, retries } = await withRetry(() =>
        chatCompletion(config, {
          messages,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: 'auto',
          temperature: 0.3,
          max_tokens: 4096,
        }),
      )
      response = value
      if (retries > 0) {
        yield { event: 'status', data: JSON.stringify({ message: `LLM 调用失败，已自动重试 ${retries} 次` }) }
      }
    } catch (error) {
      yield { event: 'error', data: JSON.stringify({ message: `LLM 调用失败: ${String(error)}` }) }
      yield { event: 'result', data: JSON.stringify(await resolveFallback(fallback, ctx)) }
      yield { event: 'done', data: JSON.stringify({ status: 'done' }) }
      return
    }

    const nativeCalls = response.tool_calls?.filter((tc) => tc.function?.name) ?? []
    const parsed = extractToolCalls(response.content || '')
    const calls = normalizeToolCalls(nativeCalls, parsed.calls)

    if (calls.length > 0) {
      messages.push({
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
        const envelope = await executeToolCall(call, opts.searchSettings)
        yield {
          event: 'tool_end',
          data: JSON.stringify({
            name: call.name,
            tool_call_id: call.id,
            duration_ms: Date.now() - startTime,
            error: envelope.ok === false,
          }),
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: truncateJson(envelope) })
      }
      trimMessages(messages, MAX_CONTEXT_TOKENS)
      continue
    }

    // No tool calls → structured finish.
    const text = response.content ?? ''
    let candidate: unknown = tryParseJson(text)
    let pushedAssistantText = false
    if (candidate === undefined) {
      messages.push({ role: 'assistant', content: text || '请输出 JSON。' })
      pushedAssistantText = true
      trimMessages(messages, MAX_CONTEXT_TOKENS)
      try {
        const { value: json, retries: jsonRetries } = await withRetry(() =>
          chatCompletionJson<unknown>(config, { messages, temperature: 0.3, max_tokens: 4096 }),
        )
        if (jsonRetries > 0) {
          yield { event: 'status', data: JSON.stringify({ message: `LLM 调用失败，已自动重试 ${jsonRetries} 次` }) }
        }
        candidate = json
      } catch (jsonError) {
        yield { event: 'error', data: JSON.stringify({ message: `结构化输出解析失败: ${String(jsonError)}` }) }
        yield { event: 'result', data: JSON.stringify(await resolveFallback(fallback, ctx)) }
        yield { event: 'done', data: JSON.stringify({ status: 'done' }) }
        return
      }
    }

    const errors = schemaErrors(opts.outputSchema, candidate)
    if (errors.length === 0) {
      yield { event: 'result', data: JSON.stringify(sanitizeJsonStrings(candidate)) }
      yield { event: 'done', data: JSON.stringify({ status: 'done' }) }
      return
    }

    // INVALID_OUTPUT corrective feedback → model re-outputs.
    if (invalidOutputRetries < MAX_INVALID_OUTPUT_RETRIES) {
      invalidOutputRetries++
      // keep the failed attempt in history so the model can see what to fix
      if (!pushedAssistantText) {
        messages.push({ role: 'assistant', content: sanitizeAssistantContent(text) || null })
      }
      messages.push({
        role: 'user',
        content: `你的结构化输出校验未通过，请修正后重新输出**完整** JSON 对象（不写 markdown 代码块、不加工具标记、不加解释文字）：\n${errors.join('; ')}`,
      })
      trimMessages(messages, MAX_CONTEXT_TOKENS)
      continue
    }

    yield { event: 'error', data: JSON.stringify({ code: 'INVALID_OUTPUT', message: errors.join('; ') }) }
    yield { event: 'result', data: JSON.stringify(await resolveFallback(fallback, ctx)) }
    yield { event: 'done', data: JSON.stringify({ status: 'done' }) }
    return
  }

  // Iteration budget exhausted without a validated result.
  yield { event: 'status', data: JSON.stringify({ message: 'AI 未能完成结构化输出，已降级处理' }) }
  yield { event: 'result', data: JSON.stringify(await resolveFallback(fallback, ctx)) }
  yield { event: 'done', data: JSON.stringify({ status: 'done' }) }
}

/** Run a full scenario as a single task (portfolio_diagnosis / log_analysis). */
export async function* runScenario(opts: RunScenarioOptions): AsyncGenerator<AnalysisStreamEvent> {
  yield* runTask({
    systemPrompt: opts.scenario.systemPrompt,
    toolNames: opts.scenario.toolNames,
    outputSchema: opts.scenario.outputSchema,
    userPrompt: opts.userPrompt,
    llmConfig: opts.llmConfig,
    strategyContext: opts.strategyContext,
    searchSettings: opts.searchSettings,
    fallback: opts.fallback ?? opts.scenario.fallback,
    fallbackCtx: opts.fallbackCtx,
  })
}

/** Convenience: consume a task/scenario generator and return the `result` payload. */
export async function collectResult(
  gen: AsyncGenerator<AnalysisStreamEvent>,
): Promise<unknown> {
  let result: unknown = null
  for await (const ev of gen) {
    if (ev.event === 'result') {
      try {
        result = JSON.parse(ev.data)
      } catch {
        // keep previous / null
      }
    }
  }
  return result
}
