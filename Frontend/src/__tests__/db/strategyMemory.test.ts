import { describe, it, expect } from 'vitest'
import { buildStrategyContext, truncate } from '../../db/strategyMemory'
import type { StrategyRecord } from '../../db'

function rec(partial: Partial<StrategyRecord>): StrategyRecord {
  return {
    title: 't',
    content: 'c',
    tags: [],
    active: 1,
    source: 'manual',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

describe('buildStrategyContext', () => {
  it('returns empty when no active strategies', () => {
    expect(buildStrategyContext([])).toBe('')
    expect(buildStrategyContext([rec({ active: 0 })])).toBe('')
  })

  it('only includes active strategies, newest first', () => {
    const ctx = buildStrategyContext([
      rec({ title: '旧策略', updatedAt: 100, active: 1 }),
      rec({ title: '新策略', updatedAt: 200, active: 1 }),
      rec({ title: '停用策略', updatedAt: 300, active: 0 }),
    ])
    expect(ctx).toContain('新策略')
    expect(ctx).toContain('旧策略')
    expect(ctx).not.toContain('停用策略')
    expect(ctx.indexOf('新策略')).toBeLessThan(ctx.indexOf('旧策略'))
  })

  it('renders tags inline', () => {
    const ctx = buildStrategyContext([rec({ title: '定投', tags: ['定投', '长期持有'] })])
    expect(ctx).toContain('标签：定投、长期持有')
  })

  it('caps at 5 active strategies', () => {
    const many = Array.from({ length: 8 }, (_, i) => rec({ title: `策略${i}`, updatedAt: i }))
    const ctx = buildStrategyContext(many)
    const count = (ctx.match(/^### /gm) || []).length
    expect(count).toBe(5)
  })

  it('truncates overly long content', () => {
    const ctx = buildStrategyContext([rec({ title: '标题', content: 'x'.repeat(700) })])
    expect(ctx.length).toBeLessThan(700)
  })
})

describe('truncate', () => {
  it('returns the original when short enough', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates long strings with ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello...')
  })
})
