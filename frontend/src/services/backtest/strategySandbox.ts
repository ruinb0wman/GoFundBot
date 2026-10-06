/**
 * LLM-authored strategy sandbox — the pure half.
 *
 * A model writes a JS body `onDay(s) -> { buy?, sellAll? }`; this module compiles it,
 * validates every day's decision, and runs it through the existing engine via
 * `runBacktest(..., { decide })`. Keeping this side effect-free (no Worker here) means
 * it can be unit-tested directly; `strategyWorker.ts` is only the transport shell and
 * `runStrategyCode.ts` only manages the worker lifecycle + timeout.
 *
 * Contract shown to the model (must stay in sync with toolContract.ts):
 *   s = { i, date, nav, navs, shares, invested, value, returnRate(), args, helpers }
 *   helpers.ma(n) / helpers.pctChange(n) use **previous** n days only (no look-ahead).
 *
 * Security: this is *not* a security boundary. The Worker shadows globals (best effort)
 * and the user confirms before anything runs — see the plan doc.
 */

import { runBacktest } from './backtestEngine';
import { runPortfolioBacktest } from './portfolioBacktest';
import { isPortfolioResult } from './backtestTypes';
import type {
  BacktestFailure,
  BacktestHooks,
  BacktestResult,
  BacktestSpec,
  Decision,
  DecisionState,
  NavPoint,
  PortfolioBacktestResult,
  PortfolioDecision,
  PortfolioDecisionState,
  PortfolioSpec,
} from './backtestTypes';

export const MAX_CODE_LENGTH = 8000;

export class StrategyCodeError extends Error {}

/** Pure helpers injected into `s.helpers`; both look **backwards** only. */
export interface StrategyHelpers {
  /** Mean of the previous `n` trading days (strictly before today). */
  ma(n: number): number;
  /** NAV change vs `n` days before today (strictly before today). */
  pctChange(n: number): number;
}

export function makeHelpers(navs: number[]): StrategyHelpers {
  return {
    ma(n: number): number {
      const window = Math.max(1, Math.floor(n));
      const prior = navs.slice(Math.max(0, navs.length - 1 - window), navs.length - 1);
      if (prior.length === 0) return navs[navs.length - 1] ?? 0;
      return prior.reduce((a, b) => a + b, 0) / prior.length;
    },
    pctChange(n: number): number {
      const back = Math.max(1, Math.floor(n));
      const current = navs[navs.length - 1];
      const base = navs[navs.length - 1 - back];
      if (base == null || base <= 0) return 0;
      return current / base - 1;
    },
  };
}

export type StrategyDecisionState = DecisionState & {
  helpers: StrategyHelpers;
  args: StrategyArgs;
  returnRate(): number;
};
export type DecisionFn = (state: StrategyDecisionState) => Decision | void;

/** Constants the model can read instead of hardcoding. */
export interface StrategyArgs {
  initial_amount: number;
  fee_rate: number;
}

const DEFAULT_ARGS: StrategyArgs = { initial_amount: 0, fee_rate: 0.0015 };

/**
 * Compile the model's code into a plain callable. Accepts either a bare function body
 * (`return { buy: 1000 }`) or a full function expression
 * (`function onDay(s) { ... }` / `(s) => ...`). Shared by the single-fund and the
 * portfolio contracts; each wraps the raw return value with its own validation.
 */
