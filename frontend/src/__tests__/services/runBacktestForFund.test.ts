import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * The API module is mocked with a plain function driven by `behavior` rather than a
 * `vi.fn()`: Vitest 4 reports any error thrown inside a mock implementation as a test
 * failure even when the code under test catches it, which would make the error-path
 * test impossible to write.
 */
const calls: unknown[][] = []
let behavior: 'nav' | 'shapeless' | 'throw' = 'nav'
let items: unknown[] = []

vi.mock('../../services/api', () => ({
  default: {
    get: (...args: unknown[]) => {
      calls.push(args)
      if (behavior === 'throw') throw new Error('boom')
      if (behavior === 'shapeless') return Promise.resolve({ data: { success: true, data: null } })
      return Promise.resolve({ data: { success: true, data: { items } } })
    },
  },
}))

const { fetchNavHistory, backtestFund, clipNavHistory } = await import('../../services/backtest/runBacktestForFund')

const NAV = [
  { date: '2024-01-02', nav: 1.0 },
  { date: '2024-02-01', nav: 1.1 },
  { date: '2024-03-01', nav: 0.9 },
  { date: '2024-04-01', nav: 1.05 },
]

beforeEach(() => {
  calls.length = 0
  behavior = 'nav'
  items = NAV
})

describe('fetchNavHistory', () => {
  it('unwraps the service envelope and normalizes values', async () => {
    items = [...NAV, { date: '2024-05-06T00:00:00.000Z', nav: '1.2345' }, { date: '', nav: 9 }]
    expect(await fetchNavHistory('110022', '2024-01-01', '2024-05-31')).toEqual([
      ...NAV,
      { date: '2024-05-06', nav: 1.2345 },
    ])
    expect(calls).toEqual([['/funds/110022/nav-history', { params: { startDate: '2024-01-01', endDate: '2024-05-31' } }]])
  })

  it('returns an empty array instead of throwing on a shapeless response', async () => {
    behavior = 'shapeless'
    await expect(fetchNavHistory('110022')).resolves.toEqual([])
  })

  it('drops non-positive NAVs (they would divide by zero downstream)', async () => {
    items = [{ date: '2024-01-02', nav: 0 }, { date: '2024-01-03', nav: -1 }, NAV[0]]
    expect(await fetchNavHistory('110022')).toEqual([NAV[0]])
  })
})

describe('backtestFund', () => {
  it('runs locally on the fetched NAV, without touching /api/backtest', async () => {
    const result = await backtestFund('110022', { period: 'monthly', amount: 1000, feeRate: 0 })
    if (!('summary' in result)) throw new Error(`expected a result, got ${JSON.stringify(result)}`)
    expect(result.summary.total_invested).toBe(4000)
    expect(result.summary.investment_count).toBe(4)
    expect(calls).toHaveLength(1)
    expect(String(calls[0][0])).not.toContain('/backtest/')
  })

  it('clips the NAV series to the requested range', async () => {
    const result = await backtestFund('110022', { period: 'monthly', amount: 1000, feeRate: 0, endDate: '2024-02-01' })
    if (!('summary' in result)) throw new Error('expected a result')
    expect(result.summary.total_invested).toBe(2000)
  })

  it('clipNavHistory bounds both ends and is what the strategy comparison uses', () => {
    expect(clipNavHistory(NAV, { startDate: '2024-02-01', endDate: '2024-03-01' })).toEqual([
      { date: '2024-02-01', nav: 1.1 },
      { date: '2024-03-01', nav: 0.9 },
    ])
    expect(clipNavHistory(NAV, {})).toHaveLength(4)
  })

  it('accepts an in-memory NAV series and never calls the API', async () => {
    const result = await backtestFund('110022', { period: 'monthly', amount: 1000, feeRate: 0, navHistory: NAV })
    expect('summary' in result).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('reports an empty NAV series as { error } rather than throwing', async () => {
    const empty = await backtestFund('110022', { navHistory: [] })
    expect(empty).toEqual({ error: expect.stringContaining('未获取到') })
  })

  it('reports fetch failures as { error } rather than throwing', async () => {
    behavior = 'throw'
    const failed = await backtestFund('110022', {})
    expect(failed).toEqual({ error: expect.stringContaining('净值数据获取失败：boom') })
  })
})
