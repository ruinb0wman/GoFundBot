import { describe, expect, it } from 'vitest'
import { runBacktest } from '../../services/backtest/backtestEngine'
import { isBacktestResult, type BacktestResult, type NavPoint } from '../../services/backtest/backtestTypes'
import {
  compileDecision,
  handleRunStrategyRequest,
  makeDecision,
  makeHelpers,
  StrategyCodeError,
} from '../../services/backtest/strategySandbox'

/** One NAV point per month, on the 1st — monthly DCA then buys on every date. */
const MONTHLY_NAV: NavPoint[] = [
  { date: '2025-01-01', nav: 1.0 },
  { date: '2025-02-01', nav: 1.1 },
  { date: '2025-03-01', nav: 1.2 },
  { date: '2025-04-01', nav: 0.9 },
  { date: '2025-05-01', nav: 1.3 },
  { date: '2025-06-01', nav: 1.4 },
]

function result(value: BacktestResult | { error: string }): BacktestResult {
  if (!isBacktestResult(value)) throw new Error(`expected result, got: ${value.error}`)
  return value
}

describe('backtestEngine custom hooks', () => {
  it('reproduces plain monthly DCA when the code buys every month', () => {
    const spec = { period: 'monthly' as const, amount: 1000, feeRate: 0 }
    const baseline = runBacktest(MONTHLY_NAV, spec)
    const custom = runBacktest(MONTHLY_NAV, { feeRate: 0 }, {
      decide: (s) => (s.date.endsWith('-01') ? { buy: 1000 } : {}),
    })
    expect(custom).toEqual(baseline)
  })

  it('honours sellAll, tags exit_reason=custom and stops buying afterwards', () => {
    const outcome = result(
      runBacktest(MONTHLY_NAV, { feeRate: 0 }, {
        decide: (s) => (s.date === '2025-03-01' ? { buy: 1000, sellAll: true } : { buy: 1000 }),
      }),
    )
    expect(outcome.summary.exit_reason).toBe('custom')
    expect(outcome.summary.exit_date).toBe('2025-03-01')
    const afterExit = outcome.timeline.filter((r) => r.date > '2025-03-01')
    expect(afterExit.every((r) => r.is_investment_day === false)).toBe(true)
    expect(afterExit.every((r) => r.shares === 0)).toBe(true)
    // Custom runs report the honest number of actual buys, not planned slots.
    expect(outcome.summary.investment_count).toBe(3)
  })

  it('never exposes the future through navs', () => {
    const seenLatest: number[] = []
    runBacktest(MONTHLY_NAV, { feeRate: 0 }, {
      decide: (s) => {
        seenLatest.push(s.navs[s.navs.length - 1])
        return {}
      },
    })
    expect(seenLatest).toEqual(MONTHLY_NAV.map((p) => p.nav))
  })
})

describe('strategy sandbox helpers', () => {
  it('ma/pctChange look strictly backwards', () => {
    const helpers = makeHelpers([1, 2, 3])
    expect(helpers.ma(2)).toBe(1.5) // (1 + 2) / 2 — today's 3 excluded
    expect(helpers.pctChange(2)).toBe(2) // 3 / 1 - 1
  })

  it('compiles both a bare body and a function declaration', () => {
    const viaBody = compileDecision('return { buy: 100 }')
    const viaFn = compileDecision('function onDay(s) { return { buy: s.nav * 2 } }')
    const state = { i: 0, date: '2025-01-01', nav: 2, navs: [2], shares: 0, invested: 0, value: 0 }
    const extra = {
      helpers: makeHelpers([2]),
      args: { initial_amount: 0, fee_rate: 0.0015 },
      returnRate: () => 0,
    }
    expect(viaBody({ ...state, ...extra })).toEqual({ buy: 100 })
    expect(viaFn({ ...state, ...extra })).toEqual({ buy: 4 })
  })

  it('rejects empty and oversized code', () => {
    expect(() => compileDecision('   ')).toThrow(StrategyCodeError)
    expect(() => compileDecision('x'.repeat(9000))).toThrow(/过长/)
  })

  it('tags runtime errors with the offending date', () => {
    const decide = makeDecision("if (s.date === '2025-03-01') throw new Error('boom'); return {}")
    const base = { i: 0, date: '2025-01-01', nav: 1, navs: [1], shares: 0, invested: 0, value: 0 }
    expect(decide(base)).toEqual({ buy: 0, sellAll: false })
    expect(() => decide({ ...base, date: '2025-03-01' })).toThrow(/2025-03-01.*boom/)
  })

  it('rejects a non-numeric buy', () => {
    const decide = makeDecision('return { buy: -5 }')
    expect(() => decide({ i: 0, date: '2025-01-01', nav: 1, navs: [1], shares: 0, invested: 0, value: 0 })).toThrow(/buy/)
  })
})

describe('handleRunStrategyRequest', () => {
  const spec = { period: 'monthly' as const, feeRate: 0 }

  it('runs a valid strategy and returns a result payload', () => {
    const response = handleRunStrategyRequest({
      nav: MONTHLY_NAV,
      spec,
      code: 'return s.date.endsWith("-01") ? { buy: 1000 } : {}',
    })
    expect(response.ok).toBe(true)
    if (response.ok) expect(response.result.summary.total_invested).toBe(6000)
  })

  it('returns a date-tagged error for code that throws mid-run', () => {
    const response = handleRunStrategyRequest({
      nav: MONTHLY_NAV,
      spec,
      code: "if (s.date === '2025-04-01') throw new Error('nope'); return { buy: 1000 }",
    })
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error).toContain('2025-04-01')
  })

  it('returns an error for empty code instead of throwing', () => {
    const response = handleRunStrategyRequest({ nav: MONTHLY_NAV, spec, code: '' })
    expect(response).toEqual({ ok: false, error: '策略代码为空' })
  })
})
