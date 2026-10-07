import { describe, expect, it } from 'vitest'
import { runPortfolioBacktest } from '@gofund/core/backtest/portfolioBacktest'
import { samplePortfolioBacktest } from '@gofund/core/backtest/portfolioSample'
import { truncateJson } from '../../utils/json'
import type { NavPoint, PortfolioBacktestResult, PortfolioSpec } from '@gofund/core/backtest/backtestTypes'

/**
 * Regression: `truncateJson` pretty-prints and hard-cuts at 4000 chars, so an
 * oversized payload reaches the model as invalid JSON. The single-fund payload has
 * `backtestPayload.test.ts`; this is the multi-asset equivalent.
 */

function series(days: number, nav: (i: number) => number): NavPoint[] {
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(Date.UTC(2019, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    nav: nav(i),
  }))
}

function run(spec: PortfolioSpec, navByCode: Record<string, NavPoint[]>): PortfolioBacktestResult {
  const result = runPortfolioBacktest(spec, { navByCode })
  if (!('summary' in result)) throw new Error(result.error)
  return result
}

const threeYears = () => series(1100, (i) => 1 + i * 0.0002)

function assertFits(payload: ReturnType<typeof samplePortfolioBacktest>) {
  const wire = truncateJson({ ok: true, data: payload })
  expect(wire, `payload too large: ${wire.length} chars`).not.toContain('truncated')
  return wire
}

describe('samplePortfolioBacktest — stays inside the tool-output budget', () => {
  it('survives truncateJson() for a 4-asset permanent portfolio with 16+ checkpoints', () => {
    const navByCode = {
      A: series(1100, (i) => 1 + i * 0.0005),
      B: series(1100, (i) => 1 + i * 0.0001),
      C: series(1100, (i) => 1.2 + Math.sin(i / 40) * 0.3),
    }
    const spec: PortfolioSpec = {
      assets: [
        { fundCode: 'A', weight: 25 },
        { fundCode: 'B', weight: 25 },
        { fundCode: 'C', weight: 25 },
        { kind: 'cash', annualRate: 0.02, weight: 25 },
      ],
      initialAmount: 100000,
      contribution: { amount: 10000, period: 'yearly' },
      rebalance: { frequency: 'yearly' },
    }
    const payload = samplePortfolioBacktest(run(spec, navByCode), spec)
    expect(payload.checkpoints.length).toBeGreaterThan(4)
    assertFits(payload)
  })

  it('sheds checkpoints for a wide portfolio instead of truncating', () => {
    const navByCode: Record<string, NavPoint[]> = {}
    const assets = Array.from({ length: 12 }, (_, i) => {
      const code = `F${String(i).padStart(2, '0')}`
      navByCode[code] = threeYears()
      return { fundCode: code, weight: 8 }
    })
    const spec: PortfolioSpec = {
      assets,
      initialAmount: 500000,
      contribution: { amount: 20000, period: 'monthly' },
      rebalance: { frequency: 'quarterly' },
    }
    const payload = samplePortfolioBacktest(run(spec, navByCode), spec)
    expect(payload.assets.length).toBe(12)
    expect(payload.checkpoints.length).toBeLessThanOrEqual(12)
    assertFits(payload)
  })

  it('keeps the first, last and investment days while shedding', () => {
    const navByCode = { A: series(1100, (i) => 1 + i * 0.0005), B: series(1100, () => 1) }
    const spec: PortfolioSpec = { assets: [{ fundCode: 'A', weight: 1 }, { fundCode: 'B', weight: 1 }], initialAmount: 10000 }
    const result = run(spec, navByCode)
    const payload = samplePortfolioBacktest(result, spec)
    const dates = payload.checkpoints.map((c) => c.date)
    expect(dates[0]).toBe(result.timeline[0].date)
    expect(dates[dates.length - 1]).toBe(result.timeline[result.timeline.length - 1].date)
    expect(payload.checkpoints_omitted).toBe(result.timeline.length - payload.checkpoints.length)
  })
})
