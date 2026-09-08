/**
 * Shared tool-calling loop primitives.
 *
 * Extracted from `chatEngine/index.ts` so the same boundary contract
 * (normalization → validation → `{ok,data}|{ok,error}` envelope → corrective
 * feedback) is reused verbatim by every AI analysis scenario
 * (`services/analysis/analysisEngine.ts`). Chat behavior is unchanged.
 */

import { executeTool } from './toolHandlers'
import { validateToolCall } from './toolContract'
import type { LLMMessage } from '../llm'
import type { AppSettings } from '../../composables/useAppSettings'

export const MAX_TOOL_ITERATIONS = 8
export const MAX_TOOL_CALLS_PER_TURN = 8
export const MAX_CONTEXT_TOKENS = 50000
const CHARS_PER_TOKEN = 3

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isRetryableLLMError(error: unknown): boolean {
  const msg = String(error).toLowerCase()
  if (/\b(40[134]|422)\b/.test(msg)) return false
  return /timeout|econn|eaddrinuse|enotfound|etimedout|fetch.*failed|network|5\d{2}|429|upstream.*request.*failed|remote.*end.*closed/.test(msg)
}

export async function withRetry<T>(
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

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function estimateMessagesTokens(messages: LLMMessage[]): number {
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

export function trimMessages(messages: LLMMessage[], maxTokens: number): void {
  while (estimateMessagesTokens(messages) > maxTokens && messages.length > 1) {
    const skip = messages.length > 0 && messages[0]?.role === 'system' ? 1 : 0
    if (messages.length <= skip + 1) break
    messages.splice(skip, 1)
  }
}

export interface NormalizedCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/** Merge native + XML transports into one typed list (native wins on duplicates). */
export function normalizeToolCalls(
  native: NonNullable<LLMMessage['tool_calls']>,
  xml: Array<{ name: string; args: Record<string, unknown> }>,
): NormalizedCall[] {
  const seen = new Set<string>()
  const out: NormalizedCall[] = []
  const push = (id: string, name: string, args: Record<string, unknown>) => {
    const key = `${name}\u0000${JSON.stringify(args ?? {})}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ id, name, args })
  }
  for (const tc of native) {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(tc.function.arguments || '{}')
    } catch {
      // keep {}
    }
    push(tc.id, tc.function.name, args)
  }
  for (const c of xml) push(`xml-${out.length}`, c.name, c.args)
  return out.slice(0, MAX_TOOL_CALLS_PER_TURN)
}

export type ToolEnvelope =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } }

/**
 * Validate before execution, run the handler, and wrap the outcome in a typed
 * envelope. Unknown names / bad params produce corrective errors fed back to the
 * model so it can self-correct (same pattern as pi blocking unavailable tools).
 */
export async function executeToolCall(
  call: NormalizedCall,
  searchSettings?: AppSettings,
): Promise<ToolEnvelope> {
  const validated = validateToolCall(call.name, call.args)
  if (!validated.ok) {
    return { ok: false, error: { code: validated.code ?? 'INVALID_ARGS', message: validated.error ?? '参数无效' } }
  }
  try {
    const result = await executeTool(call.name, validated.args as Record<string, unknown>, { searchSettings })
    // Handler failures surface as a bare `{ error: string }` object
    const keys = result && typeof result === 'object' ? Object.keys(result as Record<string, unknown>) : []
    if (keys.length === 1 && keys[0] === 'error') {
      return { ok: false, error: { code: 'TOOL_ERROR', message: String((result as Record<string, unknown>).error) } }
    }
    return { ok: true, data: result }
  } catch (error) {
    return { ok: false, error: { code: 'TOOL_ERROR', message: String(error) } }
  }
}

export function truncateJson(value: unknown, maxLen = 4000): string {
  let str = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (str.length > maxLen) {
    str = str.slice(0, maxLen) + '... (truncated)'
  }
  return str
}
