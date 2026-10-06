import { describe, expect, it } from 'vitest'
import { isFresh, NAV_TTL_MS } from '../../services/backtest/dataBroker'

const TODAY = '2026-10-06'
const entry = (over: Partial<{ firstDate: string; fetchedThrough: string; updatedAt: number }> = {}) => ({
  firstDate: '2012-05-03',
  fetchedThrough: TODAY,
  updatedAt: Date.now(),
  ...over,
})

describe('isFresh', () => {
  it('hits a recently fetched window ending today', () => {
    expect(isFresh(entry(), { start: '2023-10-06', end: TODAY }, TODAY)).toBe(true)
  })

  it('hits a window that ends before the last fetch, even if the entry is old', () => {
    expect(
      isFresh(entry({ fetchedThrough: '2026-06-01', updatedAt: 0 }), { start: '2020-01-01', end: '2025-01-01' }, TODAY),
    ).toBe(true)
  })

  it('misses when the entry is older than the TTL and the window reaches today', () => {
    expect(isFresh(entry({ updatedAt: Date.now() - NAV_TTL_MS - 1000 }), { start: '2023-10-06', end: TODAY }, TODAY)).toBe(false)
  })

  it('hits a fund younger than the window (full history is all that exists)', () => {
    expect(isFresh(entry({ firstDate: '2024-01-01' }), { start: '2023-10-06', end: TODAY }, TODAY)).toBe(true)
  })

  it('misses when we never fetched through the requested end', () => {
    expect(isFresh(entry({ fetchedThrough: '2026-09-01' }), { start: '2023-10-06', end: TODAY }, TODAY)).toBe(false)
  })

  it('treats a legacy entry without the marker as stale', () => {
    expect(isFresh({ ...entry(), fetchedThrough: '' }, { start: '2023-10-06', end: TODAY }, TODAY)).toBe(false)
  })

  it('clamps a future end to today (a cache through today covers it)', () => {
    expect(isFresh(entry(), { start: '2023-10-06', end: '2030-01-01' }, TODAY)).toBe(true)
  })
})
