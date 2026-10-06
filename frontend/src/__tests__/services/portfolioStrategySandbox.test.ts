import { describe, expect, it } from 'vitest'
import {
  handleRunPortfolioStrategyRequest,
  makePortfolioDecision,
  StrategyCodeError,
  toIndexDecision,
} from '../../services/backtest/strategySandbox'
import type { NavPoint, PortfolioDecisionState, PortfolioSpec } from '../../services/backtest/backtestTypes'

const SERIES: Record<string, NavPoint[]> = {
  A: [
    { date: '2020-01-01', nav: 1 },
    { date: '2020-02-01', nav: 3 },
    { date: '2020-03-01', nav: 3 },
  ],
  B: [
    { date: '2020-01-01', nav: 1 },
    { date: '2020-02-01', nav: 1 },
    { date: '2020-03-01', nav: 1 },
  ],
}

const SPEC: PortfolioSpec = {
  assets: [
    { fundCode: 'A', weight: 50 },
    { fundCode: 'B', weight: 50 },
  ],
  initialAmount: 1000,
  feeRate: 0,
}

function state(overrides: Partial<PortfolioDecisionState> = {}): PortfolioDecisionState {
  return {
    i: 0,
    date: '2020-01-01',
    navs: [1, 1],
    history: [
      [1],
      [1],
    ],
    codes: ['A', 'B'],
    shares: [0, 0],
    values: [0, 0],
    cash: 0,
    invested: 0,
    value: 0,
    ...overrides,
  }
}

describe('toIndexDecision', () => {
  it('maps code-addressed buys/sells to engine indices', () => {
    expect(toIndexDecision({ buy: [{ code: 'B', amount: 500 }] }, ['A', 'B'], '2020-01-01')).toEqual({
      buy: [{ asset: 1, amount: 500 }],
    })
  })

  it('maps a rebalance record to the full weight vector', () => {
    expect(toIndexDecision({ rebalance: { A: 1 } }, ['A', 'B'], '2020-01-01')).toEqual({ rebalance: [1, 0] })
  })

  it('rejects undeclared codes, bad amounts and bad rebalance values', () => {
    expect(() => toIndexDecision({ buy: [{ code: 'Z', amount: 1 }] }, ['A', 'B'], '2020-01-01')).toThrow(/未在 prepare/)
    expect(() => toIndexDecision({ sell: [{ code: 'A', amount: -1 }] }, ['A', 'B'], '2020-01-01')).toThrow(/正数/)
    expect(() => toIndexDecision({ rebalance: [1, 0] }, ['A', 'B'], '2020-01-01')).toThrow(/对象/)
  })
})

describe('makePortfolioDecision', () => {
  const noop = 'function onDay(s) { return {} }'

  it('returns an empty decision for a no-op day and accepts a code-addressed buy', () => {
    expect(makePortfolioDecision(noop)(state())).toEqual({})
    const decide = makePortfolioDecision("function onDay(s) { return { buy: [{ code: 'B', amount: 500 }] } }")
    expect(decide(state())).toEqual({ buy: [{ asset: 1, amount: 500 }] })
  })

  it('exposes code-addressed helpers on s', () => {
    const decide = makePortfolioDecision(
      'function onDay(s) { return { buy: [{ code: "A", amount: s.nav("A") + s.ma("A", 1) + s.weight("A") }] } }',
    )
    const out = decide(state({ navs: [2, 1], history: [[1, 2], [1, 1]], values: [50, 50] })) as {
      buy?: Array<{ amount: number }>
    }
    expect(out.buy?.[0].amount).toBeCloseTo(2 + 1 + 0.5)
  })

  it('tags runtime errors with the offending date', () => {
    const decide = makePortfolioDecision("function onDay(s) { if (s.date === '2020-02-01') throw new Error('boom'); return {} }")
    expect(decide(state())).toEqual({})
    expect(() => decide(state({ date: '2020-02-01' }))).toThrow(/2020-02-01.*boom/)
  })

  it('rejects code without onDay', () => {
    expect(() => makePortfolioDecision('function prepare() { return {} }')).toThrow(StrategyCodeError)
  })
})

describe('handleRunPortfolioStrategyRequest', () => {
  it('runs a rebalance strategy and returns a portfolio result', () => {
    const response = handleRunPortfolioStrategyRequest({
      spec: SPEC,
      navByCode: SERIES,
      code: "function onDay(s) { return s.i === 1 ? { rebalance: { A: 0.5, B: 0.5 } } : {} }",
    })
    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.result.summary.rebalance_count).toBe(1)
      expect(response.result.assets.map((a) => a.finalWeight)).toEqual([50, 50])
    }
  })

  it('exposes helpers so a rule can react to a leg moving', () => {
    const response = handleRunPortfolioStrategyRequest({
      spec: { ...SPEC, initialAmount: 1000 },
      navByCode: SERIES,
      code: "function onDay(s) { if (s.pctChange('A', 1) > 0.5) return { rebalance: { A: 0.25, B: 0.75 } }; return {} }",
    })
    expect(response.ok).toBe(true)
    if (response.ok) expect(response.result.summary.rebalance_count).toBeGreaterThanOrEqual(1)
  })

  it('supports sellAll with exit_reason=custom', () => {
    const response = handleRunPortfolioStrategyRequest({
      spec: SPEC,
      navByCode: SERIES,
      code: "function onDay(s) { return s.date === '2020-02-01' ? { sellAll: true } : {} }",
    })
    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.result.summary.exit_reason).toBe('custom')
      expect(response.result.timeline[response.result.timeline.length - 1]?.status).toBe('sold')
    }
  })
})
