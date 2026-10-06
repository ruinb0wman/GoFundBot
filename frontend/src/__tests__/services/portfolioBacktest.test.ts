import { describe, expect, it } from 'vitest'
import { pickScheduleDates, runPortfolioBacktest } from '../../services/backtest/portfolioBacktest'
import { samplePortfolioBacktest } from '../../services/backtest/portfolioSample'
import { isPortfolioResult, type NavPoint, type PortfolioHooks, type PortfolioSpec } from '../../services/backtest/backtestTypes'

function series(dates: string[], navs: number[]): NavPoint[] {
  return navs.map((nav, i) => ({ date: dates[i], nav }))
}

const JAN_FEB = ['2020-01-01', '2020-02-01']
const JAN_FEB_MAR = ['2020-01-01', '2020-02-01', '2020-03-01']

function run(spec: PortfolioSpec, navByCode: Record<string, NavPoint[]>, hooks?: PortfolioHooks) {
  const result = runPortfolioBacktest(spec, { navByCode, hooks })
  if (!isPortfolioResult(result)) throw new Error(result.error)
  return result
}

describe('runPortfolioBacktest', () => {
  it('equal-weight lump sum with no fees tracks the weighted return', () => {
    const result = run(
      { assets: [{ fundCode: 'A', weight: 1 }, { fundCode: 'B', weight: 1 }], initialAmount: 1000, feeRate: 0 },
      { A: series(['2020-01-01', '2020-01-02'], [1, 2]), B: series(['2020-01-01', '2020-01-02'], [2, 1]) },
    )
    // A: 500 shares × 2 = 1000, B: 250 shares × 1 = 250 → 1250
    expect(result.summary.total_invested).toBe(1000)
    expect(result.summary.final_value).toBe(1250)
    expect(result.summary.return_rate).toBe(25)
    expect(result.effective_start).toBe('2020-01-01')
    expect(result.effective_end).toBe('2020-01-02')
  })

  it('restores target weights on the calendar rebalance date', () => {
    const result = run(
      {
        assets: [{ fundCode: 'A', weight: 50 }, { fundCode: 'B', weight: 50 }],
        initialAmount: 1000,
        feeRate: 0,
        rebalance: { frequency: 'monthly' },
      },
      { A: series(JAN_FEB_MAR, [1, 2, 2]), B: series(JAN_FEB_MAR, [2, 1, 1]) },
    )
    // Day 2 drifts to 80/20 then rebalances back to 50/50; day 1/3 are no-ops.
    expect(result.summary.rebalance_count).toBe(1)
    expect(result.summary.final_value).toBe(1250)
    expect(result.assets.map((a) => a.finalWeight)).toEqual([50, 50])
  })

  it('rebalances when the weight deviates past the threshold', () => {
    const result = run(
      {
        assets: [{ fundCode: 'A', weight: 1 }, { fundCode: 'B', weight: 1 }],
        initialAmount: 1000,
        feeRate: 0,
        rebalance: { frequency: 'none', threshold: 0.05 },
      },
      { A: series(['2020-01-01', '2020-01-02', '2020-01-03'], [1, 3, 3]), B: series(['2020-01-01', '2020-01-02', '2020-01-03'], [1, 1, 1]) },
    )
    // Day 2: A 75% / B 25% > 5pp breach → rebalance to 1000/1000.
    expect(result.summary.rebalance_count).toBe(1)
    expect(result.assets.map((a) => a.finalWeight)).toEqual([50, 50])
  })

  it('allocates contributions to the most underweight leg', () => {
    const result = run(
      {
        assets: [{ fundCode: 'A', weight: 1 }, { fundCode: 'B', weight: 1 }],
        initialAmount: 1000,
        feeRate: 0,
        contribution: { amount: 1000, period: 'monthly' },
      },
      { A: series(JAN_FEB, [1, 2]), B: series(JAN_FEB, [2, 2]) },
    )
    expect(result.summary.total_invested).toBe(3000)
    expect(result.summary.contribution_count).toBe(2)
    const [a, b] = result.assets
    expect(a.contributed).toBe(1000)
    // B received the Feb top-up (it was the lagging leg after A doubled).
    expect(b.contributed).toBe(2000)
    expect(a.finalValue).toBe(2000)
    expect(b.finalValue).toBe(2000)
  })

  it('starts at the latest inception so every leg has data', () => {
    const result = run(
      { assets: [{ fundCode: 'A', weight: 1 }, { fundCode: 'B', weight: 1 }], initialAmount: 1000, feeRate: 0 },
      {
        A: series(['2020-01-01', '2020-02-01', '2020-03-01'], [1, 1, 1]),
        B: series(['2020-02-01', '2020-03-01'], [1, 1]),
      },
    )
    expect(result.effective_start).toBe('2020-02-01')
    expect(result.timeline[0].date).toBe('2020-02-01')
  })

  it('compounds a synthetic cash leg at its annual rate', () => {
    const result = run(
      {
        assets: [{ fundCode: 'A', weight: 1 }, { kind: 'cash', annualRate: 0.1, weight: 1 }],
        initialAmount: 1000,
        feeRate: 0,
      },
      { A: series(['2020-01-01', '2021-01-01'], [1, 1]) },
    )
    const cash = result.assets[1]
    expect(cash.kind).toBe('cash')
    expect(cash.finalValue).toBeGreaterThan(545)
    expect(cash.finalValue).toBeLessThan(555)
  })

  it('charges the fee on every buy', () => {
    const result = run(
      { assets: [{ fundCode: 'A', weight: 1 }, { fundCode: 'B', weight: 1 }], initialAmount: 1000, feeRate: 0.01 },
      { A: series(['2020-01-01', '2020-01-02'], [1, 1]), B: series(['2020-01-01', '2020-01-02'], [1, 1]) },
    )
    expect(result.summary.final_value).toBe(990)
  })

  it('runs with a single asset (code strategies are not forced to be a portfolio)', () => {
    const result = runPortfolioBacktest(
      { assets: [{ fundCode: 'A', weight: 1 }, { fundCode: 'MISSING', weight: 1 }], initialAmount: 1000 },
      { navByCode: { A: series(['2020-01-01', '2020-01-02'], [1, 1]) } },
    )
    expect(isPortfolioResult(result)).toBe(true)
    if (isPortfolioResult(result)) {
      expect(result.assets).toHaveLength(1)
      expect(result.excluded.map((e) => e.code)).toContain('MISSING')
    }
  })

  it('fails when no fund has data', () => {
    const result = runPortfolioBacktest(
      { assets: [{ fundCode: 'MISSING', weight: 1 }], initialAmount: 1000 },
      { navByCode: {} },
    )
    expect(isPortfolioResult(result)).toBe(false)
    if (!isPortfolioResult(result)) {
      expect(result.error).toContain('至少需要 1 个')
      expect(result.error).toContain('MISSING')
    }
  })

  it('excludes funds without data but keeps the rest', () => {
    const result = run(
      {
        assets: [
          { fundCode: 'A', weight: 1 },
          { fundCode: 'B', weight: 1 },
          { fundCode: 'MISSING', weight: 1 },
        ],
        initialAmount: 900,
        feeRate: 0,
      },
      { A: series(['2020-01-01', '2020-01-02'], [1, 1]), B: series(['2020-01-01', '2020-01-02'], [1, 1]) },
    )
    expect(result.excluded).toEqual([{ code: 'MISSING', reason: '未获取到净值数据' }])
    expect(result.assets.map((a) => a.targetWeight)).toEqual([50, 50])
    expect(result.summary.final_value).toBe(900)
  })

  it('samples the timeline to a compact payload', () => {
    const dates = Array.from({ length: 40 }, (_, i) => `2020-01-${String(i + 1).padStart(2, '0')}`)
    const spec: PortfolioSpec = { assets: [{ fundCode: 'A', weight: 1 }, { fundCode: 'B', weight: 1 }], initialAmount: 1000, feeRate: 0 }
    const result = run(spec, {
      A: series(dates, dates.map((_, i) => 1 + i / 100)),
      B: series(dates, dates.map((_, i) => 1 + i / 200)),
    })
    const sampled = samplePortfolioBacktest(result, spec)
    expect(sampled.checkpoints.length).toBeLessThanOrEqual(16)
    expect(sampled.checkpoints_omitted).toBe(40 - sampled.checkpoints.length)
    expect(sampled.spec).toContain('A 1')
  })
})

