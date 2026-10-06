import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getMock, listPositionsMock } = vi.hoisted(() => ({ getMock: vi.fn(), listPositionsMock: vi.fn() }))

vi.mock('../../services/api', () => ({
  default: { get: getMock },
}))

vi.mock('../../db/positions', () => ({
  listPositions: listPositionsMock,
}))

import { executeTool } from '../../services/chatEngine/toolHandlers'

const NAV_BY_CODE: Record<string, Array<{ date: string; nav: number }>> = {
  '110022': [
    { date: '2019-01-02', nav: 1 },
    { date: '2020-01-02', nav: 1.2 },
    { date: '2021-01-04', nav: 1.5 },
  ],
  '000217': [
    { date: '2019-01-02', nav: 2 },
    { date: '2020-01-02', nav: 2.2 },
    { date: '2021-01-04', nav: 2.4 },
  ],
}

function envelope(data: unknown) {
  return { data: { success: true, data }, status: 200, ok: true }
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  return (await executeTool(name, args, {})) as Record<string, unknown>
}

beforeEach(() => {
  getMock.mockReset()
  getMock.mockImplementation((url: string) => {
    const code = url.split('/')[2]
    return Promise.resolve(envelope({ items: NAV_BY_CODE[code] ?? [] }))
  })
  listPositionsMock.mockReset()
  listPositionsMock.mockResolvedValue([])
})

describe('run_portfolio_backtest handler', () => {
  it('backtests a two-fund portfolio and returns a compact payload', async () => {
    const result = await callTool('run_portfolio_backtest', {
      assets: [
        { fund_code: '110022', weight: 50 },
        { fund_code: '000217', weight: 50 },
      ],
      initial_amount: 1000,
      rebalance_frequency: 'yearly',
    })

    const summary = result.summary as Record<string, number>
    expect(summary.total_invested).toBe(1000)
    expect(summary.rebalance_count).toBeGreaterThanOrEqual(1)
    expect((result.assets as unknown[]).length).toBe(2)
    expect(String(result.spec)).toContain('110022')
    expect(result.effective_start).toBe('2019-01-02')
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('models a cash leg without fetching it', async () => {
    const result = await callTool('run_portfolio_backtest', {
      assets: [
        { fund_code: '110022', weight: 50 },
        { annual_rate: 0.02, weight: 50 },
      ],
      initial_amount: 1000,
    })

    expect(getMock).toHaveBeenCalledTimes(1)
    const assets = result.assets as Array<{ kind: string; final_pct: number; return_pct: number }>
    expect(assets.map((a) => a.kind)).toEqual(['fund', 'cash'])
    expect(assets[1].return_pct).toBeGreaterThan(0)
  })

  it('rejects a single-asset call and points at run_backtest', async () => {
    const result = await callTool('run_portfolio_backtest', {
      assets: [{ fund_code: '110022', weight: 100 }],
      initial_amount: 1000,
    })
    expect(String(result.error)).toContain('run_backtest')
  })

  it('surfaces funds with no NAV data as excluded instead of failing the run', async () => {
    const result = await callTool('run_portfolio_backtest', {
      assets: [
        { fund_code: '110022', weight: 50 },
        { fund_code: '000217', weight: 25 },
        { fund_code: '999999', weight: 25 },
      ],
      initial_amount: 1000,
    })
    expect(result.excluded).toEqual([{ code: '999999', reason: '未获取到净值数据' }])
    expect((result.assets as unknown[]).length).toBe(2)
  })
})

describe('get_portfolio_holdings handler', () => {
  it('returns an empty hint when nothing is persisted', async () => {
    const result = await callTool('get_portfolio_holdings')
    expect(result.holdings).toEqual([])
    expect(String(result.message)).toContain('暂无持仓')
  })

  it('values holdings with the latest estimate and normalizes weights', async () => {
    listPositionsMock.mockResolvedValue([
      { id: 1, fundCode: '110022', fundName: '易方达消费', purchaseDate: '2024-01-02', purchaseTime: '14:59', shares: 100, cost: 1.5 },
      { id: 2, fundCode: '000217', fundName: '华安黄金', purchaseDate: '2024-02-02', purchaseTime: '14:59', shares: 200, cost: 1 },
    ])
    getMock.mockImplementation((url: string) => {
      const code = url.split('/')[2]
      const nav = code === '110022' ? 2 : 1
      return Promise.resolve({ data: { data: { code, nav, estimatedNav: nav } }, status: 200, ok: true })
    })

    const result = await callTool('get_portfolio_holdings')
    const holdings = result.holdings as Array<{ fund_code: string; market_value: number; weight_pct: number }>
    expect(result.count).toBe(2)
    expect(result.total_market_value).toBe(400)
    expect(holdings[0]).toMatchObject({ fund_code: '110022', market_value: 200, weight_pct: 50 })
    expect(holdings[1]).toMatchObject({ fund_code: '000217', market_value: 200, weight_pct: 50 })
    expect(String(result.note)).toContain('当前持仓')
  })

  it('falls back to the cost basis when the estimate fails', async () => {
    listPositionsMock.mockResolvedValue([
      { id: 1, fundCode: '110022', fundName: null, purchaseDate: null, purchaseTime: null, shares: 100, cost: 1.5 },
    ])
    getMock.mockRejectedValue(new Error('offline'))
    const result = await callTool('get_portfolio_holdings')
    const holdings = result.holdings as Array<{ market_value: number | null; nav: number | null }>
    expect(holdings[0].nav).toBeNull()
    expect(holdings[0].market_value).toBeNull()
    expect(result.total_market_value).toBe(150)
  })
})
