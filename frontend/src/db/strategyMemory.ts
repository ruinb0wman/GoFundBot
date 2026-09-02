import { db, type StrategyRecord } from './index'

export interface StrategyInput {
  title: string
  content: string
  tags: string[]
  active?: number
  source?: 'manual' | 'ai-draft'
}

const MAX_ACTIVE = 5
const MAX_TITLE = 40
const MAX_CONTENT = 600
const MAX_TOTAL = 3000

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

/** Query active strategy memory entries (enabled only). */
export async function getActiveStrategies(): Promise<StrategyRecord[]> {
  const all = await db.strategies
    .where('active')
    .equals(1)
    .toArray()
  return all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

/** Query all strategy entries, enabled first, then most recently updated. */
export async function listStrategies(): Promise<StrategyRecord[]> {
  const all = await db.strategies.toArray()
  return all.sort((a, b) => {
    if (a.active !== b.active) return b.active - a.active
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  })
}

/** Build strategy context for prompt injection from the DB (convenience). */
export async function buildActiveStrategyContext(): Promise<string> {
  return buildStrategyContext(await getActiveStrategies())
}

export async function addStrategy(input: StrategyInput): Promise<number> {
  const now = Date.now()
  return db.strategies.add({
    title: input.title.trim() || '未命名策略',
    content: input.content.trim(),
    tags: (input.tags ?? []).filter(Boolean),
    active: input.active ?? 1,
    source: input.source ?? 'manual',
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateStrategy(id: number, patch: Partial<StrategyInput>): Promise<void> {
  await db.strategies.update(id, {
    ...(patch.title !== undefined ? { title: patch.title.trim() || '未命名策略' } : {}),
    ...(patch.content !== undefined ? { content: patch.content.trim() } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags.filter(Boolean) } : {}),
    ...(patch.active !== undefined ? { active: patch.active } : {}),
    ...(patch.source !== undefined ? { source: patch.source } : {}),
    updatedAt: Date.now(),
  })
}

export async function toggleStrategyActive(id: number, active: boolean): Promise<void> {
  await updateStrategy(id, { active: active ? 1 : 0 })
}

export async function removeStrategy(id: number): Promise<void> {
  await db.strategies.delete(id)
}
