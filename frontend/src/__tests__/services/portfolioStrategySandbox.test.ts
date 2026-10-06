import { describe, expect, it } from 'vitest'
import {
  handleRunPortfolioStrategyRequest,
  makePortfolioDecision,
  makePortfolioHelpers,
  StrategyCodeError,
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

describe('makePortfolioHelpers', () => {
  it('ma/pctChange look strictly backwards per asset', () => {
    const helpers = makePortfolioHelpers(
      [
        [1, 2, 3],
        [10, 20, 30],
      ],
      [0, 0],
      0,
    )
    expect(helpers.ma(0, 2)).toBe(1.5) // today's 3 excluded
    expect(helpers.pctChange(0, 2)).toBe(2) // 3 / 1 - 1
    expect(helpers.ma(1, 2)).toBe(15)
  })

  it('weight includes cash in the denominator', () => {
    const helpers = makePortfolioHelpers([[], []], [750, 250], 1000)
    expect(helpers.weight(0)).toBe(0.375)
    expect(helpers.weight(1)).toBe(0.125)
  })
})

describe('makePortfolioDecision', () => {
  it('returns an empty decision for a no-op day and accepts a valid one', () => {
    expect(makePortfolioDecision('return {}')(state())).toEqual({})
    expect(makePortfolioDecision('return { buy: [{ asset: 1, amount: 500 }] }')(state())).toEqual({
      buy: [{ asset: 1, amount: 500 }],
    })
  })

  it('rejects out-of-range assets, bad amounts and wrong rebalance length', () => {
    const decide = makePortfolioDecision('return { buy: [{ asset: 5, amount: 100 }] }')
    expect(() => decide(state())).toThrow(/asset 下标越界/)
    expect(() => makePortfolioDecision('return { sell: [{ asset: 0, amount: -1 }] }')(state())).toThrow(/正数/)
    expect(() => makePortfolioDecision('return { rebalance: [1] }')(state())).toThrow(/长度 2/)
  })

  it('tags runtime errors with the offending date', () => {
    const decide = makePortfolioDecision("if (s.date === '2020-02-01') throw new Error('boom'); return {}")
    expect(decide(state())).toEqual({})
    expect(() => decide(state({ date: '2020-02-01' }))).toThrow(/2020-02-01.*boom/)
  })
})

describe('handleRunPortfolioStrategyRequest', () => {
  it('runs a rebalance strategy and returns a portfolio result', () => {
    const response = handleRunPortfolioStrategyRequest({
      spec: SPEC,
      navByCode: SERIES,
      code: 'return s.i === 1 ? { rebalance: [0.5, 0.5] } : {}',
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
      code: 'if (s.helpers.pctChange(0, 1) > 0.5) return { rebalance: [0.25, 0.75] }; return {}',
    })
    expect(response.ok).toBe(true)
    if (response.ok) expect(response.result.summary.rebalance_count).toBeGreaterThanOrEqual(1)
  })

  it('supports sellAll with exit_reason=custom', () => {
    const response = handleRunPortfolioStrategyRequest({
      spec: SPEC,
      navByCode: SERIES,
      code: 'return s.i === 1 ? { sellAll: true } : {}',
    })
    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.result.summary.exit_reason).toBe('custom')
      expect(response.result.summary.exit_date).toBe('2020-02-01')
    }
  })

  it('returns a date-tagged error for invalid code without throwing', () => {
    const response = handleRunPortfolioStrategyRequest({
      spec: SPEC,
      navByCode: SERIES,
      code: 'return { rebalance: [1] }',
    })
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error).toMatch(/长度 2/)
  })

  it('returns an error for empty code', () => {
    expect(handleRunPortfolioStrategyRequest({ spec: SPEC, navByCode: SERIES, code: '' })).toEqual({
      ok: false,
      error: '策略代码为空',
    })
  })

  it('compiles a full function declaration too', () => {
    const response = handleRunPortfolioStrategyRequest({
      spec: SPEC,
      navByCode: SERIES,
      code: 'function onDay(s) { return { buy: [{ asset: 0, amount: 100 }] }; }',
    })
    expect(response.ok).toBe(true)
    if (response.ok) expect(response.result.summary.total_invested).toBe(1300) // 1000 initial + 3 × 100
  })

  it('throws StrategyCodeError from the compiler for oversized code', () => {
    expect(() => makePortfolioDecision('x'.repeat(9000))).toThrow(StrategyCodeError)
  })
})
