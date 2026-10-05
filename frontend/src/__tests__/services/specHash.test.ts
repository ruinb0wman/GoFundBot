import { describe, expect, it } from 'vitest'
import { specHash } from '../../services/backtest/specHash'

describe('specHash', () => {
  it('is stable across key order (Dexie looks runs up by this value)', () => {
    const a = specHash({ period: 'monthly', amount: 1000, feeRate: 0.0015 })
    const b = specHash({ feeRate: 0.0015, period: 'monthly', amount: 1000 })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}$/)
  })

  it('distinguishes specs that differ in any meaningful field', () => {
    const base = { period: 'monthly' as const, amount: 1000, feeRate: 0.0015 }
    const hashes = new Set([
      specHash(base),
      specHash({ ...base, amount: 1001 }),
      specHash({ ...base, feeRate: 0.0016 }),
      specHash({ ...base, takeProfitRate: 0.2 }),
      specHash({ ...base, rule: { type: 'value_averaging', targetGrowth: 0 } }),
      specHash({ ...base, day: 15 }),
    ])
    expect(hashes.size).toBe(6)
  })
})
