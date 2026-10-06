import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getMock, singleMock, portfolioMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  singleMock: vi.fn(),
  portfolioMock: vi.fn(),
}))

vi.mock('../../services/api', () => ({ default: { get: getMock } }))
vi.mock('../../services/backtest/runStrategyCode', () => ({
  runStrategyCode: singleMock,
  runPortfolioStrategyCode: portfolioMock,
}))

import { executeTool } from '../../services/chatEngine/toolHandlers'

const NAV = [
  { date: '2024-01-02', nav: 1 },
  { date: '2024-02-01', nav: 1.1 },
]

beforeEach(() => {
  getMock.mockReset()
  getMock.mockResolvedValue({ data: { success: true, data: { items: NAV } }, status: 200, ok: true })
  singleMock.mockReset().mockResolvedValue({ summary: { total_invested: 1 }, spec: 'single' })
  portfolioMock.mockReset().mockResolvedValue({ summary: { total_invested: 2 }, spec: 'portfolio' })
})

describe('run_strategy_code handler routing', () => {
  it('routes assets to the portfolio sandbox runner', async () => {
    const result = (await executeTool(
      'run_strategy_code',
      {
        assets: [
          { fund_code: '110022', weight: 50 },
          { fund_code: '000217', weight: 50 },
        ],
        code: 'return {}',
      },
      {},
    )) as Record<string, unknown>

    expect(portfolioMock).toHaveBeenCalledTimes(1)
    expect(singleMock).not.toHaveBeenCalled()
    const request = portfolioMock.mock.calls[0][0] as { navByCode: Record<string, unknown>; code: string }
    expect(Object.keys(request.navByCode).sort()).toEqual(['000217', '110022'])
    expect(request.code).toBe('return {}')
    expect((result.summary as Record<string, unknown>).total_invested).toBe(2)
  })

  it('routes fund_code to the single-fund sandbox runner', async () => {
    await executeTool('run_strategy_code', { fund_code: '110022', code: 'return {}' }, {})
    expect(singleMock).toHaveBeenCalledTimes(1)
    expect(portfolioMock).not.toHaveBeenCalled()
    const request = singleMock.mock.calls[0][0] as { nav: unknown[]; code: string }
    expect(request.nav.length).toBe(2)
  })

  it('rejects a call with neither fund_code nor assets', async () => {
    const result = (await executeTool('run_strategy_code', { code: 'return {}' }, {})) as Record<string, unknown>
    expect(String(result.error)).toContain('fund_code')
    expect(singleMock).not.toHaveBeenCalled()
    expect(portfolioMock).not.toHaveBeenCalled()
  })

  it('rejects a portfolio call with fewer than two assets', async () => {
    const result = (await executeTool(
      'run_strategy_code',
      { assets: [{ fund_code: '110022', weight: 100 }], code: 'return {}' },
      {},
    )) as Record<string, unknown>
    expect(String(result.error)).toMatch(/至少需要 2 个资产/)
    expect(portfolioMock).not.toHaveBeenCalled()
  })
})
