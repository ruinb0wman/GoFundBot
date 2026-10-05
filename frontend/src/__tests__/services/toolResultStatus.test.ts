import { describe, it, expect } from 'vitest'
import { isEmptyToolResult } from '../../services/chatEngine/toolResultStatus'

describe('isEmptyToolResult', () => {
  it('treats null / undefined / empty object as empty', () => {
    expect(isEmptyToolResult(null)).toBe(true)
    expect(isEmptyToolResult(undefined)).toBe(true)
    expect(isEmptyToolResult({})).toBe(true)
  })

  it('judges arrays by length only', () => {
    expect(isEmptyToolResult([])).toBe(true)
    expect(isEmptyToolResult([{ code: '000001', name: '上证指数', price: 3830.45 }])).toBe(false)
    expect(isEmptyToolResult([{ price: 0 }])).toBe(false)
  })

  it('treats an empty collection field as empty', () => {
    expect(isEmptyToolResult({ data_status: 'available', items: [], count: 0 })).toBe(true)
    expect(isEmptyToolResult({ funds: [] })).toBe(true)
    expect(isEmptyToolResult({ items: [{ name: '元件' }] })).toBe(false)
    expect(isEmptyToolResult({ data: { items: [{ name: '元件' }] } })).toBe(false)
  })

  it('does not count error/note/status metadata as payload', () => {
    expect(isEmptyToolResult({ error: '所有板块数据源均不可用', source: 'failed' })).toBe(true)
    expect(isEmptyToolResult({ data_status: 'error', note: 'Request failed', items: [] })).toBe(true)
  })

  // Regression guard for the deliberate north-flow design: status is always
  // 'unavailable' (net inflow stopped being disclosed in 2024) but the
  // 成交总额 (deal amount) is real data and must stay green.
  it('keeps north flow with a deal amount non-empty despite data_status unavailable', () => {
    expect(
      isEmptyToolResult({
        data_status: 'unavailable',
        date: '2026-09-29',
        net_inflow_available: false,
        sh_net_inflow: null,
        sz_net_inflow: null,
        total_net_inflow: null,
        total_deal_amount_yi: 2129.16,
        sh_deal_amount_yi: 1032.58,
        sz_deal_amount_yi: 1096.58,
        note: '自 2024-08-19 起……',
      }),
    ).toBe(false)
  })

  it('treats north flow with no deal amount as empty', () => {
    expect(
      isEmptyToolResult({
        data_status: 'unavailable',
        date: '',
        net_inflow_available: false,
        sh_net_inflow: null,
        sz_net_inflow: null,
        total_net_inflow: null,
        total_deal_amount_yi: null,
        sh_deal_amount_yi: null,
        sz_deal_amount_yi: null,
        note: '北向资金数据暂不可用……',
      }),
    ).toBe(true)
  })

  it('treats an all-zero market breadth payload as empty but keeps a real one', () => {
    const degraded = {
      data_status: 'unavailable',
      scope: '沪深两市',
      date: '',
      up_count: 0,
      down_count: 0,
      flat_count: 0,
      limit_up: null,
      limit_down: null,
      total: 0,
      note: '涨跌家数本次未取到',
    }
    expect(isEmptyToolResult(degraded)).toBe(true)
    expect(isEmptyToolResult({ ...degraded, data_status: 'available', up_count: 3315, total: 5288 })).toBe(false)
  })

  it('treats zero-only numeric payloads as empty', () => {
    expect(isEmptyToolResult({ main_net_inflow: 0 })).toBe(true)
    expect(isEmptyToolResult({ main_net_inflow: -6524000000 })).toBe(false)
  })
})
