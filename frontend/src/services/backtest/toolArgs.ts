/**
 * Mapping between chat-tool arguments (snake_case, LLM-facing) and `BacktestSpec`.
 *
 * Kept separate from the handlers so it can be unit-tested without the LLM, and so
 * `toolContract.ts` stays the single source of truth for what the model may send.
 */

import type { BacktestSpec, DcaRule, InvestmentPeriod, PortfolioAsset, PortfolioSpec, RebalanceFrequency } from './backtestTypes';

export const DEFAULT_LOOKBACK_YEARS = 3;

export interface ToolArgs {
  fund_code?: string;
  start_date?: string;
  end_date?: string;
  amount?: number;
  initial_amount?: number;
  fee_rate?: number;
  take_profit_rate?: number | null;
  stop_loss_rate?: number | null;
  investment_type?: string;
  day?: number | null;
  dca_rule?: string;
  target_growth?: number;
  ma_window?: number;
  ma_factor?: number;
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Date range for a tool call. `end_date` defaults to today and `start_date` to three
 * years earlier (the same window the 定投回测 page opens with), so the model can ask
 * for "帮我回测一下 XX 基金" without inventing dates.
 */
export function resolveDateRange(args: ToolArgs, now = new Date()): { startDate: string; endDate: string } {
  const endDate = args.end_date ?? toDateStr(now);
  if (args.start_date) return { startDate: args.start_date, endDate };
  const start = new Date(now.getTime());
  start.setFullYear(start.getFullYear() - DEFAULT_LOOKBACK_YEARS);
  return { startDate: toDateStr(start), endDate };
}

function toRule(args: ToolArgs): DcaRule {
  if (args.dca_rule === 'value_averaging') {
    return { type: 'value_averaging', targetGrowth: args.target_growth ?? 0 };
  }
  if (args.dca_rule === 'ma_deviation') {
    return { type: 'ma_deviation', window: args.ma_window ?? 250, factor: args.ma_factor ?? 0.5 };
  }
  return { type: 'fixed' };
}

/**
 * Percent-vs-fraction convention: the model talks in **fractions** (`0.2` = 20%,
 * `0.0015` = 0.15%) because that is what `/api/backtest/*` always documented. The
 * UI converts from percent before calling the engine (composables/useFundBacktest.ts).
 */
export function specFromToolArgs(args: ToolArgs): BacktestSpec {
  return {
    period: (args.investment_type as InvestmentPeriod) ?? 'monthly',
    day: args.day ?? null,
    amount: args.amount ?? 1000,
    initialAmount: args.initial_amount ?? 0,
    feeRate: args.fee_rate ?? 0.0015,
    takeProfitRate: args.take_profit_rate ?? null,
    stopLossRate: args.stop_loss_rate ?? null,
    rule: toRule(args),
  };
}

/** LLM-facing (snake_case) args for `run_portfolio_backtest`. */
export interface PortfolioToolArgs {
  assets?: Array<{ fund_code?: string; weight?: number; annual_rate?: number; name?: string }>;
  start_date?: string;
  end_date?: string;
  initial_amount?: number;
  contribution_amount?: number;
  contribution_period?: string;
  rebalance_frequency?: string;
  rebalance_threshold?: number;
  fee_rate?: number;
}

const REBALANCE_FREQUENCIES: readonly string[] = ['none', 'monthly', 'quarterly', 'yearly'];

function toFrequency(value: string | undefined): RebalanceFrequency {
  return (REBALANCE_FREQUENCIES.includes(value ?? '') ? value : 'none') as RebalanceFrequency;
}

/**
 * Weights are normalized downstream, so percent (25) and fraction (0.25) are both
 * accepted as long as one call is internally consistent. An asset with no
 * `fund_code` becomes a synthetic cash leg (money funds have no NAV series).
 */
export function portfolioSpecFromToolArgs(args: PortfolioToolArgs): PortfolioSpec {
  const assets: PortfolioAsset[] = [];
  for (const asset of args.assets ?? []) {
    const weight = Number(asset.weight);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const code = String(asset.fund_code ?? '').trim();
    if (code) assets.push({ kind: 'fund', fundCode: code, name: asset.name, weight });
    else assets.push({ kind: 'cash', name: asset.name, annualRate: Number(asset.annual_rate) || 0, weight });
  }

  const contributionAmount = Number(args.contribution_amount);
  const contributionPeriod = toFrequency(args.contribution_period);
  const rebalanceFrequency = toFrequency(args.rebalance_frequency);

  return {
    assets,
    initialAmount: args.initial_amount ?? 0,
    contribution:
      Number.isFinite(contributionAmount) && contributionAmount > 0 && contributionPeriod !== 'none'
        ? { amount: contributionAmount, period: contributionPeriod }
        : null,
    rebalance: {
      frequency: rebalanceFrequency,
      threshold: args.rebalance_threshold ?? null,
    },
    feeRate: args.fee_rate ?? 0.0015,
  };
}
