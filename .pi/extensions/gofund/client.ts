/**
 * GoFundBot service HTTP client for the `.pi/extensions/gofund/*` tools.
 *
 * Thin, read-only adapter over the existing Express routes. Nothing here adds
 * service code; every endpoint already backs the web UI. The response shapes
 * consumed below are documented in `README.md` and mirrored (deliberately, for
 * now) from `frontend/src/services/chatEngine/toolHandlers.ts`.
 */

/** Service origin. Override with `GOFUND_API_BASE` when the service runs elsewhere. */
export const SERVICE_BASE = (process.env.GOFUND_API_BASE ?? 'http://localhost:8310').replace(/\/+$/, '')

/** Bounds a hung data source. Individual providers have their own timeouts. */
const REQUEST_TIMEOUT_MS = 15_000

/** Custom-tool results get no automatic truncation (unlike MCP's 20 KB), so cap them here. */
const DEFAULT_MAX_CHARS = 30_000

export interface TextOnlyResult {
  content: Array<{ type: 'text'; text: string }>
  details: { endpoint: string; truncated?: boolean }
}

type QueryValue = string | number | boolean | null | undefined

/**
 * GET a service route and parse the JSON body. Transport failures become an
 * actionable message so the model reports "service not running" instead of
 * silently losing the data source (or inventing numbers).
 */
export async function apiGet(path: string, params?: Record<string, QueryValue>): Promise<unknown> {
  const url = new URL(`${SERVICE_BASE}${path}`)
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    throw new Error(
      `GoFundBot service 请求失败（${url.origin}）：${String(error)}。` +
        `请确认 service 已启动（在 service/ 下执行 bun run dev），或用 GOFUND_API_BASE 指定地址。`
    )
  }

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GoFundBot service HTTP ${response.status}（${url.pathname}）：${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`GoFundBot service 返回非 JSON（${url.pathname}）：${text.slice(0, 200)}`)
  }
}

/** Mirror of the frontend `unpack()`: `{ success, data }` envelope → `data`, else the body. */
export function unwrap<T = unknown>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as { data: T }).data
  }
  return body as T
}

/** GET + unwrap, for the routes that use `sendSuccess`. */
export async function apiGetData<T = unknown>(
  path: string,
  params?: Record<string, QueryValue>
): Promise<T> {
  return unwrap<T>(await apiGet(path, params))
}

/** Clamp an optional numeric tool argument to a route's accepted range. */
export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(Math.max(Math.floor(num), min), max)
}

/** Model-facing JSON with a hard size cap. */
export function jsonResult(data: unknown, endpoint: string, maxChars = DEFAULT_MAX_CHARS): TextOnlyResult {
  let text = JSON.stringify(data) ?? 'null'
  let truncated = false
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n…（结果超过 ${maxChars} 字符已截断，请缩小时间范围或减少 limit 后重试）`
    truncated = true
  }
  return { content: [{ type: 'text', text }], details: { endpoint, truncated } }
}
