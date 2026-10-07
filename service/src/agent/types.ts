/**
 * pi 工具面的**唯一契约真源**。
 *
 * 工具定义挪到 service 的理由（原来每个工具在 `.pi/extensions/gofund/tools/*.ts` 里
 * 抄一份「路由 → 模型可读形状」的映射，前端 `toolHandlers.ts` 又抄一份）：
 * 口径只有一份、calamine 的踩坑注释也只写一次，而且 pi 之外（脚本、curl）也能用同一个入口。
 *
 * - `params` 用 **Zod**（service 已有依赖）：既能校验调用参数，也能 `z.toJSONSchema()` 派生成
 *   pi 工具的 JSON Schema / OpenAI tools 参数。
 * - `readOnly: false` 的工具（写入类）第一次调用只返回 `CONFIRM_REQUIRED` + 令牌，
 *   拿到令牌再调一次才真正执行（见 `confirm.ts`）。
 */
import { z } from 'zod'
import type { ServiceResult } from '../types/common.js'

export interface AgentTool<Args = never> {
  name: string
  /** 人类可读标题（pi 的工具列表里显示）。 */
  label: string
  /** 给模型看的描述 —— 写清口径与陷阱，别写实现细节。 */
  description: string
  /** pi 的系统提示里那一行短说明。 */
  promptSnippet: string
  params: z.ZodType<Args>
  /** 只读工具为 true；写入/执行类为 false（需要确认令牌）。 */
  readOnly: boolean
  handler: (args: Args) => Promise<unknown> | unknown
}

/** 只为让 `handler` 的参数类型跟着 `params` 走。 */
export function defineAgentTool<Args>(tool: AgentTool<Args>): AgentTool<Args> {
  return tool
}

export interface AgentToolManifestItem {
  name: string
  label: string
  description: string
  promptSnippet: string
  readOnly: boolean
  parameters: Record<string, unknown>
}

/** 模型侧 JSON Schema：去掉 zod 自带的 `$schema` 声明（有些供应商不认）。 */
export function manifestItem(tool: AgentTool<never>): AgentToolManifestItem {
  const schema = z.toJSONSchema(tool.params as z.ZodType) as Record<string, unknown>
  delete schema.$schema
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    promptSnippet: tool.promptSnippet,
    readOnly: tool.readOnly,
    parameters: schema,
  }
}

/** 北向成交总额 → 亿元。`DEAL_AMT` 单位是百万元，所以除以 100 而不是 10000。 */
export function toYi(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? +(value / 100).toFixed(2) : null
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(Math.max(Math.floor(num), min), max)
}

/**
 * 与 `core/response.ts` 的 `isServiceResult` 同款判定：
 * 路由用 `sendSuccess` 时会把 ServiceResult 拆开，只把内层 `data` 交给客户端，
 * 所以工具结果也要保持一致（否则模型看到的形状和以前不一样）。
 */
export function unwrapServiceResult<T>(value: ServiceResult<T> | T): T {
  if (
    value &&
    typeof value === 'object' &&
    'data' in value &&
    'provider' in value &&
    'fallback' in value &&
    'cached' in value &&
    'stale' in value &&
    'updatedAt' in value
  ) {
    return (value as ServiceResult<T>).data
  }
  return value as T
}
