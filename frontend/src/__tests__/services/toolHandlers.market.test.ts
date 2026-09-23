import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))

vi.mock('../../services/api', () => ({
  default: { get: getMock },
}))

import { executeTool } from '../../services/chatEngine/toolHandlers'

/** 服务端返回的 {success, data, meta} 信封 */
function envelope(data: unknown) {
  return { success: true, data, meta: { provider: 'eastmoney' } }
}

async function callTool(name: string) {
  return (await executeTool(name, {}, {})) as Record<string, unknown>
}

describe('get_north_flow handler', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('converts DEAL_AMT (百万元) to 亿元 by /100 and never reports net inflow', async () => {
    getMock.mockResolvedValue(
      envelope({
        date: '2026-09-21',
        shNetInflow: null,
        szNetInflow: null,
        totalNetInflow: null,
        shDealAmount: 133832.25,
        szDealAmount: 150079.61,
        totalDealAmount: 283911.86,
      }),
    )

    const result = await callTool('get_north_flow')

    // 283911.86 百万元 = 2839.12 亿元（新闻口径「沪深股通合计成交 2839.12 亿」）
    expect(result.total_deal_amount_yi).toBe(2839.12)
    expect(result.sh_deal_amount_yi).toBe(1338.32)
    expect(result.sz_deal_amount_yi).toBe(1500.8)
    // 净流入必须恒为 null，且状态为 unavailable（防止模型把 null 当 0）
    expect(result.total_net_inflow).toBeNull()
    expect(result.sh_net_inflow).toBeNull()
    expect(result.sz_net_inflow).toBeNull()
    expect(result.net_inflow_available).toBe(false)
    expect(result.data_status).toBe('unavailable')
    expect(String(result.note)).toContain('2024-08-19')
  })

  it('still reports unavailable with a distinct note when no deal amount is available', async () => {
    getMock.mockResolvedValue(
      envelope({ date: '', totalNetInflow: null, totalDealAmount: null }),
    )

    const result = await callTool('get_north_flow')

    expect(result.data_status).toBe('unavailable')
    expect(result.total_deal_amount_yi).toBeNull()
    expect(String(result.note)).toContain('尚未更新')
  })
})

describe('get_market_breadth handler', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('passes through scope/date and real limit counts', async () => {
    getMock.mockResolvedValue(
      envelope({
        upCount: 2323, downCount: 2789, flatCount: 174,
        limitUp: 55, limitDown: 1, total: 5286,
        scope: '沪深两市', date: '2026-09-22',
      }),
    )

    const result = await callTool('get_market_breadth')

    expect(result.data_status).toBe('available')
    expect(result.scope).toBe('沪深两市')
    expect(result.date).toBe('2026-09-22')
    expect(result.total).toBe(5286)
    expect(result.limit_up).toBe(55)
    expect(result.limit_down).toBe(1)
    expect(result.note).toBeUndefined()
  })

  it('notes that only the up/down counts are valid when the limit pools fail', async () => {
    getMock.mockResolvedValue(
      envelope({
        upCount: 2323, downCount: 2789, flatCount: 174,
        limitUp: null, limitDown: null, total: 5286,
        scope: '沪深两市', date: '2026-09-22',
      }),
    )

    const result = await callTool('get_market_breadth')

    expect(result.data_status).toBe('available')
    expect(result.limit_up).toBeNull()
    expect(String(result.note)).toContain('仅涨跌家数有效')
  })

  it('never claims the up/down counts are valid when the whole payload is degraded', async () => {
    getMock.mockResolvedValue(
      envelope({
        upCount: 0, downCount: 0, flatCount: 0,
        limitUp: null, limitDown: null, total: 0,
        scope: '沪深两市', date: '',
      }),
    )

    const result = await callTool('get_market_breadth')

    expect(result.data_status).toBe('unavailable')
    // 回归：降级时曾错误地给出「仅涨跌家数有效」，而此刻涨跌家数恰恰无效
    expect(String(result.note)).not.toContain('仅涨跌家数有效')
    expect(String(result.note)).toContain('涨跌家数本次未取到')
  })
})
