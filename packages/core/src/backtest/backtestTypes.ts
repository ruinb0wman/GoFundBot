/**
 * Backtest DTOs. Field names are snake_case on purpose: they are the exact output
 * contract of `python/cli/backtest.py`, consumed by the backtest workspace and by
 * the chat tools. Do not rename.
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

// ───────────────────────────── Portfolio (multi-asset) ─────────────────────────────

/**
 * Portfolio backtest DTOs. Separate from `BacktestSpec` on purpose: the single-fund
 * engine only ever sees one NAV series (see backtestEngine.ts), while a portfolio
 * holds N assets with target weights and rebalances between them.
 *
 * Weights are normalized by their sum, so passing percent (25) or fraction (0.25)
 * for the same portfolio yields identical results.
 */
export type RebalanceFrequency = 'none' | 'monthly' | 'quarterly' | 'yearly';

export interface FundAsset {
  kind?: 'fund';
  fundCode: string;
  name?: string;
  /** Target weight; normalized across all assets. */
  weight: number;
}

/**
 * Synthetic cash leg. Money-market funds have no unit-NAV series (see
 * eastmoneyFundProvider.ts), so the portfolio's cash allocation is modeled as a
 * fixed annual yield compounded daily rather than fetched from `/nav-history`.
 */
export interface CashAsset {
  kind: 'cash';
  name?: string;
  /** Annual yield as a fraction (0.02 = 2%). */
  annualRate: number;
  weight: number;
}

export type PortfolioAsset = FundAsset | CashAsset;

export interface PortfolioContribution {
  amount: number;
  period: RebalanceFrequency;
  /** monthly: day of month 1–31 (default: first trading day of the period). */
  day?: number | null;
}

export interface PortfolioRebalance {
  frequency: RebalanceFrequency;
  /** Absolute weight deviation in fraction of total (0.05 = 5 percentage points). */
  threshold?: number | null;
}

export interface PortfolioSpec {
  assets: PortfolioAsset[];
  initialAmount?: number;
  contribution?: PortfolioContribution | null;
  rebalance?: PortfolioRebalance | null;
  /** Applied to both buys and sells; default 0.0015. */
  feeRate?: number;
  /** Contribution allocation: top up the most underweight legs (default) or buy pro-rata to target. */
  contributionAllocation?: 'underweight' | 'target';
}

export interface PortfolioAssetResult {
  code: string;
  name: string;
  kind: 'fund' | 'cash';
  targetWeight: number;
  finalWeight: number;
  contributed: number;
  finalValue: number;
  return_rate: number;
}

/**
 * `annual_return` (inherited) is the invested-capital figure and is distorted for
 * contribution-heavy portfolios; `annual_return_twr` is the time-weighted
 * equivalent (money-flow adjusted), which is the correct number to compare against
 * published portfolio returns.
 */
export interface PortfolioSummary extends BacktestSummary {
  buy_count: number;
  annual_return_twr: number;
  rebalance_count: number;
  contribution_count: number;
}

export interface PortfolioBacktestResult {
  /** Portfolio-level timeline in the single-fund record shape, so UI/sampling reuse it. */
  timeline: BacktestTimelineRecord[];
  summary: PortfolioSummary;
  assets: PortfolioAssetResult[];
  /** Real window after aligning all assets (max of first dates → min of last dates). */
  effective_start: string;
  effective_end: string;
  excluded: { code: string; reason: string }[];
  note: string;
}

export interface PortfolioBacktestFailure {
  error: string;
}

export function isPortfolioResult(value: PortfolioBacktestResult | PortfolioBacktestFailure): value is PortfolioBacktestResult {
  return 'summary' in value;
}

/**
 * Per-day state handed to a custom multi-asset strategy (see strategySandbox.ts).
 * `history` is truncated to **today and earlier** per asset — no look-ahead.
 * `cash` is the uninvested balance produced by `sell` / rebalance fees.
 */
export interface PortfolioDecisionState {
  i: number;
  date: string;
  /** Today's NAV per asset, indexed like `codes` / `shares`. */
  navs: number[];
  /** Per-asset NAV series up to and including today. */
  history: number[][];
  codes: string[];
  shares: number[];
  values: number[];
  cash: number;
  invested: number;
  /** Positions + cash. */
  value: number;
}

/** Buy `amount` yuan of `asset` with **new external money** (counts as invested). */
export interface PortfolioBuy {
  asset: number;
  amount: number;
}

/** Sell `amount` yuan of `asset`; proceeds stay in the portfolio as cash. */
export interface PortfolioSell {
  asset: number;
  amount: number;
}

/**
 * What a custom portfolio strategy decides for one trading day.
 * Application order: `rebalance` (internal) → `buy` (external) → `sell` (to cash);
 * `sellAll` liquidates everything and wins over the rest.
 */
export interface PortfolioDecision {
  buy?: PortfolioBuy[];
  sell?: PortfolioSell[];
  /** Rebalance positions + cash to these target weights (normalized). */
  rebalance?: number[];
  sellAll?: boolean;
}

export interface PortfolioHooks {
  decide?: (state: PortfolioDecisionState) => PortfolioDecision | void;
}
