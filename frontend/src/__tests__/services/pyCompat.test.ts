import { describe, expect, it } from 'vitest'
import { isoWeekKey, isoWeekNumber, isoWeekYear, monthKey, pyRound } from '@gofund/core/backtest/pyCompat'
import pyroundFixture from '../../services/backtest/__fixtures__/pyround.json'
import isoweekFixture from '../../services/backtest/__fixtures__/isoweek.json'

/**
 * Oracle tests: every expectation here was produced by running the real CPython
 * implementation (see python/tests/gen_backtest_fixtures.py). Do not hand-edit.
 */

describe('pyRound — CPython round() oracle', () => {
  it('matches all generated cases including ties', () => {
    const mismatches = pyroundFixture.filter(
      (c) => !Object.is(pyRound(c.value, c.digits), c.expected),
    )
    expect(
      mismatches.map((c) => `round(${c.value}, ${c.digits}) → ${pyRound(c.value, c.digits)} (python: ${c.expected})`),
    ).toEqual([])
  })

  it('is ties-to-even, not half-up', () => {
    expect(pyRound(0.5)).toBe(0)
    expect(pyRound(1.5)).toBe(2)
    expect(pyRound(2.5)).toBe(2)
    expect(pyRound(3.5)).toBe(4)
  })

  it('rounds the exact binary value, not the scaled integer', () => {
    // 2.675 is really 2.67499999999999982236431605997495353221893310546875
    expect(pyRound(2.675, 2)).toBe(2.67)
    expect(Math.round(2.675 * 100) / 100).toBe(2.68) // the classic naive JS answer
    expect((2.675).toFixed(2)).toBe('2.67') // toFixed happens to agree here…
    expect(Number((2.5).toFixed(0))).toBe(3) // …but on ties it rounds away from zero
    expect(pyRound(2.5)).toBe(2)
  })

  it('preserves the sign of zero like CPython', () => {
    expect(Object.is(pyRound(-0.4), -0)).toBe(true)
    expect(Object.is(pyRound(-0.5), -0)).toBe(true)
    expect(Object.is(pyRound(0.4), 0)).toBe(true)
  })

  it('handles large magnitudes and subnormals without losing precision', () => {
    // 999999.995 is really 999999.9949999999…, so it rounds down at 2 digits but
    // up to 1000000 at 0/1 digits (oracle values from CPython).
    expect(pyRound(999999.995, 2)).toBe(999999.99)
    expect(pyRound(999999.995, 0)).toBe(1000000)
    expect(pyRound(99.995, 2)).toBe(100)
    expect(pyRound(Number.MIN_VALUE, 300)).toBe(0) // subnormal: 5e-324 has no digits before the 324th place
    expect(pyRound(Number.MIN_VALUE, 400)).toBe(Number.MIN_VALUE) // …but 400 places keep it
    expect(pyRound(1e-7, 0)).toBe(0)
    expect(pyRound(1234.5678, 2)).toBe(1234.57)
  })
})

describe('isoWeekKey — ISO year-week (dt.isocalendar()[:2]) oracle', () => {
  it('matches all isocalendar oracle cases', () => {
    const mismatches = isoweekFixture
      .map((c) => {
        const [y, m, d] = c.date.split('-').map(Number)
        return { date: c.date, week: isoWeekNumber(y, m, d), wantWeek: c.week, year: isoWeekYear(y, m, d), wantYear: c.year }
      })
      .filter((r) => r.week !== r.wantWeek || r.year !== r.wantYear)
    expect(mismatches).toEqual([])
  })

  it('keeps the week spanning New Year in a single bucket (the old calendar-year key split it)', () => {
    // 2025-12-29 … 2026-01-02 are all ISO 2026-W01, so one bucket → one buy.
    expect(isoWeekKey('2025-12-26')).toBe('2025-W52')
    expect(isoWeekKey('2025-12-29')).toBe('2026-W1')
    expect(isoWeekKey('2025-12-31')).toBe('2026-W1')
    expect(isoWeekKey('2026-01-01')).toBe('2026-W1')
    expect(isoWeekKey('2026-01-02')).toBe('2026-W1')
    expect(isoWeekKey('2026-01-05')).toBe('2026-W2')
  })

  it('handles 53-week ISO years and early January', () => {
    // 2020 had 53 ISO weeks; 2021-01-01 belongs to 2020-W53.
    expect(isoWeekKey('2021-01-01')).toBe('2020-W53')
    expect(isoWeekKey('2021-01-04')).toBe('2021-W1')
  })
})

describe('monthKey', () => {
  it('matches (dt.year, dt.month) bucketing', () => {
    expect(monthKey('2026-01-05')).toBe('2026-01')
    expect(monthKey('2026-12-31')).toBe('2026-12')
  })
})