function compileStrategyFunction(code: string): (state: unknown) => unknown {
  const source = String(code ?? '').trim();
  if (!source) throw new StrategyCodeError('策略代码为空');
  if (source.length > MAX_CODE_LENGTH) {
    throw new StrategyCodeError(`策略代码过长（超过 ${MAX_CODE_LENGTH} 字符）`);
  }
  const looksLikeFunction = /^(function\b|async\b|\(|s\s*=>)/.test(source);
  const wrapped = looksLikeFunction ? `return (${source});` : `return function (s) {\n${source}\n};`;
  let compiled: unknown;
  try {
    compiled = new Function(wrapped)();
  } catch (error) {
    throw new StrategyCodeError(`策略代码编译失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof compiled !== 'function') throw new StrategyCodeError('策略代码必须是一个函数');
  return compiled as (state: unknown) => unknown;
}

/** Compile the single-fund `onDay(s) -> { buy?, sellAll? }` contract. */
export function compileDecision(code: string): DecisionFn {
  return compileStrategyFunction(code) as DecisionFn;
}

/** Compile + wrap one day's decision with validation and a date-tagged error. */
export function makeDecision(code: string, args: StrategyArgs = DEFAULT_ARGS): NonNullable<BacktestHooks['decide']> {
  const fn = compileDecision(code);
  return (state: DecisionState): Decision => {
    let raw: Decision | void;
    try {
      raw = fn({
        ...state,
        helpers: makeHelpers(state.navs),
        args,
        returnRate: () => (state.invested > 0 ? (state.value - state.invested) / state.invested : 0),
      });
    } catch (error) {
      throw new StrategyCodeError(
        `策略代码在 ${state.date} 执行出错：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (raw == null) return {};
    if (typeof raw !== 'object') throw new StrategyCodeError(`${state.date}：onDay 必须返回对象`);
    const buy = Number((raw as Decision).buy ?? 0);
    if (!Number.isFinite(buy) || buy < 0) {
      throw new StrategyCodeError(`${state.date}：buy 必须是不小于 0 的数字`);
    }
    return { buy, sellAll: Boolean((raw as Decision).sellAll) };
  };
}

export interface RunStrategyPayload {
  nav: NavPoint[];
  spec: BacktestSpec;
  code: string;
}

export type RunStrategyResponse =
  | { ok: true; result: BacktestResult }
  | { ok: false; error: string };

/**
 * The whole backtest, executed inside the worker. Returns `{ ok:false, error }` for
 * compile errors, runtime errors (with the offending date) and empty NAV input —
 * never throws, so the worker's message handler stays trivial.
 */
export function handleRunStrategyRequest(payload: RunStrategyPayload): RunStrategyResponse {
  const { nav = [], spec = {}, code = '' } = payload ?? {};
  let decide: NonNullable<BacktestHooks['decide']>;
  try {
    decide = makeDecision(code, {
      initial_amount: spec.initialAmount ?? 0,
      fee_rate: spec.feeRate ?? 0.0015,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  try {
    const outcome = runBacktest(nav, spec, { decide });
    if (!('summary' in outcome)) return { ok: false, error: (outcome as BacktestFailure).error };
    return { ok: true, result: outcome };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ───────────────────────── Multi-asset (portfolio) contract ─────────────────────────
//
// `onDay(s) -> { buy?, sell?, rebalance?, sellAll? }` over N assets. Money enters
// the portfolio through `buy` (external) and `initialAmount`; `sell` parks proceeds
// as cash; `rebalance` moves positions + cash to target weights without new money.

/** Helpers injected into a portfolio strategy's `s.helpers`; all look backwards only. */
export interface PortfolioStrategyHelpers {
  /** Mean of the asset's previous `n` trading days (strictly before today). */
  ma(asset: number, n: number): number;
  /** The asset's NAV change vs `n` days before today (strictly before today). */
  pctChange(asset: number, n: number): number;
  /** Current market-value weight, cash included in the denominator. */
  weight(asset: number): number;
}

export function makePortfolioHelpers(history: number[][], values: number[], cash: number): PortfolioStrategyHelpers {
  const navHistory = (asset: number) => (Array.isArray(history[asset]) ? history[asset] : []);
  return {
    ma(asset: number, n: number): number {
      const navs = navHistory(asset);
      const window = Math.max(1, Math.floor(n));
      const prior = navs.slice(Math.max(0, navs.length - 1 - window), navs.length - 1);
      if (prior.length === 0) return navs[navs.length - 1] ?? 0;
      return prior.reduce((a, b) => a + b, 0) / prior.length;
    },
    pctChange(asset: number, n: number): number {
      const navs = navHistory(asset);
      const back = Math.max(1, Math.floor(n));
      const current = navs[navs.length - 1];
      const base = navs[navs.length - 1 - back];
      if (base == null || base <= 0 || current == null) return 0;
      return current / base - 1;
    },
    weight(asset: number): number {
      const total = values.reduce((a, b) => a + b, 0) + cash;
      return total > 0 ? (values[asset] ?? 0) / total : 0;
    },
  };
}

export type PortfolioStrategyDecisionState = PortfolioDecisionState & {
  helpers: PortfolioStrategyHelpers;
  args: StrategyArgs;
  returnRate(): number;
};
export type PortfolioDecisionFn = (state: PortfolioStrategyDecisionState) => PortfolioDecision | void;

function validatePortfolioDecision(raw: unknown, date: string, assetCount: number): PortfolioDecision {
  if (raw == null) return {};
  if (typeof raw !== 'object') throw new StrategyCodeError(`${date}：onDay 必须返回对象`);
  const input = raw as PortfolioDecision;
  const out: PortfolioDecision = {};
  if (input.sellAll) out.sellAll = true;

  if (input.rebalance !== undefined) {
    if (!Array.isArray(input.rebalance) || input.rebalance.length !== assetCount) {
      throw new StrategyCodeError(`${date}：rebalance 必须是长度 ${assetCount} 的数组`);
    }
    const weights = input.rebalance.map(Number);
    if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
      throw new StrategyCodeError(`${date}：rebalance 的权重必须是不小于 0 的数字`);
    }
    out.rebalance = weights;
  }

  for (const key of ['buy', 'sell'] as const) {
    const list = input[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw new StrategyCodeError(`${date}：${key} 必须是数组`);
    out[key] = list.map((item) => {
      const asset = Number((item as { asset?: unknown })?.asset);
      const amount = Number((item as { amount?: unknown })?.amount);
      if (!Number.isInteger(asset) || asset < 0 || asset >= assetCount) {
        throw new StrategyCodeError(`${date}：${key} 的 asset 下标越界（0 ~ ${assetCount - 1}）`);
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new StrategyCodeError(`${date}：${key} 的 amount 必须是正数`);
      }
      return { asset, amount };
    });
  }
  return out;
}

/** Compile + wrap one day's portfolio decision with validation and a date-tagged error. */
export function makePortfolioDecision(
  code: string,
  args: StrategyArgs = DEFAULT_ARGS,
): NonNullable<import('./backtestTypes').PortfolioHooks['decide']> {
  const fn = compileStrategyFunction(code);
  return (state: PortfolioDecisionState): PortfolioDecision => {
    let raw: unknown;
    try {
      raw = fn({
        ...state,
        helpers: makePortfolioHelpers(state.history, state.values, state.cash),
        args,
        returnRate: () => (state.invested > 0 ? (state.value - state.invested) / state.invested : 0),
      });
    } catch (error) {
      throw new StrategyCodeError(
        `策略代码在 ${state.date} 执行出错：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return validatePortfolioDecision(raw, state.date, state.codes.length);
  };
}

export interface RunPortfolioStrategyPayload {
  spec: PortfolioSpec;
  navByCode: Record<string, NavPoint[]>;
  code: string;
}

export type RunPortfolioStrategyResponse =
  | { ok: true; result: PortfolioBacktestResult }
  | { ok: false; error: string };

/** Runs the multi-asset backtest inside the worker; never throws. */
export function handleRunPortfolioStrategyRequest(payload: RunPortfolioStrategyPayload): RunPortfolioStrategyResponse {
  const { spec = { assets: [] }, navByCode = {}, code = '' } = payload ?? {};
  let decide: NonNullable<import('./backtestTypes').PortfolioHooks['decide']>;
  try {
    decide = makePortfolioDecision(code, {
      initial_amount: spec.initialAmount ?? 0,
      fee_rate: spec.feeRate ?? 0.0015,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  try {
    const outcome = runPortfolioBacktest(spec, { navByCode, hooks: { decide } });
    if (!isPortfolioResult(outcome)) return { ok: false, error: outcome.error };
    return { ok: true, result: outcome };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
