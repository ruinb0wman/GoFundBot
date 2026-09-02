// @ts-nocheck

import Decimal from 'decimal.js'
import { fmtMoney, fmtChange, fmtNumber, fmtPercent as baseFmtPercent } from '../utils/number'

// ==================== Pure utility functions ====================

export function getValueClass(val) {
  const num = typeof val === 'number' ? val : parseFloat(val)
  if (!Number.isFinite(num)) return ''
  return num > 0 ? 'up' : num < 0 ? 'down' : 'flat'
}

export function metricBySort(fund, key) {
  if (key === 'todayProfitDesc' || key === 'todayProfitAsc') return getHoldingProfitToday(fund, {})
  if (key === 'totalProfitDesc') return getHoldingProfitTotal(fund, {})
  return typeof fund.gszzl === 'number' ? fund.gszzl : parseFloat(fund.gszzl) || 0
}

export function getChangeClass(val) {
  const num = typeof val === 'number' ? val : parseFloat(val)
  if (!Number.isFinite(num)) return ''
  return getValueClass(num)
}

export function formatGsz(fund) {
  const price = getCurrentPrice(fund)
  return price ? new Decimal(price).toFixed(4) : '-'
}

export function formatChange(val) {
  return fmtChange(val)
}

export function getDateText(value) {
  if (!value) return ''
  const text = String(value)
  const matched = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (matched) {
    return `${matched[1]}-${String(matched[2]).padStart(2, '0')}-${String(matched[3]).padStart(2, '0')}`
  }
  return ''
}

export function hasFreshEstimate(fund) {
  const estimate = Number(fund?.gsz)
  if (!Number.isFinite(estimate) || estimate <= 0) return false
  const estimateDate = getDateText(fund?.gztime)
  const navDate = getDateText(fund?.jzrq)
  return !!estimateDate && !!navDate && estimateDate > navDate
}

export function getCurrentPrice(fund) {
  const estimate = parseFloat(fund?.gsz)
  if (hasFreshEstimate(fund) && Number.isFinite(estimate) && estimate > 0) return estimate
  const nav = parseFloat(fund?.dwjz)
  return Number.isFinite(nav) && nav > 0 ? nav : 0
}

export function getLatestPublishedPrice(fund) {
  const nav = parseFloat(fund?.dwjz)
  return Number.isFinite(nav) && nav > 0 ? nav : 0
}

export function getPriceStatusLabel(fund) {
  return hasFreshEstimate(fund) ? '当日估值' : '已更新净值'
}

export function getPreviousPrice(fund) {
  if (hasFreshEstimate(fund)) {
    const nav = parseFloat(fund?.dwjz)
    return Number.isFinite(nav) && nav > 0 ? nav : 0
  }
  const prev = parseFloat(fund?.prevDwjz)
  if (Number.isFinite(prev) && prev > 0) return prev
  const nav = parseFloat(fund?.dwjz)
  return Number.isFinite(nav) && nav > 0 ? nav : 0
}

// Holding computation functions (take raw holdings object, not ref)

export function getHoldingAmount(fund, holdings) {
  const h = holdings[fund.code]
  if (!h || !h.share) return 0
  return new Decimal(h.share).mul(getLatestPublishedPrice(fund)).toNumber()
}

export function getHoldingCostAmount(fund, holdings) {
  const h = holdings[fund.code]
  if (!h || !h.share || !h.cost) return 0
  return new Decimal(h.share).mul(h.cost).toNumber()
}

export function getHoldingEstimatedAmount(fund, holdings) {
  const h = holdings[fund.code]
  if (!h || !h.share) return 0
  const nav = getCurrentPrice(fund)
  return new Decimal(h.share).mul(nav).toNumber()
}

export function getHoldingProfitToday(fund, holdings) {
  const h = holdings[fund.code]
  if (!h || !h.share) return 0
  const gsz = getCurrentPrice(fund)
  const dwjz = getPreviousPrice(fund)
  return new Decimal(h.share).mul(new Decimal(gsz).minus(dwjz)).toNumber()
}

export function getHoldingProfitBeforeFee(fund, holdings) {
  const h = holdings[fund.code]
  if (!h || !h.share || !h.cost) return 0
  const price = getCurrentPrice(fund)
  if (!price || !h.cost) return 0
  return new Decimal(h.share).mul(new Decimal(price).minus(h.cost)).toNumber()
}

