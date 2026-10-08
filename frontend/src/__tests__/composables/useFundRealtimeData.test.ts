import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  getFundCompareData: vi.fn(),
  addFund: vi.fn(),
}))

vi.mock('../../services/api', () => ({
  fundAPI: {
    getFundCompareData: mocks.getFundCompareData,
    searchFunds: vi.fn(),
  },
  portfolioAPI: {
    getFunds: vi.fn(),
    getHoldings: vi.fn(),
    getTrades: vi.fn(),
    getGroups: vi.fn(),
    getGroupMap: vi.fn(),
    addFund: mocks.addFund,
  },
}))

vi.mock('../../stores/fundStore', () => ({
  useFundStore: () => ({ fetchFund: vi.fn() }),
}))

const moneyPayload = {
  fund_code: '000682',
  fund_name: '信澳慧管家货币C',
  fund_type: '货币型-普通货币',
  net_worth_trend: [
    { date: '2026-10-06', net_worth: 1.3725 },
    { date: '2026-10-07', net_worth: 1.37259612 },
  ],
  realtime_estimate: {
    is_money_fund: true,
    net_worth: 1,
    net_worth_date: '2026-10-07',
    seven_day_yield: 1.324,
    unit_income: 0.3604,
    estimate_value: null,
    estimate_change: null,
    estimate_time: null,
    name: '信澳慧管家货币C',
  },
}

describe('useFundRealtimeData.fetchFundData', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // `httpRequest` 返回 `{ data: <响应体> }`，响应体本身又是 `{ success, data: <载荷> }`。
  // 这里少解一层 → 卡片把代码当名字、单位净值 / 涨跌全是 `-`（真机双基金复现过）。
  it('解两层信封后再映射', async () => {
    mocks.getFundCompareData.mockResolvedValue({ data: { success: true, data: moneyPayload } })

    const { useFundRealtimeData } = await import('../../composables/useFundRealtimeData')
    const api = useFundRealtimeData(() => {})
    const fund = await api.fetchFundData('000682')
    expect(fund).not.toBeNull()

    expect(fund!.name).toBe('信澳慧管家货币C')
    expect(fund!.isMoneyFund).toBe(true)
    expect(fund!.dwjz).toBe('1')
    expect(fund!.unitIncome).toBe(0.3604)
  })
})
