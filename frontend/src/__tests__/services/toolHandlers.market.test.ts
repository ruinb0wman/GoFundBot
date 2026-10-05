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

/**
 * `api.get()` resolves to `HttpResponse<T>` = `{ data: <服务端 body>, status, ok }`.
 * `envelope()` above mocks the *body* itself; use this when the handler needs
 * more than the unwrapped payload (e.g. data_date / source / error).
 */
function httpEnvelope(body: unknown) {
  return { data: body, status: 200, ok: true }
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  return (await executeTool(name, args, {})) as Record<string, unknown>
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

describe('get_concept_sectors handler', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  // 回归：该路由的 data 是扁平数组，旧实现读 `.data.items` 所以恒为空
  it('parses the flat data array and forwards concept fields', async () => {
    getMock.mockResolvedValue(
      httpEnvelope({
        success: true,
        data: [
          {
            name: '快手概念', code: '', change_pct: '+3.15%', raw_change: 3.15,
            main_inflow: '+11.41亿', raw_main_inflow: 1141000000,
            index_value: 1827.55, company_count: 52, leader: '值得买', leader_change_pct: 10.71,
            event: '快手可灵发布 Kling4.0', event_date: '2026-09-20',
          },
        ],
        total_count: 1,
        data_date: '2026-09-29',
        source: 'akshare_ths',
      }),
    )

    const result = await callTool('get_concept_sectors')

    expect(getMock).toHaveBeenCalledWith('/market/concept-sectors?limit=10')
    expect(result.data_status).toBe('available')
    expect(result.count).toBe(1)
    expect(result.date).toBe('2026-09-29')
    const items = result.items as Record<string, unknown>[]
    expect(items[0].name).toBe('快手概念')
    expect(items[0].event).toBe('快手可灵发布 Kling4.0')
  })

  it('honours the limit argument and clamps it to 50', async () => {
    getMock.mockResolvedValue(
      httpEnvelope({ success: true, data: [{ name: 'AI' }], source: 'akshare_ths' }),
    )

    await callTool('get_concept_sectors', { limit: 5 })
    expect(getMock).toHaveBeenLastCalledWith('/market/concept-sectors?limit=5')

    await callTool('get_concept_sectors', { limit: 500 })
    expect(getMock).toHaveBeenLastCalledWith('/market/concept-sectors?limit=50')
  })

  it('reports unavailable (not available) when the source returns no items', async () => {
    getMock.mockResolvedValue(
      httpEnvelope({
        success: false, data: [], error: '概念板块数据源不可用',
        total_count: 0, data_date: '', source: 'failed',
      }),
    )

    const result = await callTool('get_concept_sectors')

    expect(result.data_status).toBe('unavailable')
    expect(result.count).toBe(0)
    expect(String(result.note)).toContain('概念板块数据源不可用')
  })

  it('reports error status when the request throws', async () => {
    getMock.mockRejectedValue(new Error('boom'))

    const result = await callTool('get_concept_sectors')

    expect(result.data_status).toBe('error')
    expect(result.items).toEqual([])
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