export function getHoldingFee(fund, holdings) {
  const h = holdings[fund.code]
  return h?.total_fee || 0
}

export function getHoldingReturnRateBeforeFee(fund, holdings) {
  const h = holdings[fund.code]
  if (!h || !h.share || !h.cost) return 0
  const profit = getHoldingProfitBeforeFee(fund, holdings)
  return new Decimal(profit).div(h.share * h.cost).mul(100).toNumber()
}

export function getHoldingProfitTotal(fund, holdings) {
  const h = holdings[fund.code]
  if (!h || !h.share || !h.cost) return 0
  const price = getCurrentPrice(fund)
  if (!price || !h.cost) return 0
  const profit = new Decimal(h.share).mul(new Decimal(price).minus(h.cost)).toNumber()
  const fee = h.total_fee || 0
  return new Decimal(profit).minus(fee).toNumber()
}

export function getHoldingPrincipalAmount(fund, holdings) {
  const h = holdings[fund.code]
  if (!h || !h.share || !h.cost) return 0
  return new Decimal(h.share).mul(h.cost).toNumber()
}

export function getHoldingReturnRate(fund, holdings) {
  const principal = getHoldingPrincipalAmount(fund, holdings)
  if (!principal) return 0
  const profit = getHoldingProfitTotal(fund, holdings)
  return new Decimal(profit).div(principal).mul(100).toNumber()
}

export function getHoldingProfitTodayClass(fund, holdings) {
  return getValueClass(getHoldingProfitToday(fund, holdings))
}

export function getHoldingProfitTotalClass(fund, holdings) {
  return getValueClass(getHoldingProfitTotal(fund, holdings))
}

export function getHoldingProfitBeforeFeeClass(fund, holdings) {
  return getValueClass(getHoldingProfitBeforeFee(fund, holdings))
}

export function calculateShare(amount, nav) {
  const a = parseFloat(amount)
  const n = parseFloat(nav)
  if (isNaN(a) || isNaN(n) || n <= 0) return 0
  return new Decimal(a).div(n).toNumber()
}

export function formatMoney(value) {
  return fmtMoney(value) || '0.00'
}

export function formatShare(value) {
  return fmtMoney(value) || '0.00'
}

export function genTxnId() {
  return 'txn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
}

export function buildTradeRecord(fund, type, inputValue, nav, tradeDate, status = 'settled', txnId = '') {
  const amount = type === 'buy' ? inputValue : inputValue * nav
  const share = type === 'buy' ? inputValue / nav : inputValue
  return {
    id: txnId || genTxnId(),
    txnId,
    fundCode: fund.code,
    fundName: fund.name || fund.code,
    type,
    tradeDate,
    amount: Number.isFinite(amount) ? amount : 0,
    share: Number.isFinite(share) ? share : 0,
    nav,
    status,
    createdAt: new Date().toISOString(),
    settledAt: status === 'settled' ? new Date().toISOString() : ''
  }
}

export function getTradeStatusText(status) {
  return status === 'pending' ? '挂起' : '已更新'
}

export function mapPortfolioHoldings(portfolio = {}) {
  const rawList = portfolio.stock_codes_new || portfolio.stock_codes || []
  if (!Array.isArray(rawList)) return []
  return rawList.slice(0, 10).map((item, idx) => {
    if (typeof item === 'string') {
      const code = item.includes('.') ? item.split('.').pop() : item
      return { code, name: `持仓股票${idx + 1}`, weight: '-', change: null }
    }
    return {
      code: item.code || item.original_code || `STK${idx + 1}`,
      name: item.name || `持仓股票${idx + 1}`,
      weight: item.ratio != null ? `${item.ratio}%` : '-',
      change: null
    }
  })
}

