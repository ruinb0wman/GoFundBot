import { describe, it, expect } from 'vitest'
import { check4433Rule } from '../../composables/useScreeningDb'

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
