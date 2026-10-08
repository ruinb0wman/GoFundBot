import { describe, it, expect } from 'vitest'
import {
  mapFundDetailToRealtime,
  getHoldingEstimatedAmount,
  getHoldingProfitToday,
  getCurrentPrice,
  getFundNavByDate,
} from '../../composables/useFundRealtimeBase'

// 货币基金：net_worth_trend 是**累计收益指数**（起点 ≈ 1），单位净值恒为 1。
const moneyDetail = {
  fund_code: '000682',
  fund_type: '货币型-普通货币',
  net_worth_trend: [
    { date: '2026-10-05', net_worth: 1.3718 },
    { date: '2026-10-06', net_worth: 1.3722 },
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

describe('mapFundDetailToRealtime - 货币基金', () => {
  it('单位净值取 1（不是累计收益指数），涨跌位换成 7 日年化', () => {
    const fund = mapFundDetailToRealtime(moneyDetail, '000682')

    expect(fund.isMoneyFund).toBe(true)
    expect(fund.dwjz).toBe('1')
    expect(fund.gszzl).toBeCloseTo(1.324, 6)
    expect(fund.sevenDayYield).toBe(1.324)
    expect(fund.unitIncome).toBe(0.3604)
    // 走势图仍用累计指数
    expect(fund.netWorthTrend).toHaveLength(3)
  })

  it('持仓按份额 × 1 估值，今日盈亏 = 份额 × 每万份收益 / 10000', () => {
    const fund = mapFundDetailToRealtime(moneyDetail, '000682')
    const holdings = { '000682': { share: 10000, cost: 1 } }

    expect(getCurrentPrice(fund)).toBe(1)
    expect(getHoldingEstimatedAmount(fund, holdings)).toBeCloseTo(10000, 6)
    expect(getHoldingProfitToday(fund, holdings)).toBeCloseTo(0.3604, 6)
  })

  it('成交净值回查恒为 1，不返回累计收益指数', () => {
    const fund = mapFundDetailToRealtime(moneyDetail, '000682')

    expect(getFundNavByDate(fund, '2026-10-06')).toBe(1)
    expect(getFundNavByDate(fund, '')).toBe(1)
  })

  it('没取到每万份收益时不会把单位净值算错', () => {
    const fund = mapFundDetailToRealtime(
      { ...moneyDetail, realtime_estimate: { ...moneyDetail.realtime_estimate, unit_income: null } },
      '000682'
    )
    const holdings = { '000682': { share: 10000, cost: 1 } }

    expect(fund.dwjz).toBe('1')
    expect(fund.prevDwjz).toBe('1')
    expect(getHoldingProfitToday(fund, holdings)).toBe(0)
  })
})

describe('mapFundDetailToRealtime - 普通基金', () => {
  const normalDetail = {
    net_worth_trend: [
      { date: '2026-10-06', net_worth: 1.5 },
      { date: '2026-10-07', net_worth: 1.53 },
    ],
    realtime_estimate: {
      is_money_fund: false,
      net_worth: 1.53,
      net_worth_date: '2026-10-07',
      estimate_value: null,
      estimate_change: null,
      estimate_time: null,
    },
  }

  it('仍用净值序列的最后一个点作为单位净值与涨跌幅', () => {
    const fund = mapFundDetailToRealtime(normalDetail, '110022')

    expect(fund.isMoneyFund).toBe(false)
    expect(fund.dwjz).toBe('1.53')
    expect(fund.gszzl).toBeCloseTo(2, 6)
    expect(fund.sevenDayYield).toBeNull()
  })
})
