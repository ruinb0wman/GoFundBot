/**
 * 策略记忆。
 *
 * Node 核心化（P2）后策略存在 service 的 SQLite（`strategies` 表）；
 * 本模块保留原导出签名，内部转发到 `services/userDataApi.ts`。
 * `buildStrategyContext` / `truncate` 仍是纯函数（提示词注入格式不变，测试依赖它们）。
 *
 * 写入后派发 `gofund:strategies-changed`，`StrategyView` 监听并刷新
 * （写者无关：UI 表单与 HTTP 客户端都触发同一个信号）。
 */
import type { StrategyRecord } from './index'
import {
  addStrategyApi,
  listStrategiesApi,
  removeStrategyApi,
  updateStrategyApi,
  type StrategyInput,
} from '../services/userDataApi'

export type { StrategyInput }

const MAX_ACTIVE = 5
const MAX_TITLE = 40
const MAX_CONTENT = 600
const MAX_TOTAL = 3000

export const STRATEGIES_CHANGED_EVENT = 'gofund:strategies-changed'

function notifyStrategiesChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STRATEGIES_CHANGED_EVENT))
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n) + '...'
}

/**
 * Format active strategy records into a compact markdown section that can be
 * injected into AI prompts. Pure function — accepts records explicitly for
 * testability.
 */
export function buildStrategyContext(strategies: StrategyRecord[]): string {
  const active = (strategies ?? [])
    .filter(s => s.active === 1)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

  if (active.length === 0) return ''

  const parts = ['## 用户投资策略']
  const items: string[] = []
  let total = 0
  for (const s of active) {
    if (items.length >= MAX_ACTIVE) break
    const title = truncate(s.title || '未命名策略', MAX_TITLE)
    const content = truncate(s.content || '', MAX_CONTENT)
    const tags = Array.isArray(s.tags) ? s.tags.filter(Boolean) : []
    let text = `### ${items.length + 1}. ${title}`
    if (tags.length > 0) text += `\n标签：${tags.join('、')}`
    if (content) text += `\n内容：${content}`
    if (total + text.length > MAX_TOTAL && total > 0) break
    if (total + text.length > MAX_TOTAL) {
      const room = MAX_TOTAL - total
      text = text.slice(0, Math.max(room, 50)) + '...'
    }
    items.push(text)
    total += text.length
  }
  if (items.length === 0) return ''
  parts.push(...items)
  return parts.join('\n')
}

/** Query active strategy memory entries (enabled only), newest updated first. */
export async function getActiveStrategies(): Promise<StrategyRecord[]> {
  const all = await listStrategiesApi()
  return all.filter(s => s.active === 1).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

/** Query all strategy entries (服务端已按「启用优先 + 更新时间倒序」返回). */
export async function listStrategies(): Promise<StrategyRecord[]> {
  return listStrategiesApi()
}

/** Build strategy context for prompt injection from the API (convenience). */
export async function buildActiveStrategyContext(): Promise<string> {
  return buildStrategyContext(await getActiveStrategies())
}

export async function addStrategy(input: StrategyInput): Promise<number> {
  const created = await addStrategyApi({
    title: input.title,
    content: input.content,
    tags: input.tags ?? [],
    active: input.active ?? 1,
    source: input.source ?? 'manual',
  })
  notifyStrategiesChanged()
  return created.id
}

export async function updateStrategy(id: number, patch: Partial<StrategyInput>): Promise<void> {
  await updateStrategyApi(id, patch)
  notifyStrategiesChanged()
}

export async function toggleStrategyActive(id: number, active: boolean): Promise<void> {
  await updateStrategy(id, { active: active ? 1 : 0 })
}

export async function removeStrategy(id: number): Promise<void> {
  await removeStrategyApi(id)
  notifyStrategiesChanged()
}
