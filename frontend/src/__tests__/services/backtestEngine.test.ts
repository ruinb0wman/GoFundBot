import { describe, expect, it } from 'vitest'
import { runBacktest } from '../../services/backtest/backtestEngine'
import { isBacktestResult, type BacktestSpec, type NavPoint } from '../../services/backtest/backtestTypes'
import engineFixture from '../../services/backtest/__fixtures__/engine.json'

/**
 * Golden tests: every expectation was produced by the real Python implementation
 * (python/tests/gen_backtest_fixtures.py). If one of these fails, the TS engine has
 * drifted from the numbers the UI has always shown.
 */

interface FixtureCase {
  name: string
  input: {
    navHistory: NavPoint[]
    investmentType: string
    amount?: number
    initialAmount?: number
    feeRate?: number
    takeProfitRate?: number | null
    stopLossRate?: number | null
  }
  output: Record<string, unknown>
}

const cases = engineFixture as unknown as FixtureCase[]

function specFrom(input: FixtureCase['input']): BacktestSpec {
  return {
    period: input.investmentType as BacktestSpec['period'],
    amount: input.amount,
    initialAmount: input.initialAmount,
    feeRate: input.feeRate,
    takeProfitRate: input.takeProfitRate ?? null,
    stopLossRate: input.stopLossRate ?? null,
  }
}

describe('runBacktest — Python parity (golden fixtures)', () => {
  it('covers all fixture cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(12)
  })

  for (const testCase of cases) {
    it(`reproduces ${testCase.name}`, () => {
      const actual = runBacktest(testCase.input.navHistory, specFrom(testCase.input))
      expect(actual).toEqual(testCase.output)
    })
  }

  it('agrees on max_drawdown sign for a flat series (no -0 leakage)', () => {
    const flat: NavPoint[] = [
      { date: '2026-01-05', nav: 1 },
      { date: '2026-02-05', nav: 1 },
    ]
    const actual = runBacktest(flat, { period: 'monthly', amount: 1000, feeRate: 0 })
    if (!isBacktestResult(actual)) throw new Error('expected a result')
    expect(Object.is(actual.summary.max_drawdown, 0)).toBe(true)
  })

  it('keeps Python\'s investment_count semantics: scheduled slots, not actual buys', () => {
    // monthly_stop_loss_exit sells out on 2024-01-03 after a single buy, yet Python
    // reports 3 because three monthly slots were *scheduled*. The honest count is
    // derived from the timeline in timelineSample.ts (buy_count !== investment_count).
    const testCase = cases.find((c) => c.name === 'monthly_stop_loss_exit')
    if (!testCase) throw new Error('fixture missing')
    const actual = runBacktest(testCase.input.navHistory, specFrom(testCase.input))
    if (!isBacktestResult(actual)) throw new Error('expected a result')
    expect(actual.summary.investment_count).toBe(3)
    expect(actual.timeline.filter((r) => r.is_investment_day)).toHaveLength(1)
  })
})

describe('runBacktest — error contract', () => {
  it('distinguishes "no history" from "no valid points" like Python', () => {
    expect(runBacktest([], {})).toEqual({ error: 'No NAV history provided' })
    expect(runBacktest(undefined, {})).toEqual({ error: 'No NAV history provided' })
    expect(runBacktest([{ date: '2026-01-05', nav: 0 }], {})).toEqual({ error: 'No valid NAV data points' })
  })

  it('cannot be confused with a result', () => {
    expect(isBacktestResult(runBacktest([], {}))).toBe(false)
  })
})