describe('pickScheduleDates', () => {  it('picks the first trading day of each quarterly and yearly bucket', () => {
    const dates = ['2020-01-02', '2020-04-01', '2020-07-01', '2020-10-08', '2021-01-04']
    expect(pickScheduleDates(dates, 'quarterly')).toEqual(['2020-01-02', '2020-04-01', '2020-07-01', '2020-10-08', '2021-01-04'])
    expect(pickScheduleDates(dates, 'yearly')).toEqual(['2020-01-02', '2021-01-04'])
    expect(pickScheduleDates(dates, 'none')).toEqual([])
  })

  it('honours the monthly day with the last trading day as fallback', () => {
    expect(pickScheduleDates(['2020-01-05', '2020-01-20', '2020-02-10'], 'monthly', 15)).toEqual(['2020-01-20', '2020-02-10'])
  })
})

describe('runPortfolioBacktest custom hooks', () => {
  const AB = {
    A: series(JAN_FEB_MAR, [1, 3, 3]),
    B: series(JAN_FEB_MAR, [1, 1, 1]),
  }

  it('injects external money through buy and counts it as invested', () => {
    const result = run(
      { assets: [{ fundCode: 'A', weight: 1 }, { fundCode: 'B', weight: 1 }], feeRate: 0 },
      AB,
      { decide: (s) => (s.i === 0 ? { buy: [{ asset: 0, amount: 1000 }] } : {}) },
    )
    expect(result.summary.total_invested).toBe(1000)
    expect(result.summary.final_value).toBe(3000) // 1000 元 @1 → 1000 份 @3
    expect(result.summary.buy_count).toBe(1)
    expect(result.summary.contribution_count).toBe(0)
  })

  it('rebalances positions to the requested weights on the requested day', () => {
    const result = run(
      { assets: [{ fundCode: 'A', weight: 50 }, { fundCode: 'B', weight: 50 }], initialAmount: 1000, feeRate: 0 },
      AB,
      { decide: (s) => (s.i === 1 ? { rebalance: [0.5, 0.5] } : {}) },
    )
    expect(result.summary.rebalance_count).toBe(1)
    expect(result.assets.map((a) => a.finalWeight)).toEqual([50, 50])
  })

  it('parks a partial sell as uninvested cash instead of losing it', () => {
    const result = run(
      { assets: [{ fundCode: 'A', weight: 50 }, { fundCode: 'B', weight: 50 }], initialAmount: 1000, feeRate: 0 },
      { A: series(JAN_FEB_MAR, [1, 1, 1]), B: series(JAN_FEB_MAR, [1, 1, 1]) },
      { decide: (s) => (s.i === 1 ? { sell: [{ asset: 0, amount: 500 }] } : {}) },
    )
    // A fully sold (500), B unchanged (500), the 500 proceeds sit in cash.
    expect(result.summary.final_value).toBe(1000)
    const cashRow = result.assets.find((a) => a.code === 'cash_balance')
    expect(cashRow?.finalValue).toBe(500)
    expect(result.assets.find((a) => a.code === 'A')?.finalValue).toBe(0)
    // Per-leg return is the leg's own NAV change, not value/contributed — otherwise
    // rebalancing/sells would make a flat leg look like a -100% loser.
    expect(result.assets.find((a) => a.code === 'A')?.return_rate).toBe(0)
  })

  it('honours sellAll, tags exit_reason=custom and freezes the portfolio', () => {
    const result = run(
      { assets: [{ fundCode: 'A', weight: 50 }, { fundCode: 'B', weight: 50 }], initialAmount: 1000, feeRate: 0 },
      AB,
      { decide: (s) => (s.i === 1 ? { sellAll: true } : {}) },
    )
    expect(result.summary.exit_reason).toBe('custom')
    expect(result.summary.exit_date).toBe('2020-02-01')
    const after = result.timeline.filter((r) => r.date > '2020-02-01')
    expect(after.every((r) => r.status === 'sold')).toBe(true)
    expect(result.assets.filter((a) => a.code !== 'cash_balance').every((a) => a.finalValue === 0)).toBe(true)
  })

  it('never exposes the future through history', () => {
    const seen: string[] = []
    run(
      { assets: [{ fundCode: 'A', weight: 1 }, { fundCode: 'B', weight: 1 }], feeRate: 0 },
      AB,
      {
        decide: (s) => {
          const ok = s.history.every((series) => series.length === s.i + 1 && series[series.length - 1] === s.navs[s.history.indexOf(series)])
          seen.push(`${s.date}:${ok}`)
          return {}
        },
      },
    )
    expect(seen).toEqual(['2020-01-01:true', '2020-02-01:true', '2020-03-01:true'])
  })
})
