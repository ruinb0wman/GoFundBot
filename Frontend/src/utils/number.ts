import Decimal from 'decimal.js'

export const DEFAULT_RISK_FREE_RATE = 2.0
export const DEFAULT_EPSILON = 1e-12

export function isZero(val: number, epsilon = DEFAULT_EPSILON): boolean {
  return Math.abs(val) < epsilon
}

export function isFiniteNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val)
}

export function safeDiv(
  num: number,
  den: number,
  fallback: null | number = null
): number | null {
  if (!isFiniteNumber(den)) return fallback
  if (isZero(den)) return fallback
  return new Decimal(num).div(den).toNumber()
}

export function calcReturn(start: number, end: number): number | null {
  if (!isFiniteNumber(start) || !isFiniteNumber(end)) return null
  if (isZero(start)) return null
  return new Decimal(end).minus(start).div(start).mul(100).toNumber()
}

export function calcAnnualReturn(
  start: number,
  end: number,
  tradingDays: number
): number | null {
  if (!isFiniteNumber(start) || !isFiniteNumber(end) || !isFiniteNumber(tradingDays)) return null
  if (isZero(start) || tradingDays <= 0 || tradingDays < 2) return null
  const totalReturn = new Decimal(end).minus(start).div(start)
  if (totalReturn.lte(-1)) return null
  const base = Decimal.add(1, totalReturn)
  const exponent = new Decimal(252).div(tradingDays)
  return Decimal.pow(base, exponent).minus(1).mul(100).toNumber()
}

export function calcMaxDrawdown(values: number[]): number | null {
  if (!values || values.length < 2) return null
  let peak = new Decimal(values[0])
  let maxDrawdown = new Decimal(0)
  for (let i = 0; i < values.length; i++) {
    const val = new Decimal(values[i])
    if (val.gt(peak)) peak = val
    const drawdown = peak.minus(val).div(peak).mul(100)
    if (drawdown.gt(maxDrawdown)) maxDrawdown = drawdown
  }
  return maxDrawdown.toNumber()
}

export function calcDailyReturns(values: number[]): number[] {
  if (!values || values.length < 2) return []
  const returns: number[] = []
  for (let i = 1; i < values.length; i++) {
    const prev = new Decimal(values[i - 1])
    if (prev.isZero()) continue
    returns.push(new Decimal(values[i]).minus(prev).div(prev).toNumber())
  }
  return returns
}

export function calcVolatility(dailyReturns: number[]): number | null {
  if (!dailyReturns || dailyReturns.length < 10) return null
  const n = dailyReturns.length
  let sum = new Decimal(0)
  for (let i = 0; i < n; i++) sum = sum.add(dailyReturns[i])
  const mean = sum.div(n)
  let variance = new Decimal(0)
  for (let i = 0; i < n; i++) {
    const diff = new Decimal(dailyReturns[i]).minus(mean)
    variance = variance.add(diff.pow(2))
  }
  variance = variance.div(n)
  return variance.sqrt().mul(Math.sqrt(252)).mul(100).toNumber()
}

export function calcSharpe(
  annualReturn: number | null | undefined,
  volatility: number | null | undefined,
  riskFreeRate = DEFAULT_RISK_FREE_RATE
): number | null {
  if (!isFiniteNumber(annualReturn) || !isFiniteNumber(volatility)) return null
  if (isZero(volatility)) return null
  return new Decimal(annualReturn as number).minus(riskFreeRate).div(volatility as number).toNumber()
}

export interface FmtPercentOptions {
  sign?: boolean
  fallback?: string
}

export function fmtPercent(
  val: unknown,
  options?: FmtPercentOptions
): string {
  const { sign = true, fallback = '--' } = options ?? {}
  if (!isFiniteNumber(val)) return fallback
  const num = val as number
  const formatted = new Decimal(num).toFixed(2)
  if (sign) {
    return `${num >= 0 ? '+' : ''}${formatted}%`
  }
  return `${formatted}%`
}

export function fmtNumber(
  val: unknown,
  decimals = 2
): string {
  if (!isFiniteNumber(val)) return '--'
  return new Decimal(val as number).toFixed(decimals)
}

export function fmtMoney(val: unknown, decimals = 2): string {
  if (!isFiniteNumber(val)) return '--'
  return new Decimal(val as number).toFixed(decimals)
}