export function mapFundDetailToRealtime(detail, fallbackCode) {
  const realtime = detail?.realtime_estimate || {}
  const basic = detail?.basic_info || {}
  const changeNum = Number(realtime.estimate_change)
  const trend = Array.isArray(detail?.net_worth_trend) ? detail.net_worth_trend : []
  const trendNavPoints = trend
    .map(item => {
      const nav = Number(item?.net_worth ?? item?.y ?? item?.value)
      let date = item?.date ? String(item.date).slice(0, 10) : ''
      if (!date && item?.x) {
        const ts = Number(item.x)
        if (Number.isFinite(ts)) date = new Date(ts).toISOString().slice(0, 10)
      }
      return Number.isFinite(nav) && nav > 0 && date ? { date, nav } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date))
  const latestTrendNav = trendNavPoints[trendNavPoints.length - 1]
  const previousTrendNav = trendNavPoints[trendNavPoints.length - 2]
  const realtimeNavDate = getDateText(realtime.net_worth_date)
  const latestOfficialNav = latestTrendNav && (!realtimeNavDate || latestTrendNav.date >= realtimeNavDate)
    ? latestTrendNav
    : null
  const effectiveNavDate = latestOfficialNav?.date || realtimeNavDate
  const realtimeEstimateDate = getDateText(realtime.estimate_time)
  const shouldUseEstimateChange = !!realtimeEstimateDate && !!effectiveNavDate && realtimeEstimateDate > effectiveNavDate
  const estimatedNav = Number(realtime.estimate_value)
  const baseOfficialNav = latestOfficialNav?.nav ?? Number(realtime.net_worth)
  const estimateChangeFromNav = shouldUseEstimateChange
    && Number.isFinite(estimatedNav)
    && Number.isFinite(baseOfficialNav)
    && baseOfficialNav > 0
      ? new Decimal(estimatedNav).minus(baseOfficialNav).div(baseOfficialNav).mul(100).toNumber()
      : null
  const officialChange = latestOfficialNav && previousTrendNav?.nav
    ? new Decimal(latestOfficialNav.nav).minus(previousTrendNav.nav).div(previousTrendNav.nav).mul(100).toNumber()
    : null
  return {
    code: realtime.fund_code || basic.fund_code || fallbackCode,
    name: realtime.name || basic.fund_name || fallbackCode,
    dwjz: latestOfficialNav ? String(latestOfficialNav.nav) : realtime.net_worth,
    prevDwjz: previousTrendNav?.nav ? String(previousTrendNav.nav) : realtime.net_worth,
    gsz: realtime.estimate_value,
    gztime: realtime.estimate_time,
    jzrq: latestOfficialNav ? latestOfficialNav.date : realtime.net_worth_date,
    gszzl: shouldUseEstimateChange
      ? (Number.isFinite(estimateChangeFromNav) ? estimateChangeFromNav : (Number.isFinite(changeNum) ? changeNum : 0))
      : (latestOfficialNav && Number.isFinite(officialChange)
        ? officialChange
        : (Number.isFinite(changeNum) ? changeNum : 0)),
    holdings: mapPortfolioHoldings(detail?.portfolio),
    netWorthTrend: trend,
    totalReturnTrend: Array.isArray(detail?.total_return_trend) ? detail.total_return_trend : []
  }
}

export function parseTrendPoint(item) {
  if (!item || typeof item !== 'object') return null
  const navRaw = item.net_worth ?? item.y ?? item.value
  const nav = Number(navRaw)
  if (!Number.isFinite(nav) || nav <= 0) return null
  let dateText = ''
  if (typeof item.date === 'string' && item.date) {
    dateText = item.date.slice(0, 10)
  } else if (item.x) {
    const ts = Number(item.x)
    if (Number.isFinite(ts)) {
      const d = new Date(ts)
      dateText = d.toISOString().slice(0, 10)
    }
  }
  if (!dateText) return null
  return { date: dateText, nav }
}

