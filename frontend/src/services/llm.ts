/**
 * Frontend OpenAI-compatible LLM client.
 *
 * Replaces the Node `openai` package. Calls any OpenAI-compatible
 * `/chat/completions` endpoint (SiliconFlow, DeepSeek, OpenAI, ...) directly
 * from the frontend via `nativeFetch` (browser fetch on Web / tauri-plugin-http
 * on desktop, which bypasses CORS).
 */

import { nativeFetch } from './httpClient'

export interface LLMConfig {
  apiKey: string
  apiBase?: string
  model?: string
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export interface LLMUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

export interface LLMTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface LLMResponse {
  content: string
  usage?: LLMUsage
  tool_calls?: LLMMessage['tool_calls']
}

const DEFAULT_API_BASE = 'https://api.siliconflow.cn/v1'
const DEFAULT_MODEL = 'Qwen/Qwen2.5-7B-Instruct'

function resolveBase(config: LLMConfig): string {
  return (config.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '')
}

function resolveModel(config: LLMConfig): string {
  return config.model || DEFAULT_MODEL
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableLLMError(error: unknown): boolean {
  const msg = String(error).toLowerCase()
  if (/\b(40[134]|422)\b/.test(msg)) return false
  return /timeout|econn|eaddrinuse|enotfound|etimedout|fetch.*failed|network|5\d{2}|429|upstream.*request.*failed|remote.*end.*closed/.test(msg)
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<{ value: T; retries: number }> {
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

export interface ChatCompletionOptions {
  messages: LLMMessage[]
  tools?: LLMTool[]
  tool_choice?: 'auto' | 'none' | 'required'
  temperature?: number
  max_tokens?: number
  response_format?: { type: 'json_object' }
  stream?: boolean
}

function buildBody(config: LLMConfig, options: ChatCompletionOptions, withStream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: resolveModel(config),
    messages: options.messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.max_tokens ?? 4096,
  }
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools
    body.tool_choice = options.tool_choice ?? 'auto'
  }
  if (options.response_format) {
    body.response_format = options.response_format
  }
  if (withStream) {
    body.stream = true
    body.stream_options = { include_usage: true }
  }
  return body
}

async function requestChat(config: LLMConfig, options: ChatCompletionOptions): Promise<Response> {
  const base = resolveBase(config)
  const url = `${base}/chat/completions`
  return nativeFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(buildBody(config, options, false)),
  })
}

/** Non-streaming chat completion. Returns content + usage + optional tool_calls. */
export async function chatCompletion(
  config: LLMConfig,
  options: ChatCompletionOptions,
): Promise<LLMResponse> {
  const { value: response, retries } = await withRetry(() => requestChat(config, options))
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const json = await response.json()
      message = json?.error?.message || json?.error || message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  const json = await response.json()
  const message = json?.choices?.[0]?.message
  const usage = json?.usage
  return {
    content: message?.content ?? '',
    usage: usage
      ? {
          input_tokens: usage.prompt_tokens ?? undefined,
          output_tokens: usage.completion_tokens ?? undefined,
          total_tokens: usage.total_tokens ?? undefined,
        }
      : undefined,
    tool_calls: message?.tool_calls,
  }
}

/** Chat completion with JSON object response (response_format json_object). */
export async function chatCompletionJson<T = Record<string, unknown>>(
  config: LLMConfig,
  options: Omit<ChatCompletionOptions, 'response_format' | 'stream'>,
): Promise<T> {
  const { value: response, retries } = await withRetry(() =>
    requestChat(config, { ...options, response_format: { type: 'json_object' } }),
  )
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const json = await response.json()
      message = json?.error?.message || json?.error || message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  const json = await response.json()
  const content = json?.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty JSON response from LLM')
  return JSON.parse(extractJson(content)) as T
}

export interface StreamChunk {
  token: string
  full: string
  usage?: LLMUsage
}

/**
 * Open a streaming chat completion connection. Performs the HTTP request and
 * returns an async iterable once the response is ready; rejects on failure so
 * callers can retry the connection with `withRetry`.
 */
export async function openChatStream(
  config: LLMConfig,
  options: ChatCompletionOptions,
): Promise<AsyncIterable<StreamChunk>> {
  const base = resolveBase(config)
  const url = `${base}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 300000)

  try {
    const response = await nativeFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildBody(config, options, true)),
      signal: controller.signal,
    })
    if (!response.ok) {
      let message = `HTTP ${response.status}`
      try {
        const json = await response.json()
        message = json?.error?.message || json?.error || message
      } catch {
        // ignore
      }
      throw new Error(message)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    return readStream(reader, () => clearTimeout(timer))
  } catch (error) {
    clearTimeout(timer)
    throw error
  }
}

async function* readStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  cleanup: () => void,
): AsyncGenerator<StreamChunk> {
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let streamUsage: LLMUsage | undefined
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const payload = trimmed.slice(6)
        if (payload === '[DONE]') continue
        try {
          const parsed = JSON.parse(payload)
          if (parsed.usage) {
            streamUsage = {
              input_tokens: parsed.usage.prompt_tokens ?? undefined,
              output_tokens: parsed.usage.completion_tokens ?? undefined,
              total_tokens: parsed.usage.total_tokens ?? undefined,
            }
          }
          const delta = parsed.choices?.[0]?.delta
          const token = delta?.content || ''
          if (token) {
            fullContent += token
            yield { token, full: fullContent, usage: streamUsage }
          }
        } catch {
          // partial line, wait for more
        }
      }
    }
  } finally {
    cleanup()
  }
}

/** Streaming chat completion. Yields `{ token, full, usage? }` chunks. */
export async function* chatCompletionStream(
  config: LLMConfig,
  options: ChatCompletionOptions,
): AsyncGenerator<StreamChunk> {
  const stream = await openChatStream(config, options)
  yield* stream
}

export function extractJson(raw: string): string {
  const stripped = raw.trim()
  if (stripped.startsWith('{')) return stripped
  const jsonMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonMatch) return jsonMatch[1].trim()
  const objMatch = stripped.match(/\{[\s\S]*\}/)
  if (objMatch) return objMatch[0]
  return stripped
}

export { resolveBase, resolveModel }
