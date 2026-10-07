import { describe, expect, it, vi, beforeEach } from 'vitest'

const navMocks = vi.hoisted(() => ({ fetchNavHistory: vi.fn() }))
vi.mock('../../services/backtest/runBacktestForFund', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../services/backtest/runBacktestForFund')
  return { ...actual, fetchNavHistory: navMocks.fetchNavHistory }
})

const { MAX_FETCHES_PER_RUN, loadNav } = await import('../../services/backtest/dataBroker')

const series = (from: string, days: number) => {
  const start = Date.parse(`${from}T00:00:00Z`)
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    nav: 1 + i / 100,
  }))
}

describe('loadNav', () => {
  beforeEach(() => {
    navMocks.fetchNavHistory.mockReset()
  })

  it('clips every series to the requested window', async () => {
    navMocks.fetchNavHistory.mockResolvedValue(series('2025-01-01', 400))
    const result = await loadNav(['110022'], { start: '2025-06-01', end: '2025-06-30' })

    expect(result.fetched).toBe(1)
    expect(result.errors).toEqual({})
    const points = result.navByCode['110022']
    expect(points.length).toBe(30)
    expect(points[0].date).toBe('2025-06-01')
    expect(points[points.length - 1].date).toBe('2025-06-30')
  })

  it('de-duplicates codes and reports an empty series as an error', async () => {
    navMocks.fetchNavHistory.mockResolvedValue([])
    const result = await loadNav(['110022', '110022', ' '], { start: '2025-01-01', end: '2025-12-31' })
    expect(result.fetched).toBe(1)
    expect(result.errors['110022']).toContain('为空')
  })

  it('never throws: a failing code becomes an entry in errors', async () => {
    navMocks.fetchNavHistory.mockRejectedValue(new Error('provider down'))
    const result = await loadNav(['110022'], { start: '2025-01-01', end: '2025-12-31' })
    expect(result.navByCode['110022']).toEqual([])
    expect(result.errors['110022']).toContain('provider down')
  })

  it('stops fetching past the per-run budget', async () => {
    navMocks.fetchNavHistory.mockResolvedValue(series('2025-01-01', 10))
    const codes = Array.from({ length: MAX_FETCHES_PER_RUN + 5 }, (_, i) => `1${String(i).padStart(5, '0')}`)
    const result = await loadNav(codes, { start: '2025-01-01', end: '2025-12-31' })

    expect(result.fetched).toBe(MAX_FETCHES_PER_RUN)
    const skipped = Object.entries(result.errors).filter(([, message]) => message.includes('上限'))
    expect(skipped).toHaveLength(5)
  })
})
