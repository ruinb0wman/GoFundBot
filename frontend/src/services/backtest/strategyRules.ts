/**
 * Declarative DCA strategy rules + investment-date scheduling.
 *
 * The default rule (`fixed`) and the default schedule (first trading day of each
 * period) reproduce `python/cli/backtest.py` exactly — see
 * src/__tests__/services/backtestEngine.test.ts. Everything else here is new
 * behaviour, defined explicitly because there is no Python oracle for it.
 */

import { dayOfMonth, isoWeekKey, monthKey, weekdayIndex } from './pyCompat';
import type { BacktestSpec, DcaRule, InvestmentPeriod } from './backtestTypes';

export interface ScheduleOptions {
  period: InvestmentPeriod;
  day?: number | null;
}

/** Bucket key for the period, mirroring backtest.py's keys. */
function bucketKey(period: InvestmentPeriod, date: string): string {
  return period === 'weekly' ? isoWeekKey(date) : monthKey(date);
}

/** Ordinal compared against `day`: day-of-month for monthly, weekday index for weekly. */
function ordinal(period: InvestmentPeriod, date: string): number {
  return period === 'weekly' ? weekdayIndex(date) : dayOfMonth(date);
}

/**
 * Scheduled investment dates.
 *
 * - `day` omitted → the first trading day of each period (backtest.py behaviour).
 * - `day` given   → the first trading day **on or after** `day` in that period;
 *   if the period has no such day (e.g. monthly `day = 31` in February, or
 *   weekly `day = 4` in a holiday-shortened week), the period's **last** trading
 *   day is used. The overdue buy is never rolled into the next period.
 *
 * `lump_sum` invests on the first date only, regardless of `day`.
 * `daily` invests on every trading day (the UI already offers "每日定投"; the Python
 * implementation had no branch for it and silently produced zero investments).
 */
export function pickInvestmentDates(dates: string[], options: ScheduleOptions): string[] {
  const { period, day } = options;
  if (period === 'lump_sum') return dates.length > 0 ? [dates[0]] : [];
  if (period === 'daily') return [...dates];

  const picks: string[] = [];
  let currentBucket: string | null = null;
  let bucketDates: string[] = [];

  const flush = () => {
    if (bucketDates.length === 0) return;
    if (day == null) {
      picks.push(bucketDates[0]);
    } else {
      const hit = bucketDates.find((d) => ordinal(period, d) >= day);
      picks.push(hit ?? bucketDates[bucketDates.length - 1]);
    }
    bucketDates = [];
  };

  for (const date of dates) {
    const key = bucketKey(period, date);
    if (key !== currentBucket) {
      flush();
      currentBucket = key;
    }
    bucketDates.push(date);
  }
  flush();
  return picks;
}

export interface RuleState {
  /** 1-based count of scheduled investment slots, including the current one. */
  epoch: number;
  /** Portfolio value before this buy (shares × nav). */
  currentValue: number;
  /** All NAVs up to and including today. */
  navs: number[];
  /** Index of today inside `navs`. */
  index: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Cash to invest on the current scheduled date (before fee deduction).
 *
 * - `value_averaging`: target after the n-th slot is
 *   `amount * ((1 + g)^n - 1) / g` (i.e. `target(n) = target(n-1) * (1 + g) + amount`,
 *   with `g = 0` degrading to `n * amount`). We only ever **buy up** to the target —
 *   never sell, since the engine has no sell path besides take-profit/stop-loss.
 * - `ma_deviation`: moving average of the **previous** `window` trading days
 *   (strictly before today, so there is no look-ahead), then
 *   `amount * clamp(MA / nav, 1 - factor, 1 + factor)`. With no history yet, `amount`.
 */
export function ruleBuyAmount(rule: DcaRule, amount: number, state: RuleState): number {
  if (rule.type === 'value_averaging') {
    const g = rule.targetGrowth;
    const n = state.epoch;
    const target = g === 0 ? amount * n : (amount * (Math.pow(1 + g, n) - 1)) / g;
    return round2(Math.max(0, target - state.currentValue));
  }

  if (rule.type === 'ma_deviation') {
    const window = Math.max(1, Math.floor(rule.window));
    const start = Math.max(0, state.index - window);
    const prior = state.navs.slice(start, state.index);
    if (prior.length === 0) return amount;
    const nav = state.navs[state.index];
    if (nav <= 0) return amount;
    const ma = prior.reduce((a, b) => a + b, 0) / prior.length;
    const factor = Math.min(1 + rule.factor, Math.max(1 - rule.factor, ma / nav));
    return round2(amount * factor);
  }

  return amount;
}

/** Human/model-readable one-liner, used by chat tool output and the UI. */
export function describeRule(rule: DcaRule | undefined): string {
  if (!rule || rule.type === 'fixed') return '等额定投';
  if (rule.type === 'value_averaging') return `价值平均（目标增速 ${(rule.targetGrowth * 100).toFixed(2)}%）`;
  return `均线偏离（${rule.window} 日均线，±${(rule.factor * 100).toFixed(0)}%）`;
}

export const DEFAULT_AMOUNT = 1000;
export const DEFAULT_FEE_RATE = 0.0015;

/** Spec with every default filled in; the engine only ever sees this shape. */
export interface NormalizedSpec {
  period: InvestmentPeriod;
  day: number | null;
  amount: number;
  initialAmount: number;
  feeRate: number;
  takeProfitRate: number | null;
  stopLossRate: number | null;
  rule: DcaRule;
}

export function normalizeSpec(spec: BacktestSpec): NormalizedSpec {
  return {
    period: spec.period ?? 'monthly',
    day: spec.day ?? null,
    amount: spec.amount ?? DEFAULT_AMOUNT,
    initialAmount: spec.initialAmount ?? 0,
    feeRate: spec.feeRate ?? DEFAULT_FEE_RATE,
    takeProfitRate: spec.takeProfitRate ?? null,
    stopLossRate: spec.stopLossRate ?? null,
    rule: spec.rule ?? { type: 'fixed' },
  };
}
