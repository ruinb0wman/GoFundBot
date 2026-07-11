export interface RiskMetricsResult {
  max_drawdown_3m: number | null;
  max_drawdown_6m: number | null;
  max_drawdown_1y: number | null;
  max_drawdown_3y: number | null;
  max_drawdown_all: number | null;
  sharpe_ratio_1y: number | null;
  sharpe_ratio_3y: number | null;
  volatility_1y: number | null;
  volatility_3y: number | null;
  annual_return_1y: number | null;
  annual_return_3y: number | null;
  calmar_ratio_1y: number | null;
  calmar_ratio_3y: number | null;
}

interface NavPoint {
  date: string;
  nav: number;
}

function sliceByDays(points: NavPoint[], days: number): NavPoint[] {
  if (days <= 0) return points;
  const cutoff = Date.now() - days * 86400000;
  return points.filter(p => new Date(p.date).getTime() >= cutoff);
}

function maxDrawdown(navs: number[]): number | null {
  if (navs.length < 2) return null;
  let peak = navs[0];
  let maxDd = 0;
  for (const n of navs) {
    if (n > peak) peak = n;
    const dd = (peak - n) / peak * 100;
    if (dd > maxDd) maxDd = dd;
  }
  return Math.round(maxDd * 100) / 100;
}

function dailyReturns(navs: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < navs.length; i++) {
    const r = navs[i] / navs[i - 1] - 1;
    if (Math.abs(r) < 0.5) {
      returns.push(r);
    }
  }
  return returns;
}

function annualReturn(navs: number[], tradingDays: number): number | null {
  if (navs.length < 2 || tradingDays <= 0) return null;
  const totalRet = navs[navs.length - 1] / navs[0] - 1;
  if (totalRet <= -1) return null;
  const years = tradingDays / 252;
  if (years <= 0) return null;
  return Math.round(((Math.pow(1 + totalRet, 1 / years) - 1) * 100) * 100) / 100;
}

function volatility(dailyRet: number[]): number | null {
  if (dailyRet.length < 5) return null;
  const mean = dailyRet.reduce((s, r) => s + r, 0) / dailyRet.length;
  const variance = dailyRet.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyRet.length - 1);
  return Math.round(Math.sqrt(variance) * Math.sqrt(252) * 100 * 100) / 100;
}

function sharpeRatio(annualRet: number | null, vol: number | null, riskFreeRate = 0.02): number | null {
  if (annualRet == null || vol == null || vol === 0) return null;
  const annualVol = vol / 100;
  if (annualVol <= 0) return null;
  return Math.round(((annualRet / 100 - riskFreeRate) / annualVol) * 100) / 100;
}

function calmarRatio(annualRet: number | null, maxDd: number | null): number | null {
  if (annualRet == null || maxDd == null || maxDd === 0) return null;
  return Math.round((annualRet / maxDd) * 100) / 100;
}

export function computeRiskMetrics(navHistory: { date: string; nav: number }[]): RiskMetricsResult {
  const sorted = [...navHistory]
    .filter(p => p.date && p.nav != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length < 10) {
    return {
      max_drawdown_3m: null, max_drawdown_6m: null,
      max_drawdown_1y: null, max_drawdown_3y: null, max_drawdown_all: null,
      sharpe_ratio_1y: null, sharpe_ratio_3y: null,
      volatility_1y: null, volatility_3y: null,
      annual_return_1y: null, annual_return_3y: null,
      calmar_ratio_1y: null, calmar_ratio_3y: null,
    };
  }

  const navs = sorted.map(p => p.nav);
  const points = sorted.map(p => ({ date: p.date, nav: p.nav }));

  const minTradingDays = { '1y': 200, '3y': 600 };

  function computePeriod(days: number, periodKey: '1y' | '3y') {
    const sliced = sliceByDays(points, days);
    const sliceNavs = sliced.map(p => p.nav);
    const tradingDays = sliceNavs.length;
    const minDays = minTradingDays[periodKey];
    if (tradingDays < minDays) return { annualRet: null, vol: null, sharpe: null, calmar: null };

    const dailyRet = dailyReturns(sliceNavs);
    const annRet = annualReturn(sliceNavs, tradingDays);
    const vol = volatility(dailyRet);
    const maxDd = maxDrawdown(sliceNavs);

    if (vol != null && vol > 500) {
      return { annualRet: null, vol: null, sharpe: null, calmar: null };
    }

    const sharpe = sharpeRatio(annRet, vol);
    const calmar = calmarRatio(annRet, maxDd);

    return { annualRet: annRet, vol, sharpe, calmar };
  }

  const p1y = computePeriod(365, '1y');
  const p3y = computePeriod(1095, '3y');

  return {
    max_drawdown_3m: maxDrawdown(sliceByDays(points, 90).map(p => p.nav)),
    max_drawdown_6m: maxDrawdown(sliceByDays(points, 180).map(p => p.nav)),
    max_drawdown_1y: maxDrawdown(sliceByDays(points, 365).map(p => p.nav)),
    max_drawdown_3y: maxDrawdown(sliceByDays(points, 1095).map(p => p.nav)),
    max_drawdown_all: maxDrawdown(navs),
    sharpe_ratio_1y: p1y.sharpe,
    sharpe_ratio_3y: p3y.sharpe,
    volatility_1y: p1y.vol,
    volatility_3y: p3y.vol,
    annual_return_1y: p1y.annualRet,
    annual_return_3y: p3y.annualRet,
    calmar_ratio_1y: p1y.calmar,
    calmar_ratio_3y: p3y.calmar,
  };
}
