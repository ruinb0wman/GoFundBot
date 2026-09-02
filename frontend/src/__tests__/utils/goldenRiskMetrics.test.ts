import { describe, it, expect } from 'vitest'
import { computeRiskMetricsLocal } from '../../utils/number'

// ── Golden reference: Node backend computeRiskMetrics (pre-frontend-migration) ──
function goldenRiskMetrics(navHistory: { date: string; nav: number }[]) {
  interface R { sharpe_ratio_1y: number | null; sharpe_ratio_3y: number | null; volatility_1y: number | null; calmar_ratio_1y: number | null; max_drawdown_1y: number | null }
  const sorted = [...navHistory].filter(p => p.date && p.nav != null).sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length < 10) {
    return { sharpe_ratio_1y: null, sharpe_ratio_3y: null, volatility_1y: null, calmar_ratio_1y: null, max_drawdown_1y: null } as R
  }
  const sliceByDays = (points: { date: string; nav: number }[], days: number) => {
    const cutoff = Date.now() - days * 86400000
    return points.filter(p => new Date(p.date).getTime() >= cutoff)
  }
  const maxDrawdown = (navs: number[]): number | null => {
    if (navs.length < 2) return null
    let peak = navs[0], maxDd = 0
    for (const n of navs) { if (n > peak) peak = n; const dd = (peak - n) / peak * 100; if (dd > maxDd) maxDd = dd }
    return Math.round(maxDd * 100) / 100
  }
  const dailyReturns = (navs: number[]): number[] => {
    const r: number[] = []
    for (let i = 1; i < navs.length; i++) { const x = navs[i] / navs[i - 1] - 1; if (Math.abs(x) < 0.5) r.push(x) }
    return r
  }
  const annualReturn = (navs: number[], td: number): number | null => {
    if (navs.length < 2 || td <= 0) return null
    const tr = navs[navs.length - 1] / navs[0] - 1
    if (tr <= -1) return null
    const y = td / 252
    if (y <= 0) return null
    return Math.round(((Math.pow(1 + tr, 1 / y) - 1) * 100) * 100) / 100
  }
  const volatility = (dr: number[]): number | null => {
    if (dr.length < 5) return null
    const m = dr.reduce((s, r) => s + r, 0) / dr.length
    const v = dr.reduce((s, r) => s + (r - m) ** 2, 0) / (dr.length - 1)
    return Math.round(Math.sqrt(v) * Math.sqrt(252) * 100 * 100) / 100
  }
  const sharpeRatio = (ar: number | null, vol: number | null): number | null => {
    if (ar == null || vol == null || vol === 0) return null
    const av = vol / 100
    if (av <= 0) return null
    return Math.round(((ar / 100 - 0.02) / av) * 100) / 100
  }
  const calmarRatio = (ar: number | null, dd: number | null): number | null => {
    if (ar == null || dd == null || dd === 0) return null
    return Math.round((ar / dd) * 100) / 100
  }
  const computePeriod = (days: number, min: number) => {
    const sl = sliceByDays(sorted.map(p => ({ date: p.date, nav: p.nav })), days)
    const sn = sl.map(p => p.nav)
    const td = sn.length
    if (td < min) return { annualRet: null, vol: null, sharpe: null, calmar: null, maxDd: null }
    const dr = dailyReturns(sn)
    const ar = annualReturn(sn, td)
    const vol = volatility(dr)
    const dd = maxDrawdown(sn)
    if (vol != null && vol > 500) return { annualRet: null, vol: null, sharpe: null, calmar: null, maxDd: null }
    return { annualRet: ar, vol, sharpe: sharpeRatio(ar, vol), calmar: calmarRatio(ar, dd), maxDd: dd }
  }
  const p1y = computePeriod(365, 200)
  const p3y = computePeriod(1095, 600)
  return { sharpe_ratio_1y: p1y.sharpe, sharpe_ratio_3y: p3y.sharpe, volatility_1y: p1y.vol, calmar_ratio_1y: p1y.calmar, max_drawdown_1y: p1y.maxDd } as R
}

function genNavSeries(days: number, start: number, drift: number, vol: number) {
  const out: { date: string; nav: number }[] = []
  let v = start
  const base = new Date('2021-01-01').getTime()
  for (let i = 0; i < days; i++) {
    v = v * (1 + drift + (Math.sin(i * 0.37) + Math.cos(i * 0.13)) / 100 * vol)
    const d = new Date(base + i * 86400000)
    out.push({ date: d.toISOString().slice(0, 10), nav: Math.round(v * 100000) / 100000 })
  }
  return out
}

describe('Golden alignment: frontend risk metrics === old backend computeRiskMetrics', () => {
  const cases = [
    ['up trend 3y', genNavSeries(1100, 1, 0.0008, 12)],
    ['down trend 3y', genNavSeries(1100, 2, -0.0006, 18)],
    ['choppy 1y', genNavSeries(400, 1, 0, 25)],
    ['short series', genNavSeries(60, 1, 0.001, 10)],
    ['high vol', genNavSeries(1200, 1, 0.0004, 60)],
  ] as const

  it.each(cases)('%s matches', (_name, navs) => {
    const local = computeRiskMetricsLocal(navs)
    const golden = goldenRiskMetrics(navs)
    expect(local.sharpe_ratio_1y).toBe(golden.sharpe_ratio_1y)
    expect(local.sharpe_ratio_3y).toBe(golden.sharpe_ratio_3y)
    expect(local.volatility_1y).toBe(golden.volatility_1y)
    expect(local.calmar_ratio_1y).toBe(golden.calmar_ratio_1y)
    expect(local.max_drawdown_1y).toBe(golden.max_drawdown_1y)
  })
})
