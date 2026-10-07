import { describe, it, expect } from 'vitest'
import { check4433Rule, computeScreeningRanks } from '@gofund/core/screeningEnrich'

describe('check4433Rule', () => {
  it('passes when all ranks are within thresholds', () => {
    expect(check4433Rule({
      rank_pct_1y: 10,
      rank_pct_2y: 15,
      rank_pct_3y: 20,
      rank_pct_6m: 25,
      rank_pct_3m: 30,
    })).toBe(true)
  })

  it('passes when only 2y is within threshold (3y missing)', () => {
    expect(check4433Rule({
      rank_pct_1y: 20,
      rank_pct_2y: 25,
      rank_pct_3y: null,
      rank_pct_6m: 30,
      rank_pct_3m: 15,
    })).toBe(true)
  })

  it('passes when only 3y is within threshold (2y missing)', () => {
    expect(check4433Rule({
      rank_pct_1y: 5,
      rank_pct_2y: null,
      rank_pct_3y: 25,
      rank_pct_6m: 33.33,
      rank_pct_3m: 20,
    })).toBe(true)
  })

  it('fails when 1y rank is missing', () => {
    expect(check4433Rule({
      rank_pct_1y: null,
      rank_pct_2y: 10,
      rank_pct_3y: 10,
      rank_pct_6m: 10,
      rank_pct_3m: 10,
    })).toBe(false)
  })

  it('fails when 1y rank exceeds 25', () => {
    expect(check4433Rule({
      rank_pct_1y: 30,
      rank_pct_2y: 10,
      rank_pct_3y: 10,
      rank_pct_6m: 10,
      rank_pct_3m: 10,
    })).toBe(false)
  })

  it('fails when 1y rank is exactly at boundary (25 is OK)', () => {
    expect(check4433Rule({
      rank_pct_1y: 25,
      rank_pct_2y: 20,
      rank_pct_3y: 20,
      rank_pct_6m: 30,
      rank_pct_3m: 30,
    })).toBe(true)
  })

  it('fails when both 2y and 3y are missing', () => {
    expect(check4433Rule({
      rank_pct_1y: 10,
      rank_pct_2y: null,
      rank_pct_3y: null,
      rank_pct_6m: 20,
      rank_pct_3m: 20,
    })).toBe(false)
  })

  it('fails when 6m rank exceeds 33.33', () => {
    expect(check4433Rule({
      rank_pct_1y: 10,
      rank_pct_2y: 20,
      rank_pct_3y: 20,
      rank_pct_6m: 40,
      rank_pct_3m: 20,
    })).toBe(false)
  })

  it('fails when 3m rank exceeds 33.33', () => {
    expect(check4433Rule({
      rank_pct_1y: 10,
      rank_pct_2y: 20,
      rank_pct_3y: 20,
      rank_pct_6m: 30,
      rank_pct_3m: 35,
    })).toBe(false)
  })

  it('fails when 6m rank is missing', () => {
    expect(check4433Rule({
      rank_pct_1y: 10,
      rank_pct_2y: 20,
      rank_pct_3y: 20,
      rank_pct_6m: null,
      rank_pct_3m: 20,
    })).toBe(false)
  })

  it('fails when 3m rank is missing', () => {
    expect(check4433Rule({
      rank_pct_1y: 10,
      rank_pct_2y: 20,
      rank_pct_3y: null,
      rank_pct_6m: 20,
      rank_pct_3m: null,
    })).toBe(false)
  })

  it('passes with exactly boundary 6m and 3m values', () => {
    expect(check4433Rule({
      rank_pct_1y: 25,
      rank_pct_2y: 25,
      rank_pct_3y: null,
      rank_pct_6m: 33.33,
      rank_pct_3m: 33.33,
    })).toBe(true)
  })
})

describe('computeScreeningRanks', () => {
  const row = (fund_type: string | null, returns: Record<string, number | null>) => ({
    fund_type,
    return_1m: returns['1m'] ?? null,
    return_3m: returns['3m'] ?? null,
    return_6m: returns['6m'] ?? null,
    return_1y: returns['1y'] ?? null,
    return_2y: returns['2y'] ?? null,
    return_3y: returns['3y'] ?? null,
    rank_pct_1m: null,
    rank_pct_3m: null,
    rank_pct_6m: null,
    rank_pct_1y: null,
    rank_pct_2y: null,
    rank_pct_3y: null,
    pass_4433: -1,
  })

  it('ranks within the same fund_type by return percentile', () => {
    const rows = [
      row('混合型', { '1y': 30 }),
      row('混合型', { '1y': 20 }),
      row('混合型', { '1y': 10 }),
    ]
    computeScreeningRanks(rows)
    expect(rows[0].rank_pct_1y).toBe(0)
    expect(rows[1].rank_pct_1y).toBeCloseTo(33.333, 2)
    expect(rows[2].rank_pct_1y).toBeCloseTo(66.667, 2)
    expect(rows.every((r) => r.pass_4433 === 0)).toBe(true) // 缺 2y/3y/3m/6m
  })

  it('keeps different fund_type groups independent', () => {
    const rows = [
      row('混合型', { '1y': 100 }),
      row('混合型', { '1y': 50 }),
      row('混合型', { '1y': 10 }),
      row('债券型', { '1y': 3 }),
      row('债券型', { '1y': 2 }),
      row('债券型', { '1y': 1 }),
    ]
    computeScreeningRanks(rows)
    // 两个组的百分位各自从 0 开始算，互不影响
    expect(rows[0].rank_pct_1y).toBe(0)
    expect(rows[2].rank_pct_1y).toBeCloseTo(66.667, 2)
    expect(rows[3].rank_pct_1y).toBe(0)
    expect(rows[5].rank_pct_1y).toBeCloseTo(66.667, 2)
  })

  it('nulls every rank when the group is smaller than 3', () => {
    const rows = [row(null, { '1y': 10 }), row(null, { '1y': 5 })]
    computeScreeningRanks(rows)
    expect(rows.every((r) => r.rank_pct_1y === null && r.pass_4433 === 0)).toBe(true)
  })

  it('skips a period whose sample is smaller than 3 (rank stays null)', () => {
    const rows = [
      row('混合型', { '1y': 30, '2y': 20, '3y': 20, '3m': 5, '6m': 5 }),
      row('混合型', { '1y': 20, '2y': 20, '3y': 20, '3m': 4 }),
      row('混合型', { '1y': 10, '2y': 20, '3y': 20, '3m': 3 }),
    ]
    computeScreeningRanks(rows)
    expect(rows.every((r) => r.rank_pct_6m === null)).toBe(true)
    expect(rows.every((r) => r.rank_pct_3m !== null)).toBe(true)
  })

  it('marks pass_4433 = 1 only for the qualifying rows', () => {
    const rows = [
      row('混合型', { '1y': 40, '2y': 40, '3m': 40, '6m': 40 }),
      row('混合型', { '1y': 30, '2y': 30, '3m': 30, '6m': 30 }),
      row('混合型', { '1y': 20, '2y': 20, '3m': 20, '6m': 20 }),
      row('混合型', { '1y': 10, '2y': 10, '3m': 10, '6m': 10 }),
    ]
    computeScreeningRanks(rows)
    // 4 只 → 百分位 0 / 25 / 50 / 75；只有 rank_pct_1y ≤ 25 的两只可能通过
    expect(rows.map((r) => r.pass_4433)).toEqual([1, 1, 0, 0])
  })
})