describe('pickInvestmentDates via runBacktest — day semantics', () => {
  const dates = {
    jan: ['2026-01-05', '2026-01-06', '2026-01-15', '2026-01-16', '2026-01-30'],
    febBefore15: ['2026-02-02', '2026-02-10'],
    mar: ['2026-03-16', '2026-03-20'],
  }
  const series: NavPoint[] = [...dates.jan, ...dates.febBefore15, ...dates.mar].map((date) => ({ date, nav: 1 }))

  const buyDates = (spec: BacktestSpec) => {
    const result = runBacktest(series, { feeRate: 0, amount: 1000, ...spec })
    if (!isBacktestResult(result)) throw new Error('expected a result')
    return result.timeline.filter((r) => r.is_investment_day).map((r) => r.date)
  }

  it('defaults to the first trading day of the period (Python behaviour)', () => {
    expect(buyDates({ period: 'monthly' })).toEqual(['2026-01-05', '2026-02-02', '2026-03-16'])
  })

  it('picks the first trading day on/after `day`', () => {
    expect(buyDates({ period: 'monthly', day: 15 })).toEqual(['2026-01-15', '2026-02-10', '2026-03-16'])
  })

  it('falls back to the last trading day of the period when nothing reaches `day`', () => {
    // February has no trading day on/after the 15th in this series → 02-10 (last of the month).
    expect(buyDates({ period: 'monthly', day: 15 })[1]).toBe('2026-02-10')
  })

  it('keeps the week spanning New Year in one bucket (one buy, not two)', () => {
    // ISO 2026-W01 covers 2025-12-29 … 2026-01-02; the old (calendar-year, ISO-week)
    // key split it at the year rollover and invested twice.
    const series: NavPoint[] = [
      '2025-12-26', '2025-12-29', '2025-12-30', '2025-12-31',
      '2026-01-01', '2026-01-02', '2026-01-05', '2026-01-06',
    ].map((date) => ({ date, nav: 1 }))
    const result = runBacktest(series, { period: 'weekly', amount: 1000, feeRate: 0 })
    if (!isBacktestResult(result)) throw new Error('expected a result')
    expect(result.timeline.filter((r) => r.is_investment_day).map((r) => r.date)).toEqual([
      '2025-12-26',
      '2025-12-29',
      '2026-01-05',
    ])
    expect(result.summary.total_invested).toBe(3000)
  })

  it('supports weekly weekdays (0 = Monday)', () => {
    const weekly: NavPoint[] = [
      { date: '2026-01-05', nav: 1 }, // Mon
      { date: '2026-01-07', nav: 1 }, // Wed
      { date: '2026-01-09', nav: 1 }, // Fri
      { date: '2026-01-12', nav: 1 }, // Mon (next week)
      { date: '2026-01-13', nav: 1 }, // Tue — no Wednesday in this week
    ]
    const result = runBacktest(weekly, { period: 'weekly', day: 2, feeRate: 0 })
    if (!isBacktestResult(result)) throw new Error('expected a result')
    expect(result.timeline.filter((r) => r.is_investment_day).map((r) => r.date)).toEqual([
      '2026-01-07',
      '2026-01-13', // fallback: last trading day of that week
    ])
  })
})

describe('runBacktest — declarative DCA rules', () => {
  it('value_averaging tops up to the geometric target and never sells', () => {
    const series: NavPoint[] = [
      { date: '2026-01-05', nav: 1 },
      { date: '2026-02-05', nav: 1.5 },
      { date: '2026-03-05', nav: 3 },
    ]
    const result = runBacktest(series, {
      period: 'monthly',
      amount: 1000,
      feeRate: 0,
      rule: { type: 'value_averaging', targetGrowth: 0 },
    })
    if (!isBacktestResult(result)) throw new Error('expected a result')
    // target(n) = 1000n: buy 1000, then top up 500, then nothing (market ran past the target).
    expect(result.timeline.map((r) => r.is_investment_day)).toEqual([true, true, false])
    expect(result.summary.total_invested).toBe(1500)
    // investment_count stays "scheduled slots" (Python semantics); 2 of them actually bought.
    expect(result.summary.investment_count).toBe(3)
    expect(result.timeline.filter((r) => r.is_investment_day)).toHaveLength(2)
  })

  it('ma_deviation buys more when the NAV is below its moving average', () => {
    const series: NavPoint[] = [
      { date: '2026-01-05', nav: 2 },
      { date: '2026-01-20', nav: 1 },
      { date: '2026-02-05', nav: 1 },
    ]
    const result = runBacktest(series, {
      period: 'monthly',
      amount: 1000,
      feeRate: 0,
      rule: { type: 'ma_deviation', window: 2, factor: 0.5 },
    })
    if (!isBacktestResult(result)) throw new Error('expected a result')
    // Slot 1: no history → 1000. Slot 2: MA(2.0, 1.0) = 1.5 vs nav 1.0 → ×1.5 (clamped) → 1500.
    expect(result.timeline.filter((r) => r.is_investment_day).map((r) => r.invested)).toEqual([1000, 2500])
    expect(result.summary.final_value).toBe(2000)
  })
})