export function getFundTrendSeries(fund) {
  if (!Array.isArray(fund?.netWorthTrend)) return []
  return fund.netWorthTrend
    .map(parseTrendPoint)
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function getFundNavByDate(fund, dateStr) {
  const trend = getFundTrendSeries(fund)
  if (!trend.length) return parseFloat(fund?.dwjz) || 0
  const target = String(dateStr || '').slice(0, 10)
  if (!target) return parseFloat(fund?.dwjz) || trend[trend.length - 1].nav || 0
  let matched = null
  for (const point of trend) {
    if (point.date <= target) {
      matched = point
    } else {
      break
    }
  }
  return matched?.nav || parseFloat(fund?.dwjz) || trend[trend.length - 1].nav || 0
}

export function hasExactNavForDate(fund, dateStr) {
  const trend = getFundTrendSeries(fund)
  if (!trend.length) return false
  const target = String(dateStr || '').slice(0, 10)
  if (!target) return false
  return trend.some(p => p.date === target)
}

export function isTradeDatePending(fund, tradeDate) {
  if (!fund || !tradeDate) return false
  const today = new Date().toISOString().slice(0, 10)
  if (tradeDate !== today) return false
  return !hasExactNavForDate(fund, tradeDate)
}

export function getFundSparklinePoints(fund) {
  const trend = getFundTrendSeries(fund)
  if (!trend.length) return []
  const recent = trend.slice(-24)
  const min = Math.min(...recent.map(p => p.nav))
  const max = Math.max(...recent.map(p => p.nav))
  const span = max - min || 1
  return recent.map((p, i) => ({
    x: (i / (recent.length - 1 || 1)) * 100,
    y: 26 - ((p.nav - min) / span) * 22
  }))
}

export function getSparklinePath(points) {
  if (!points || points.length < 2) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
}

export function getSparklineFill(points, baseY = 30) {
  if (!points || points.length < 2) return ''
  const line = getSparklinePath(points)
  const firstX = points[0].x.toFixed(2)
  const lastX = points[points.length - 1].x.toFixed(2)
  return `${line} L${lastX},${baseY} L${firstX},${baseY} Z`
}

export function getFundSparklinePoints3m(fund) {
  const trend = getFundTrendSeries(fund)
  if (!trend.length) return []
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 3)
  const cutoffText = cutoff.toISOString().slice(0, 10)
  let series = trend.filter(p => p.date >= cutoffText)
  if (series.length < 2) {
    series = trend.slice(-24)
  }
  if (series.length < 2) return []
  const min = Math.min(...series.map(p => p.nav))
  const max = Math.max(...series.map(p => p.nav))
  const span = max - min || 1
  return series.map((p, i) => ({
    x: (i / (series.length - 1 || 1)) * 100,
    y: 26 - ((p.nav - min) / span) * 22
  }))
}

export function getFundMiniChart3m(fund) {
  const trend = getFundTrendSeries(fund)
  if (!trend.length) {
    return { points: [], yTicks: [], xTicks: [], trendUp: false }
  }
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 3)
  const cutoffText = cutoff.toISOString().slice(0, 10)
  let series = trend.filter(p => p.date >= cutoffText)
  if (series.length < 2) series = trend.slice(-24)
  if (series.length < 2) {
    return { points: [], yTicks: [], xTicks: [], trendUp: false }
  }
  const startNav = series[0].nav || 1
  const pctSeries = series.map(p => ({
    date: p.date,
    pct: ((p.nav - startNav) / startNav) * 100
  }))
  const rawMin = Math.min(...pctSeries.map(p => p.pct))
  const rawMax = Math.max(...pctSeries.map(p => p.pct))
  const pad = Math.max((rawMax - rawMin) * 0.12, 0.25)
  const min = rawMin - pad
  const max = rawMax + pad
  const span = max - min || 1
  const plotLeft = 20
  const plotRight = 106
  const plotTop = 5
  const plotBottom = 48
  const plotW = plotRight - plotLeft
  const plotH = plotBottom - plotTop
  const points = pctSeries.map((p, i) => ({
    x: plotLeft + (i / (pctSeries.length - 1 || 1)) * plotW,
    y: plotBottom - ((p.pct - min) / span) * plotH
  }))
  const yTickCount = 5
  const yTicks = Array.from({ length: yTickCount }, (_, i) => {
    const ratio = i / (yTickCount - 1)
    const y = plotBottom - ratio * plotH
    const val = min + ratio * span
    return { y, label: `${val.toFixed(2)}%` }
  })
  const xTickCount = 6
  const xTicks = Array.from({ length: xTickCount }, (_, i) => {
    const idx = Math.min(
      pctSeries.length - 1,
      Math.round((i / (xTickCount - 1 || 1)) * (pctSeries.length - 1))
    )
    return { x: points[idx].x, label: pctSeries[idx].date.slice(5) }
  })
  const trendUp = pctSeries[pctSeries.length - 1].pct >= pctSeries[0].pct
  return { points, yTicks, xTicks, trendUp }
}

export function getTrendColorClass3m(fund) {
  const trend = getFundTrendSeries(fund)
  if (!trend.length) return 'down'
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 3)
  const cutoffText = cutoff.toISOString().slice(0, 10)
  let series = trend.filter(p => p.date >= cutoffText)
  if (series.length < 2) series = trend.slice(-24)
  if (series.length < 2) return 'down'
  return series[series.length - 1].nav >= series[0].nav ? 'up' : 'down'
}
