/**
 * GoFundBot 工具扩展 —— 服务端工具面（`/api/agent/tools`）的**通用桥**。
 *
 * 这里不再定义任何具体工具：扩展启动时向 service 拉工具清单（名称/描述/JSON Schema），
 * 逐个注册成 pi 工具。所有数据映射与口径都在 `service/src/agent/tools*.ts`，
 * 所以 pi / 脚本 / curl 走的是同一份实现。
 *
 * 三级降级：
 * 1. service 在线 → 用它的清单（最新）；
 * 2. service 离线 → `.pi/extensions/gofund/tools.manifest.json`（`bun run gen:tools` 生成）；
 * 3. 连静态清单都没有 → 只注册一个泛化的 `gofund_call(tool, args)`。
 *
 * 生成静态清单：在仓库根目录 `bun run gen:tools`（写 `tools.manifest.ts`，普通 import 读进来，
 * 不用 fs/相对路径 —— 扩展由 jiti 加载，路径相关的写法最容易在加载期炸）。
 */

import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from '@earendil-works/pi-ai'
import { callAgentTool, errorResult, fetchToolManifest, toToolResult } from './client.ts'
import type { AgentToolManifest, AgentToolManifestItem } from './client.ts'
import { STATIC_MANIFEST } from './tools.manifest.ts'

type ToolParameters = Parameters<typeof defineTool>[0]['parameters']

/** 静态清单（`bun run gen:tools` 生成）—— 只用来在 service 离线时仍有工具可调。 */
function readStaticManifest(): AgentToolManifest | null {
  const manifest = STATIC_MANIFEST as unknown as AgentToolManifest
  return Array.isArray(manifest?.tools) && manifest.tools.length > 0 ? manifest : null
}

/** 一个 service 工具 → pi 工具。 */
function buildTool(item: AgentToolManifestItem) {
  return defineTool({
    name: item.name,
    label: item.label,
    description: item.description,
    promptSnippet: item.promptSnippet,
    parameters: item.parameters as unknown as ToolParameters,
    async execute(_toolCallId: string, params: unknown) {
      try {
        return toToolResult(item.name, await callAgentTool(item.name, params ?? {}))
      } catch (error) {
        return errorResult(item.name, error)
      }
    },
  } as Parameters<typeof defineTool>[0])
}

/** 没有清单时的兜底：把任意工具名转给 service。 */
function registerGenericTool(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool({
      name: 'gofund_call',
      label: '调用 GoFundBot 工具',
      description:
        '调用 GoFundBot service 的任意工具（工具名与参数见 service 的 GET /api/agent/tools）。' +
        'service 未启动时会返回明确的报错提示。',
      promptSnippet: 'gofund_call(tool, args): 调用 GoFundBot 服务端工具（清单见 /api/agent/tools）',
      parameters: Type.Object({
        tool: Type.String({ description: '工具名，例如 get_market_indices' }),
        args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: '工具参数对象' })),
      }),
      async execute(_toolCallId: string, params: { tool: string; args?: Record<string, unknown> }) {
        try {
          return toToolResult(params.tool, await callAgentTool(params.tool, params.args ?? {}))
        } catch (error) {
          return errorResult(params.tool, error)
        }
      },
    })
  )
}

export default async function gofundDataExtension(pi: ExtensionAPI): Promise<void> {
  let manifest: AgentToolManifest | null = null
  try {
    manifest = await fetchToolManifest()
  } catch {
    manifest = readStaticManifest()
  }

  if (!manifest || manifest.tools.length === 0) {
    registerGenericTool(pi)
    return
  }

  for (const item of manifest.tools) {
    pi.registerTool(buildTool(item))
  }
}
