import { describe, expect, it } from 'vitest'
import { sampleBacktest, describeSpec } from '../../services/backtest/timelineSample'
import { resolveDateRange, specFromToolArgs } from '../../services/backtest/toolArgs'
import { compareStrategies } from '../../services/backtest/strategyCompare'
import { normalizeSpec } from '../../services/backtest/strategyRules'
import type { BacktestResult, NavPoint } from '../../services/backtest/backtestTypes'
import { truncateJson } from '../../services/chatEngine/toolLoop'
import engineFixture from '../../services/backtest/__fixtures__/engine.json'

const fixtures = engineFixture as unknown as Array<{ name: string; output: Record<string, unknown> }>
const results = fixtures
  .filter((c) => !('error' in c.output))
  .map((c) => ({ name: c.name, result: c.output as unknown as BacktestResult }))

describe('sampleBacktest — stays inside the tool-output budget', () => {
  it('survives truncateJson() for every engine fixture (the regression that started this)', () => {
    for (const { name, result } of results) {
      const payload = sampleBacktest(result, { period: 'monthly' })
      // index.ts wraps tool results as { ok: true, data } before truncating.
      const wire = truncateJson({ ok: true, data: payload })
      expect(wire, `${name} (${wire.length} chars)`).not.toContain('truncated')
    }
  })

  it('keeps the raw timeline out of the payload but reports how much was omitted', () => {
    const biggest = results.find((r) => r.name === 'monthly_3y_basic')!
    const payload = sampleBacktest(biggest.result, { period: 'monthly' })
    expect(biggest.result.timeline.length).toBe(783)
    expect(payload.checkpoints.length).toBeLessThanOrEqual(16)
    expect(payload.checkpoints_omitted).toBe(783 - payload.checkpoints.length)
    expect(JSON.stringify(payload)).not.toContain('"shares"')
    expect(payload.note).toContain('783')
  })

  it('always keeps the first day, the last day and the exit day', () => {
    for (const { name, result } of results) {
      const payload = sampleBacktest(result, { period: 'monthly' })
      const dates = payload.checkpoints.map((c) => c.date)
      expect(dates[0], name).toBe(result.timeline[0].date)
      expect(dates[dates.length - 1], name).toBe(result.timeline[result.timeline.length - 1].date)
      const exit = result.timeline.find((r) => r.status === 'sold')
      if (exit) expect(dates, name).toContain(exit.date)
    }
  })

  it('reports the honest buy_count next to Python-parity investment_count', () => {
    const stoppedOut = results.find((r) => r.name === 'monthly_stop_loss_exit')!
    const payload = sampleBacktest(stoppedOut.result, { period: 'monthly' })
    expect(payload.summary.investment_count).toBe(3) // scheduled slots (UI parity)
    expect(payload.summary.buy_count).toBe(1) // actually executed
    expect(payload.note).toContain('实际买入 1 次')
  })
})

describe('describeSpec', () => {
  it('renders the units a user expects', () => {
    expect(describeSpec(normalizeSpec({ period: 'monthly', day: 15, amount: 2000, feeRate: 0.0015 }))).toContain('每月 15 号投入 2000 元')
    expect(describeSpec(normalizeSpec({ period: 'weekly', day: 2, feeRate: 0 }))).toContain('每周三')
    expect(describeSpec(normalizeSpec({ period: 'lump_sum', amount: 10000, takeProfitRate: 0.2, feeRate: 0.0015 }))).toContain('止盈 20.00%')
    expect(describeSpec(normalizeSpec({ period: 'monthly', rule: { type: 'ma_deviation', window: 250, factor: 0.5 } }))).toContain('250 日均线')
  })
})

describe('resolveDateRange / specFromToolArgs', () => {
  const now = new Date('2026-09-29T12:00:00Z')

  it('defaults to the same three-year window as the backtest page', () => {
    expect(resolveDateRange({}, now)).toEqual({ startDate: '2023-09-29', endDate: '2026-09-29' })
    expect(resolveDateRange({ start_date: '2024-01-01' }, now).startDate).toBe('2024-01-01')
  })

  it('treats rates as fractions, like /api/backtest always documented', () => {
    const spec = specFromToolArgs({ take_profit_rate: 0.2, stop_loss_rate: 0.1, fee_rate: 0.0015 })
    expect(spec.takeProfitRate).toBe(0.2)
    expect(spec.stopLossRate).toBe(0.1)
    expect(spec.feeRate).toBe(0.0015)
    expect(spec.period).toBe('monthly')
    expect(spec.rule).toEqual({ type: 'fixed' })
  })

  it('maps the DCA rule names the tool schema advertises', () => {
    expect(specFromToolArgs({ dca_rule: 'value_averaging', target_growth: 0.02 }).rule).toEqual({
      type: 'value_averaging',
      targetGrowth: 0.02,
    })
    expect(specFromToolArgs({ dca_rule: 'ma_deviation' }).rule).toEqual({ type: 'ma_deviation', window: 250, factor: 0.5 })
    expect(specFromToolArgs({ investment_type: 'daily' }).period).toBe('daily')
  })
})

describe('compareStrategies — the contract FundBacktest.vue reads', () => {
  const nav: NavPoint[] = Array.from({ length: 780 }, (_, i) => {
    const day = new Date(Date.UTC(2023, 0, 2) + i * 86_400_000)
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) return null
    return { date: day.toISOString().slice(0, 10), nav: Number((1 + Math.sin(i / 40) * 0.15 + i * 0.0002).toFixed(4)) }
  }).filter((p): p is NavPoint => p !== null)

  it('returns recommended + strategies with every field the UI renders', () => {
    const comparison = compareStrategies(nav, { amount: 1000 })
    if ('error' in comparison) throw new Error(comparison.error)

    for (const field of ['key', 'name', 'description', 'reason'] as const) {
      expect(comparison.recommended[field], field).toBeTruthy()
    }
    for (const field of ['annual_return', 'return_rate', 'max_drawdown', 'sharpe_ratio'] as const) {
      expect(typeof comparison.recommended.summary[field], field).toBe('number')
    }
    expect(comparison.strategies.length).toBeGreaterThan(1)
    for (const entry of comparison.strategies) {
      expect(entry.key).toBeTruthy()
      expect(entry.name).toBeTruthy()
      expect(typeof entry.summary.return_rate).toBe('number')
      expect(typeof entry.summary.sharpe_ratio).toBe('number')
    }
    // Ranked by Sharpe, and the reason warns that capital differs per strategy.
    const sharpes = comparison.strategies.map((s) => s.summary.sharpe_ratio)
    expect([...sharpes].sort((a, b) => b - a)).toEqual(sharpes)
    expect(comparison.recommended.reason).toContain('夏普')
  })

  it('fails gracefully when there is no usable NAV history', () => {
    const comparison = compareStrategies([], {})
    expect('error' in comparison).toBe(true)
  })

  it('names the compared range in the reason (the window must match the page)', () => {
    const comparison = compareStrategies(nav, { amount: 1000 }, { range: '2023-09-30 ~ 2026-09-29' })
    if ('error' in comparison) throw new Error(comparison.error)
    expect(comparison.recommended.reason).toContain('回测区间 2023-09-30 ~ 2026-09-29')
    expect(comparison.recommended.reason).toContain('各方案投入本金不同')
  })
})
