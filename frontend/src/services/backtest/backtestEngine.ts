/**
 * Deterministic DCA backtest engine — a faithful TypeScript port of
 * `python/cli/backtest.py` (`_run_backtest`), plus declarative strategy rules.
 *
 * Fidelity contract: the `fixed` rule with no `day` must reproduce the Python
 * output value-for-value. That is enforced by
 * src/__tests__/services/backtestEngine.test.ts against fixtures generated from
 * the real Python implementation (python/tests/gen_backtest_fixtures.py).
 * Rounding goes through `pyRound` because CPython's round() is ties-to-even on the
 * exact binary value — see pyCompat.ts.
 *
 * Everything happens in the browser: no HTTP call, no Python subprocess, so the
 * AI's backtest tool can run a 3-year daily series in microseconds.
 */

import { dayStamp, pyRound } from './pyCompat';
import { normalizeSpec, pickInvestmentDates, ruleBuyAmount } from './strategyRules';
import type {
  BacktestFailure,
  BacktestHooks,
  BacktestResult,
  BacktestSpec,
  BacktestTimelineRecord,
  Decision,
  ExitReason,
  NavPoint,
} from './backtestTypes';

const DAY_MS = 86_400_000;
const TRADING_DAYS_PER_YEAR = 252;
const RISK_FREE_RATE = 0.02 / TRADING_DAYS_PER_YEAR;

export function runBacktest(
  navHistory: NavPoint[] | undefined | null,
  spec: BacktestSpec,
  hooks: BacktestHooks = {},
): BacktestResult | BacktestFailure {
  const normalized = normalizeSpec(spec);
  const entries = navHistory ?? [];
  if (entries.length === 0) return { error: 'No NAV history provided' };

  const navDict = new Map<string, number>();
  const dates: string[] = [];
  for (const entry of entries) {
    const date = entry?.date;
    const nav = entry?.nav;
    if (date && nav) {
      navDict.set(date, Number(nav));
      dates.push(date);
    }
  }
  dates.sort();
  if (dates.length === 0) return { error: 'No valid NAV data points' };

  const investmentDates = pickInvestmentDates(dates, { period: normalized.period, day: normalized.day });
  const slotByDate = new Map<string, number>();
  investmentDates.forEach((date, idx) => {
    if (!slotByDate.has(date)) slotByDate.set(date, idx + 1);
  });
  const scheduled = new Set(investmentDates);

  const navs = dates.map((d) => navDict.get(d) as number);
  const timeline: BacktestTimelineRecord[] = [];
  let totalInvested = 0;
  let totalShares = 0;
  let soldOut = false;
  let exitReason: ExitReason | null = null;
  let exitDate: string | null = null;
  let cash = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const nav = navDict.get(date) as number;

    if (soldOut) {
      timeline.push({
        date,
        invested: pyRound(totalInvested, 2),
        shares: 0,
        nav: pyRound(nav, 4),
        value: pyRound(cash, 2),
        return: pyRound(cash - totalInvested, 2),
        return_rate: totalInvested > 0 ? pyRound(((cash - totalInvested) / totalInvested) * 100, 2) : 0,
        is_investment_day: false,
        status: 'sold',
        exit_reason: exitReason,
      });
      continue;
    }

    if (i === 0 && normalized.initialAmount > 0) {
      totalShares += (normalized.initialAmount * (1 - normalized.feeRate)) / nav;
      totalInvested += normalized.initialAmount;
    }

    let isInvestDay = false;
    let customDecision: Decision | void = undefined;
    if (hooks.decide) {
      // Custom strategy: the callback decides every trading day. `navs` is sliced
      // to today-and-earlier so the code can never see the future.
      customDecision = hooks.decide({
        i,
        date,
        nav,
        navs: navs.slice(0, i + 1),
        shares: totalShares,
        invested: totalInvested,
        value: totalShares * nav,
      });
      const buyAmount = Number(customDecision?.buy ?? 0);
      if (Number.isFinite(buyAmount) && buyAmount > 0) {
        totalShares += (buyAmount * (1 - normalized.feeRate)) / nav;
        totalInvested += buyAmount;
        isInvestDay = true;
      }
    } else {
      const isLumpSumBuy = normalized.period === 'lump_sum' && i === 0 && normalized.amount > 0;
      if ((normalized.period !== 'lump_sum' && scheduled.has(date)) || isLumpSumBuy) {
        const slot = slotByDate.get(date) ?? 1;
        const buyAmount = ruleBuyAmount(normalized.rule, normalized.amount, {
          epoch: slot,
          currentValue: totalShares * nav,
          navs,
          index: i,
        });
        if (buyAmount > 0) {
          totalShares += (buyAmount * (1 - normalized.feeRate)) / nav;
          totalInvested += buyAmount;
          isInvestDay = true;
        }
      }
    }

    const currentValue = totalShares * nav;
    const totalReturn = currentValue - totalInvested;
    const returnRate = totalInvested > 0 ? (totalReturn / totalInvested) * 100 : 0;

    let triggered = false;
    if (customDecision?.sellAll) {
      soldOut = true;
      exitReason = 'custom';
      triggered = true;
    } else if (totalInvested > 0) {
      if (normalized.takeProfitRate && returnRate >= normalized.takeProfitRate * 100) {
        soldOut = true;
        exitReason = 'take_profit';
        triggered = true;
      } else if (normalized.stopLossRate && returnRate <= -(normalized.stopLossRate * 100)) {
        soldOut = true;
        exitReason = 'stop_loss';
        triggered = true;
      }
    }

    if (triggered) {
      exitDate = date;
      cash = currentValue;
      timeline.push({
        date,
        invested: pyRound(totalInvested, 2),
        shares: 0,
        nav: pyRound(nav, 4),
        value: pyRound(cash, 2),
        return: pyRound(cash - totalInvested, 2),
        return_rate: pyRound(((cash - totalInvested) / totalInvested) * 100, 2),
        is_investment_day: isInvestDay,
        status: 'sold',
        exit_reason: exitReason,
      });
      continue;
    }

    timeline.push({
      date,
      invested: pyRound(totalInvested, 2),
      shares: pyRound(totalShares, 4),
      nav: pyRound(nav, 4),
      value: pyRound(currentValue, 2),
      return: pyRound(totalReturn, 2),
      return_rate: pyRound(returnRate, 2),
      is_investment_day: isInvestDay,
      status: 'holding',
    });
  }

  if (timeline.length === 0) return { error: 'No data to backtest' };

  // Python parity: this counts *scheduled* slots (plus the initial lump), not actual
  // buys — a run that exits early still reports every planned instalment. Callers
  // that need the honest number should count `is_investment_day` in the timeline
  // (see timelineSample.ts → buy_count). A custom strategy has no schedule, so it
  // reports the honest number of actual buys instead.
  const scheduledCount = hooks.decide
    ? timeline.filter((r) => r.is_investment_day).length + (normalized.initialAmount > 0 ? 1 : 0)
    : investmentDates.length + (normalized.initialAmount > 0 ? 1 : 0);
  return { summary: summarize(timeline, scheduledCount), timeline };
}

