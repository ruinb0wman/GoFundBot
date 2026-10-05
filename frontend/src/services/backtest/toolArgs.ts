/**
 * Mapping between chat-tool arguments (snake_case, LLM-facing) and `BacktestSpec`.
 *
 * Kept separate from the handlers so it can be unit-tested without the LLM, and so
 * `toolContract.ts` stays the single source of truth for what the model may send.
 */

import type { BacktestSpec, DcaRule, InvestmentPeriod } from './backtestTypes';

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
