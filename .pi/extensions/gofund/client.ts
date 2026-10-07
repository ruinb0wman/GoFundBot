/**
 * GoFundBot `service` 的 HTTP 客户端（`/api/agent/*`）。
 *
 * 工具契约（名称/描述/JSON Schema）由 service 提供，这里只负责：
 * 拉清单、发调用、把结果裁成模型能读的文本。**不再在扩展里抄任何数据映射** ——
 * 口径唯一真源是 `service/src/agent/tools*.ts`。
 */

/** Service 地址。service 跑在别处时用 `GOFUND_API_BASE` 覆盖。 */
export const SERVICE_BASE = (process.env.GOFUND_API_BASE ?? 'http://localhost:8310').replace(/\/+$/, '')

/** 回测类工具要取净值，给足时间；单个 provider 自己还有超时。 */
const REQUEST_TIMEOUT_MS = 60_000

export interface AgentToolManifestItem {
  name: string
  label: string
  description: string
  promptSnippet: string
  readOnly: boolean
  parameters: Record<string, unknown>
}

export interface AgentToolManifest {
  tools: AgentToolManifestItem[]
  count: number
  destructive: string[]
}

export interface TextOnlyResult {
  content: Array<{ type: 'text'; text: string }>
  details: Record<string, unknown>
}

export const SERVICE_HINT =
  `GoFundBot service 没起来（或地址不对）。请在 service/ 目录执行 bun run dev（默认 ${SERVICE_BASE}），` +
  `或用 GOFUND_API_BASE 指定地址。`

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${SERVICE_BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`${SERVICE_HINT}\n（${String(error)}）`)
  }
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GoFundBot service HTTP ${response.status}（${path}）：${text.slice(0, 400)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`GoFundBot service 返回非 JSON（${path}）：${text.slice(0, 200)}`)
  }
}

/** `{ success, data }` 信封 → `data`。 */
function unwrap<T = unknown>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in body) return (body as { data: T }).data
  return body as T
}

export async function fetchToolManifest(): Promise<AgentToolManifest> {
  const data = unwrap<AgentToolManifest>(await requestJson('/api/agent/tools'))
  if (!data || !Array.isArray(data.tools)) throw new Error('工具清单格式不对')
  return data
}

export interface AgentCallResult {
  tool: string
  result?: unknown
  error?: string
  confirm_required?: boolean
  token?: string
  message?: string
}

export async function callAgentTool(tool: string, args: unknown): Promise<AgentCallResult> {
  const body = await requestJson('/api/agent/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool, args: args ?? {} }),
  })
  return unwrap<AgentCallResult>(body)
}

/** 结果 → 工具返回的文本（含写操作确认提示）。 */
export function toToolResult(tool: string, payload: AgentCallResult): TextOnlyResult {
  if (payload.confirm_required) {
    return {
      content: [
        {
          type: 'text',
          text:
            `⚠️ 需要用户确认：\`${tool}\` 会写入数据。\n` +
            `请把你这次要写入的**完整内容**原样展示给用户并取得明确同意，` +
            `然后用**完全相同的参数**加上 __confirm_token 重新调用本工具` +
            `（参数改一个字符令牌就失效，需要重新走一次确认）。\n\n` +
            `__confirm_token: ${payload.token}`,
        },
      ],
      details: { tool, confirm_required: true },
    }
  }
  if (payload.error) {
    return { content: [{ type: 'text', text: `调用失败：${payload.error}` }], details: { tool, error: payload.error } }
  }
  const text = JSON.stringify(payload.result ?? null, null, 1) ?? 'null'
  return { content: [{ type: 'text', text }], details: { tool } }
}

/** 把任意错误变成模型能读懂的文本结果（不要把异常抛给 pi）。 */
export function errorResult(tool: string, error: unknown): TextOnlyResult {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: 'text', text: `调用失败：${message}` }], details: { tool, error: message } }
}
