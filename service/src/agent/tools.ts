/**
 * pi 工具注册表（唯一真源）：`GET /api/agent/tools` 的清单与 `POST /api/agent/call` 的执行都读它。
 *
 * 处理器直接调 service 内部函数（不走 HTTP 自调用），所以口径只有一份。
 */
import { computeTools } from './toolsCompute.js'
import { fundTools } from './toolsFund.js'
import { marketTools } from './toolsMarket.js'
import { watchlistTools } from './toolsWatchlist.js'
import { manifestItem, type AgentTool, type AgentToolManifestItem } from './types.js'

export const AGENT_TOOLS = [
  ...marketTools,
  ...fundTools,
  ...watchlistTools,
  ...computeTools,
] as unknown as AgentTool<never>[]

export function findAgentTool(name: string): AgentTool<never> | undefined {
  return AGENT_TOOLS.find((tool) => tool.name === name)
}

export interface AgentManifest {
  tools: AgentToolManifestItem[]
  count: number
  /** 需要用户确认（写操作）的工具名，方便客户端提示。 */
  destructive: string[]
}

export function agentToolManifest(): AgentManifest {
  const tools = AGENT_TOOLS.map((tool) => manifestItem(tool))
  return {
    tools,
    count: tools.length,
    destructive: tools.filter((tool) => !tool.readOnly).map((tool) => tool.name),
  }
}

export type { AgentTool, AgentToolManifestItem }
