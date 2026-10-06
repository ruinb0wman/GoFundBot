/**
 * Multi-asset portfolio backtest — pure compute, no HTTP.
 *
 * The single-fund engine (`backtestEngine.ts`) only ever sees one NAV series; a
 * portfolio holds N assets with target weights and rebalances between them. This
 * module is the multi-asset counterpart and deliberately reuses the single-fund
 * accounting where it can:
 *   - `summarize()` from backtestEngine.ts for annual return / drawdown / Sharpe;
 *   - the same `BacktestTimelineRecord` shape for the portfolio-level timeline, so
 *     `timelineSample.sampleTimeline()` and the UI can consume it unchanged.
 *
 * Data alignment: each fund's NAV series is joined on the **union** of dates and
 * forward-filled (a halted fund keeps its last known NAV), but simulation only
 * starts at `effective_start = max(first available date)` so every leg is present
 * from day one. Cash legs are synthetic (`(1+r)^years`) because money-market funds
 * have no unit-NAV series.
 */

import { summarize } from './backtestEngine';
import { dayOfMonth, dayStamp, monthKey, pyRound } from './pyCompat';
import type {
  BacktestTimelineRecord,
  ExitReason,
  NavPoint,
  PortfolioAsset,
  PortfolioAssetResult,
  PortfolioBacktestFailure,
  PortfolioBacktestResult,
  PortfolioDecision,
  PortfolioDecisionState,
  PortfolioHooks,
  PortfolioSummary,
  RebalanceFrequency,
} from './backtestTypes';

const DAY_MS = 86_400_000;
const DEFAULT_FEE_RATE = 0.0015;

interface PreparedAsset {
  code: string;
  name: string;
  kind: 'fund' | 'cash';
  /** Raw target weight (normalized later against the surviving assets). */
  weight: number;
  /** Sorted, de-duplicated NAV series (empty for cash). */
  navs: NavPoint[];
  navMap: Map<string, number>;
  annualRate: number;
}