export function fmtAmountYi(val: unknown): string {
  if (!isFiniteNumber(val)) return '--'
  return `${new Decimal(val as number).div(100000000).toFixed(2)}亿`
}

export function fmtChange(val: unknown): string {
  if (!isFiniteNumber(val)) return '-'
  const num = val as number
  const formatted = new Decimal(num).toFixed(2)
  return `${num >= 0 ? '+' : ''}${formatted}%`
}

export function fmtRatio(val: unknown, decimals = 4): string {
  if (!isFiniteNumber(val)) return '--'
  return new Decimal(val as number).toFixed(decimals)
}

export function fmtDrawdown(val: unknown, decimals = 2): string {
  if (!isFiniteNumber(val)) return '--'
  return `-${new Decimal(val as number).toFixed(decimals)}%`
}

export function returnClass(val: unknown): string {
  if (!isFiniteNumber(val)) return ''
  const num = val as number
  if (isZero(num)) return ''
  return num > 0 ? 'positive' : 'negative'
}

export function sharpeClass(val: unknown): string {
  if (!isFiniteNumber(val)) return ''
  const num = val as number
  if (num >= 1) return 'positive'
  if (num >= 0.5) return ''
  return 'negative'
}

export function scoreClass(val: unknown): string {
  if (!isFiniteNumber(val)) return ''
  const num = val as number
  if (num >= 80) return 'score-high'
  if (num >= 60) return 'score-mid'
  return 'score-low'
}

export function calcCalmar(
  annualReturn: number | null | undefined,
  maxDrawdown: number | null | undefined
): number | null {
  if (!isFiniteNumber(annualReturn) || !isFiniteNumber(maxDrawdown)) return null
  if (isZero(maxDrawdown as number)) return null
  return new Decimal(annualReturn as number).div(maxDrawdown as number).toNumber()
}

export interface RiskMetricsResult {
  max_drawdown_1y: number | null
  sharpe_ratio_1y: number | null
  sharpe_ratio_3y: number | null
  volatility_1y: number | null
  calmar_ratio_1y: number | null
}

export function computeRiskMetricsLocal(
  navPoints: { date: string; nav: number }[]
): RiskMetricsResult {
  const sorted = [...navPoints]
    .filter(p => p.date && isFiniteNumber(p.nav))
    .sort((a, b) => a.date.localeCompare(b.date))

  const values = sorted.map(p => p.nav)

  if (values.length < 10) {
    return {
      max_drawdown_1y: null, sharpe_ratio_1y: null, sharpe_ratio_3y: null,
      volatility_1y: null, calmar_ratio_1y: null,
    }
  }

  const now = Date.now()
  const MIN_TRADING_1Y = 200
  const MIN_TRADING_3Y = 600

  function computePeriod(days: number, minTradingDays: number) {
    const cutoff = now - days * 86400000
    const periodPoints = sorted.filter(p => new Date(p.date).getTime() >= cutoff)
    const periodValues = periodPoints.map(p => p.nav)
    const tradingDays = periodValues.length

    if (tradingDays < minTradingDays) {
      return { annualRet: null, vol: null, sharpe: null, calmar: null, maxDd: null }
    }

    const dailyRet = calcDailyReturns(periodValues)
    const annRet = calcAnnualReturn(periodValues[0], periodValues[periodValues.length - 1], tradingDays)
    const vol = calcVolatility(dailyRet)
    const maxDd = calcMaxDrawdown(periodValues)

    if (vol != null && vol > 500) {
      return { annualRet: null, vol: null, sharpe: null, calmar: null, maxDd: null }
    }

    const sharpe = calcSharpe(annRet, vol)
    const calmar = calcCalmar(annRet, maxDd)

    return { annualRet: annRet, vol, sharpe, calmar, maxDd }
  }

  const p1y = computePeriod(365, MIN_TRADING_1Y)
  const p3y = computePeriod(1095, MIN_TRADING_3Y)

  return {
    max_drawdown_1y: p1y.maxDd,
    sharpe_ratio_1y: p1y.sharpe,
    sharpe_ratio_3y: p3y.sharpe,
    volatility_1y: p1y.vol,
    calmar_ratio_1y: p1y.calmar,
  }
}
