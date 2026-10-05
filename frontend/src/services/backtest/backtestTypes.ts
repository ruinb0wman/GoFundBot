/**
 * Backtest DTOs. Field names are snake_case on purpose: they are the exact output
 * contract of `python/cli/backtest.py`, consumed by
 * `frontend/src/components/FundBacktest.vue` and by the chat tools. Do not rename.
 */

export type InvestmentPeriod = 'monthly' | 'weekly' | 'daily' | 'lump_sum';

/**
 * DCA rule: how much cash to invest on each scheduled date.
 * - `fixed` (default): always `amount`.
 * - `value_averaging`: top up to a geometric target (see strategyRules.ts).
 * - `ma_deviation`: scale `amount` by how far the NAV sits below/above its MA.
 */
export type DcaRule =
  | { type: 'fixed' }
  | { type: 'value_averaging'; targetGrowth: number }
  | { type: 'ma_deviation'; window: number; factor: number };

export interface NavPoint {
  date: string;
  nav: number;
}

export interface BacktestSpec {
  period?: InvestmentPeriod;
  /** monthly: day of month 1–31; weekly: weekday 0–4 (Mon=0). Omitted = first trading day of the period. */
  day?: number | null;
  amount?: number;
  initialAmount?: number;
  feeRate?: number;
  takeProfitRate?: number | null;
  stopLossRate?: number | null;
  rule?: DcaRule;
}

/** Why the run left the market. `custom` = a strategy code called `sellAll`. */
export type ExitReason = 'take_profit' | 'stop_loss' | 'custom';

export interface BacktestTimelineRecord {
  date: string;
  invested: number;
  shares: number;
  nav: number;
  value: number;
  return: number;
  return_rate: number;
  is_investment_day: boolean;
  status: 'holding' | 'sold';
  exit_reason?: ExitReason | null;
}

export interface BacktestSummary {
  total_invested: number;
  final_value: number;
  total_return: number;
  return_rate: number;
  annual_return: number;
  max_drawdown: number;
  sharpe_ratio: number;
  investment_count: number;
  days: number;
  exit_reason: ExitReason | null;
  exit_date: string | null;
}

export interface BacktestResult {
  summary: BacktestSummary;
  timeline: BacktestTimelineRecord[];
}

export interface BacktestFailure {
  error: string;
}

export function isBacktestResult(value: BacktestResult | BacktestFailure): value is BacktestResult {
  return 'summary' in value;
}

/**
 * Per-day state handed to a custom strategy's `onDay(s)` (see strategySandbox.ts).
 * `navs` is deliberately truncated to **today and earlier** — no look-ahead.
 */
export interface DecisionState {
  i: number;
  date: string;
  nav: number;
  navs: number[];
  shares: number;
  invested: number;
  value: number;
}

/** What a custom strategy decides for one trading day. */
export interface Decision {
  /** Cash to invest today, in yuan (fee is deducted by the engine). */
  buy?: number;
  /** Sell everything and stop trading (same path as take-profit). */
  sellAll?: boolean;
}

/**
 * Optional engine hooks. When `decide` is provided the scheduled-DCA/rule logic is
 * bypassed entirely: the callback is invoked on every trading day and the engine
 * still owns fees, take-profit/stop-loss, rounding and `summarize()`.
 */
export interface BacktestHooks {
  decide?: (state: DecisionState) => Decision | void;
}