/** Bucket key for the rebalance/contribution calendar. */
function periodKey(date: string, period: RebalanceFrequency): string {
  if (period === 'yearly') return date.slice(0, 4);
  if (period === 'quarterly') return `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
  return monthKey(date);
}

/**
 * First trading day of each period (mirrors `strategyRules.pickInvestmentDates`
 * semantics, extended with quarterly/yearly). `day` only applies to monthly — the
 * portfolio's contribution day, where the first trading day on/after `day` is used
 * and the period's last trading day is the fallback.
 */
export function pickScheduleDates(dates: string[], period: RebalanceFrequency, day?: number | null): string[] {
  if (period === 'none' || dates.length === 0) return [];
  const picks: string[] = [];
  let current: string | null = null;
  let bucket: string[] = [];

  const flush = () => {
    if (bucket.length === 0) return;
    if (day == null || period !== 'monthly') {
      picks.push(bucket[0]);
    } else {
      picks.push(bucket.find((d) => dayOfMonth(d) >= (day as number)) ?? bucket[bucket.length - 1]);
    }
    bucket = [];
  };

  for (const date of dates) {
    const key = periodKey(date, period);
    if (key !== current) {
      flush();
      current = key;
    }
    bucket.push(date);
  }
  flush();
  return picks;
}

function normalizeAssets(assets: PortfolioAsset[]): { funds: PreparedAsset[]; excluded: { code: string; reason: string }[] } {
  const excluded: { code: string; reason: string }[] = [];
  const funds: PreparedAsset[] = [];
  for (const asset of assets) {
    if (!(Number(asset.weight) > 0)) {
      if (asset.kind === 'cash') continue;
      excluded.push({ code: String((asset as { fundCode?: string }).fundCode ?? ''), reason: '权重为 0，已忽略' });
      continue;
    }
    if (asset.kind === 'cash') {
      funds.push({
        code: `cash:${funds.length}`,
        name: asset.name ?? '现金',
        kind: 'cash',
        weight: Number(asset.weight),
        navs: [],
        navMap: new Map(),
        annualRate: Number(asset.annualRate) || 0,
      });
      continue;
    }
    funds.push({
      code: String(asset.fundCode ?? '').trim(),
      name: asset.name ?? '',
      kind: 'fund',
      weight: Number(asset.weight),
      navs: [],
      navMap: new Map(),
      annualRate: 0,
    });
  }
  return { funds, excluded };
}

function setNavSeries(asset: PreparedAsset, points: NavPoint[] | undefined): boolean {
  const map = new Map<string, number>();
  for (const point of points ?? []) {
    const date = String(point?.date ?? '').slice(0, 10);
    const nav = Number(point?.nav);
    if (date && Number.isFinite(nav) && nav > 0) map.set(date, nav);
  }
  if (map.size === 0) return false;
  asset.navs = [...map.entries()].map(([date, nav]) => ({ date, nav })).sort((a, b) => a.date.localeCompare(b.date));
  asset.navMap = map;
  return true;
}

/** NAV known at or before `date` (used to seed the forward-fill at the effective start). */
function navOnOrBefore(navs: NavPoint[], date: string): number | null {
  let value: number | null = null;
  for (const point of navs) {
    if (point.date > date) break;
    value = point.nav;
  }
  return value;
}

function portfolioValue(shares: number[], navs: number[]): number {
  let total = 0;
  for (let i = 0; i < shares.length; i++) total += shares[i] * navs[i];
  return total;
}

/**
 * Buys `amount` (gross yuan) of asset `i` at `nav`, deducting the fee from the cash.
 * Returns the invested cash actually deployed (net of fee).
 */
function buy(shares: number[], i: number, amount: number, nav: number, feeRate: number): number {
  if (!(amount > 0) || !(nav > 0)) return 0;
  const net = amount * (1 - feeRate);
  shares[i] += net / nav;
  return amount;
}

/** Sells `sharesToSell` of asset `i`; returns the cash received after the fee. */
function sell(shares: number[], i: number, sharesToSell: number, nav: number, feeRate: number): number {
  if (!(sharesToSell > 0) || !(nav > 0)) return 0;
  shares[i] -= sharesToSell;
  if (shares[i] < 0) shares[i] = 0;
  return sharesToSell * nav * (1 - feeRate);
}

function rebalanceToTarget(
  shares: number[],
  navs: number[],
  weights: number[],
  feeRate: number,
  cashIn = 0,
): { cash: number; traded: boolean } {
  const total = portfolioValue(shares, navs) + cashIn;
  if (!(total > 0)) return { cash: cashIn, traded: false };
  const targets = weights.map((w) => total * w);

  let cash = cashIn;
  let traded = false;
  for (let i = 0; i < shares.length; i++) {
    const value = shares[i] * navs[i];
    if (value > targets[i]) {
      cash += sell(shares, i, (value - targets[i]) / navs[i], navs[i], feeRate);
      traded = true;
    }
  }
  const deficits = targets.map((target, i) => Math.max(0, target - shares[i] * navs[i]));
  const deficitSum = deficits.reduce((a, b) => a + b, 0);
  if (deficitSum > 0 && cash > 0) {
    const available = cash;
    for (let i = 0; i < shares.length; i++) {
      if (deficits[i] > 0) {
        const spend = (available * deficits[i]) / deficitSum;
        cash -= spend;
        buy(shares, i, spend, navs[i], feeRate);
      }
    }
    traded = true;
  }
  return { cash, traded };
}

/** Normalize a custom strategy's `rebalance` weights; `null` when the shape is invalid. */
function normalizeRebalance(weights: unknown, count: number): number[] | null {
  if (!Array.isArray(weights) || weights.length !== count) return null;
  const nums = weights.map((w) => Number(w));
  if (nums.some((w) => !Number.isFinite(w) || w < 0)) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum > 0 ? nums.map((w) => w / sum) : null;
}

/** Sell every position at today's NAV; returns the cash raised. */
function liquidate(shares: number[], navs: number[], feeRate: number): number {
  let cash = 0;
  for (let i = 0; i < shares.length; i++) cash += sell(shares, i, shares[i], navs[i], feeRate);
  return cash;
}

interface CustomDecisionEffect {
  cash: number;
  /** External cash injected today (counts toward `total_invested`). */
  flow: number;
  isBuyDay: boolean;
  rebalanced: boolean;
  soldAll: boolean;
}

/**
 * Applies one `PortfolioDecision`: `rebalance` (internal) → `buy` (external money) →
 * `sell` (to cash). Invalid entries are ignored defensively — the sandbox is the
 * validation boundary, the engine just must not be corrupted by bad output.
 */
function applyCustomDecision(
  decision: PortfolioDecision,
  shares: number[],
  cashIn: number,
  navs: number[],
  feeRate: number,
  contributed: number[],
): CustomDecisionEffect {
  let cash = cashIn;
  if (decision.sellAll) {
    cash += liquidate(shares, navs, feeRate);
    return { cash, flow: 0, isBuyDay: false, rebalanced: false, soldAll: true };
  }

  let rebalanced = false;
  const weights = normalizeRebalance(decision.rebalance, shares.length);
  if (weights) {
    const applied = rebalanceToTarget(shares, navs, weights, feeRate, cash);
    cash = applied.cash;
    rebalanced = applied.traded;
  }

  let flow = 0;
  let isBuyDay = false;
  for (const item of decision.buy ?? []) {
    const i = Number(item?.asset);
    const amount = Number(item?.amount);
    if (!Number.isInteger(i) || i < 0 || i >= shares.length || !Number.isFinite(amount) || amount <= 0) continue;
    contributed[i] += buy(shares, i, amount, navs[i], feeRate);
    flow += amount;
    isBuyDay = true;
  }

  for (const item of decision.sell ?? []) {
    const i = Number(item?.asset);
    const amount = Number(item?.amount);
    if (!Number.isInteger(i) || i < 0 || i >= shares.length || !Number.isFinite(amount) || amount <= 0) continue;
    cash += sell(shares, i, Math.min(amount / navs[i], shares[i]), navs[i], feeRate);
  }

  return { cash, flow, isBuyDay, rebalanced, soldAll: false };
}

export interface PortfolioEngineOptions {
  /** NAV series per fund code. Cash legs are generated, not read from here. */
  navByCode: Record<string, NavPoint[]>;
  /** Custom strategy: when present, the contribution/rebalance schedule is bypassed. */
  hooks?: PortfolioHooks;
}

export function runPortfolioBacktest(
  spec: import('./backtestTypes').PortfolioSpec,
  { navByCode, hooks }: PortfolioEngineOptions,
): PortfolioBacktestResult | PortfolioBacktestFailure {
  const feeRate = Number.isFinite(spec.feeRate) ? Math.max(0, Number(spec.feeRate)) : DEFAULT_FEE_RATE;
  const { funds, excluded } = normalizeAssets(spec.assets ?? []);

  for (const asset of funds) {
    if (asset.kind !== 'fund') continue;
    if (!asset.code) {
      asset.navs = [];
      excluded.push({ code: '', reason: '缺少基金代码' });
      continue;
    }
    if (!setNavSeries(asset, navByCode[asset.code])) {
      excluded.push({ code: asset.code, reason: '未获取到净值数据' });
    }
  }

  const active = funds.filter((asset) => asset.kind === 'cash' || asset.navs.length > 0);
  if (active.length < 2) {
    const detail = excluded.length > 0 ? `（${excluded.map((e) => `${e.code}: ${e.reason}`).join('；')}）` : '';
    return { error: `有效资产不足 2 个，无法构成组合${detail}` };
  }

  // Effective window: the latest first date → the earliest last date, so every
  // leg has data throughout. `active` always contains ≥1 fund here (checked above),
  // because a cash-only portfolio has no dates to walk.
  const fundAssets = active.filter((asset) => asset.kind === 'fund');
  const effectiveStart = fundAssets.reduce((max, a) => (a.navs[0].date > max ? a.navs[0].date : max), fundAssets[0].navs[0].date);
  const effectiveEnd = fundAssets.reduce((min, a) => {
    const last = a.navs[a.navs.length - 1].date;
    return last < min ? last : min;
  }, fundAssets[0].navs[fundAssets[0].navs.length - 1].date);

  if (effectiveStart >= effectiveEnd) {
    return { error: `资产可用区间不重叠（共同起点 ${effectiveStart} 晚于共同终点 ${effectiveEnd}）` };
  }

  // Union of fund dates inside the effective window.
  const dateSet = new Set<string>();
  for (const asset of fundAssets) {
    for (const point of asset.navs) {
      if (point.date >= effectiveStart && point.date <= effectiveEnd) dateSet.add(point.date);
    }
  }
  const dates = [...dateSet].sort();
  if (dates.length < 2) return { error: '对齐后的共同交易日不足 2 天，无法回测' };

  const weightSum = active.reduce((a, b) => a + b.weight, 0);
  const weights = active.map((asset) => asset.weight / weightSum);

  // Forward-fill each fund over `dates`; generate the cash index from the start.
  const navMatrix = active.map((asset) => {
    if (asset.kind === 'cash') {
      const start = dayStamp(dates[0]);
      return dates.map((date) => Math.pow(1 + asset.annualRate, (dayStamp(date) - start) / DAY_MS / 365.25));
    }
    let last = navOnOrBefore(asset.navs, dates[0]) ?? asset.navs[0].nav;
    return dates.map((date) => {
      const value = asset.navMap.get(date);
      if (value != null) last = value;
      return last;
    });
  });

  const shares = active.map(() => 0);
  const contributed = active.map(() => 0);
  const initialAmount = Math.max(0, Number(spec.initialAmount) || 0);
  const contribution = spec.contribution && Number(spec.contribution.amount) > 0 ? spec.contribution : null;
  const contributionDates = contribution
    ? new Set(pickScheduleDates(dates, contribution.period, contribution.day ?? null))
    : new Set<string>();
  const rebalanceDates = spec.rebalance && spec.rebalance.frequency !== 'none'
    ? new Set(pickScheduleDates(dates, spec.rebalance.frequency, null))
    : new Set<string>();
  const threshold = spec.rebalance?.threshold != null ? Math.abs(Number(spec.rebalance.threshold)) : null;
  const allocation = spec.contributionAllocation ?? 'underweight';

  const timeline: BacktestTimelineRecord[] = [];
  let totalInvested = 0;
  let contributionCount = 0;
  let rebalanceCount = 0;
  let twr = 1;
  let prevValue = 0;
  let cash = 0;
  let soldOut = false;
  let exitReason: ExitReason | null = null;
  const custom = Boolean(hooks?.decide);
  const codes = active.map((asset) => (asset.kind === 'cash' ? 'cash' : asset.code));

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const dayNavs = navMatrix.map((series) => series[i]);

    if (soldOut) {
      timeline.push({
        date,
        invested: pyRound(totalInvested, 2),
        shares: 0,
        nav: pyRound(twr * 100, 4),
        value: pyRound(cash, 2),
        return: pyRound(cash - totalInvested, 2),
        return_rate: totalInvested > 0 ? pyRound(((cash - totalInvested) / totalInvested) * 100, 2) : 0,
        is_investment_day: false,
        status: 'sold',
        exit_reason: exitReason,
      });
      continue;
    }

    let flow = 0;
    let isInvestmentDay = false;
    let soldToday = false;

    if (i === 0 && initialAmount > 0) {
      for (let a = 0; a < active.length; a++) {
        contributed[a] += buy(shares, a, initialAmount * weights[a], dayNavs[a], feeRate);
      }
      totalInvested += initialAmount;
      flow += initialAmount;
      isInvestmentDay = true;
    }

    if (custom) {
      const state: PortfolioDecisionState = {
        i,
        date,
        navs: dayNavs,
        history: navMatrix.map((series) => series.slice(0, i + 1)),
        codes,
        shares: [...shares],
        values: shares.map((value, a) => value * dayNavs[a]),
        cash,
        invested: totalInvested,
        value: portfolioValue(shares, dayNavs) + cash,
      };
      const applied = applyCustomDecision(hooks?.decide?.(state) ?? {}, shares, cash, dayNavs, feeRate, contributed);
      cash = applied.cash;
      flow += applied.flow;
      totalInvested += applied.flow;
      if (applied.isBuyDay) isInvestmentDay = true;
      if (applied.rebalanced) rebalanceCount += 1;
      if (applied.soldAll) {
        soldOut = true;
        exitReason = 'custom';
        soldToday = true;
      }
    } else if (contribution && contributionDates.has(date)) {
      const amount = Number(contribution.amount);
      const total = portfolioValue(shares, dayNavs);
      if (allocation === 'target') {
        for (let a = 0; a < active.length; a++) {
          contributed[a] += buy(shares, a, amount * weights[a], dayNavs[a], feeRate);
        }
      } else {
        const deficits = active.map((_, a) => Math.max(0, (total + amount) * weights[a] - shares[a] * dayNavs[a]));
        const deficitSum = deficits.reduce((x, y) => x + y, 0);
        for (let a = 0; a < active.length; a++) {
          const spend = deficitSum > 0 ? (amount * deficits[a]) / deficitSum : amount * weights[a];
          contributed[a] += buy(shares, a, spend, dayNavs[a], feeRate);
        }
      }
      totalInvested += amount;
      flow += amount;
      contributionCount += 1;
      isInvestmentDay = true;
    }

    let value = portfolioValue(shares, dayNavs) + cash;
    if (!custom) {
      let needsRebalance = rebalanceDates.has(date);
      if (!needsRebalance && threshold != null && value > 0) {
        needsRebalance = active.some((_, a) => Math.abs((shares[a] * dayNavs[a]) / value - weights[a]) > threshold);
      }
      if (needsRebalance) {
        const applied = rebalanceToTarget(shares, dayNavs, weights, feeRate, cash);
        cash = applied.cash;
        value = portfolioValue(shares, dayNavs) + cash;
        if (applied.traded) rebalanceCount += 1;
      }
    }

    // Time-weighted return: strip the external flow from today's value change.
    if (i === 0) {
      twr = flow > 0 ? value / flow : 1;
    } else if (prevValue > 0) {
      const r = (value - flow) / prevValue;
      if (Number.isFinite(r) && r > 0) twr *= r;
    }
    prevValue = value;

    const totalReturn = value - totalInvested;
    timeline.push({
      date,
      invested: pyRound(totalInvested, 2),
      shares: 0,
      // Portfolio unit value (TWR index) — not a tradable NAV, but useful for charts.
      nav: pyRound(twr * 100, 4),
      value: pyRound(value, 2),
      return: pyRound(totalReturn, 2),
      return_rate: totalInvested > 0 ? pyRound((totalReturn / totalInvested) * 100, 2) : 0,
      is_investment_day: isInvestmentDay,
      status: soldToday ? 'sold' : 'holding',
      ...(soldToday ? { exit_reason: exitReason } : {}),
    });
  }

  // Parameterized runs count *planned* slots (Python parity); a custom strategy has
  // no schedule, so it reports the honest number of days it actually bought.
  const scheduledCount = custom
    ? timeline.filter((r) => r.is_investment_day).length
    : contributionCount + (initialAmount > 0 ? 1 : 0);
  const summaryBase = summarize(timeline, scheduledCount);
  const years = (dayStamp(dates[dates.length - 1]) - dayStamp(dates[0])) / DAY_MS / 365.25;
  const annualReturnTwr = years > 0 && twr > 0 ? (Math.pow(twr, 1 / years) - 1) * 100 : 0;

  const finalNavs = navMatrix.map((series) => series[series.length - 1]);
  const finalPositions = portfolioValue(shares, finalNavs);
  const finalTotal = finalPositions + cash;
  const assetResults: PortfolioAssetResult[] = active.map((asset, a) => {
    const series = navMatrix[a];
    const ownReturn = series[0] > 0 ? (series[series.length - 1] / series[0] - 1) * 100 : 0;
    const value = shares[a] * finalNavs[a];
    return {
      code: asset.code,
      name: asset.name || asset.code,
      kind: asset.kind,
      targetWeight: pyRound(weights[a] * 100, 2),
      finalWeight: finalTotal > 0 ? pyRound((value / finalTotal) * 100, 2) : 0,
      contributed: pyRound(contributed[a], 2),
      finalValue: pyRound(value, 2),
      // The leg's own NAV change, NOT value/contributed: rebalancing transfers value
      // between legs, so the funding ledger would misreport a lagging leg's return.
      return_rate: pyRound(ownReturn, 2),
    };
  });
  if (cash > 0.005) {
    assetResults.push({
      code: 'cash_balance',
      name: '未投资现金',
      kind: 'cash',
      targetWeight: 0,
      finalWeight: finalTotal > 0 ? pyRound((cash / finalTotal) * 100, 2) : 0,
      contributed: 0,
      finalValue: pyRound(cash, 2),
      return_rate: 0,
    });
  }

  const summary: PortfolioSummary = {
    ...summaryBase,
    buy_count: timeline.filter((r) => r.is_investment_day).length,
    annual_return_twr: pyRound(annualReturnTwr, 2),
    rebalance_count: rebalanceCount,
    contribution_count: contributionCount,
  };

  return {
    timeline,
    summary,
    assets: assetResults,
    effective_start: dates[0],
    effective_end: dates[dates.length - 1],
    excluded,
    note: [
      `回测区间由各资产共同可用区间决定（${dates[0]} ~ ${dates[dates.length - 1]}）。`,
      `annual_return 为投入本金口径；annual_return_twr 为时间加权年化（已剔除注水影响），更适合与公开组合收益对比。`,
      '手续费按买卖双向扣减，未区分申赎费/卖出印花税/ETF 佣金，结果偏乐观。',
      '权重为目标权重（已按总和归一化）；现金腿按固定年化复利模拟。',
      '各资产 return_rate 是该腿自身净值的区间涨幅（再平衡会在各腿间转移市值，所以不等于期末市值/累计投入）。',
    ].join(''),
  };
}