/**
 * Derived metrics. Like the Python implementation, every input here is the
 * **rounded** timeline (drawdown and Sharpe are computed from rounded values, and
 * annual_return is derived from the rounded `return_rate`), so the port stays
 * bit-compatible.
 */
export function summarize(timeline: BacktestTimelineRecord[], investmentCount: number) {
  const finalRecord = timeline[timeline.length - 1];

  let maxDrawdown = 0;
  let peakValue = 0;
  for (const record of timeline) {
    if (record.value > peakValue) peakValue = record.value;
    if (peakValue > 0) {
      const drawdown = ((peakValue - record.value) / peakValue) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  }

  const days = Math.round((dayStamp(timeline[timeline.length - 1].date) - dayStamp(timeline[0].date)) / DAY_MS);
  const years = days / 365.25;

  const totalReturnRate = finalRecord.return_rate / 100;
  let annualReturn = 0;
  if (years > 0 && totalReturnRate > -1) {
    annualReturn = (Math.pow(1 + totalReturnRate, 1 / years) - 1) * 100;
  }

  const returns: number[] = [];
  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1].value;
    if (prev > 0) returns.push((timeline[i].value - prev) / prev);
  }

  let sharpeRatio = 0;
  if (returns.length > 0) {
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    if (returns.length > 1) {
      const variance = returns.reduce((acc, r) => acc + (r - meanReturn) ** 2, 0) / (returns.length - 1);
      const stdDev = Math.sqrt(variance);
      if (stdDev > 0) sharpeRatio = ((meanReturn - RISK_FREE_RATE) / stdDev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
    }
  }

  return {
    total_invested: pyRound(finalRecord.invested, 2),
    final_value: pyRound(finalRecord.value, 2),
    total_return: pyRound(finalRecord.return, 2),
    return_rate: pyRound(finalRecord.return_rate, 2),
    annual_return: pyRound(annualReturn, 2),
    // Python keeps an int 0 when no drawdown was ever recorded; -0 would differ.
    max_drawdown: maxDrawdown === 0 ? 0 : pyRound(-maxDrawdown, 2),
    sharpe_ratio: pyRound(sharpeRatio, 2),
    investment_count: investmentCount,
    days,
    exit_reason: finalRecord.exit_reason ?? null,
    exit_date: timeline.find((r) => r.status === 'sold')?.date ?? null,
  };
}
