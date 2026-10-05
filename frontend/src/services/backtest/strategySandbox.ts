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
import type {
  BacktestFailure,
  BacktestHooks,
  BacktestResult,
  BacktestSpec,
  Decision,
  DecisionState,
  NavPoint,
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
 * Compile the model's code into a callable. Accepts either a bare function body
 * (`return { buy: 1000 }`) or a full function expression
 * (`function onDay(s) { ... }` / `(s) => ...`).
 */
export function compileDecision(code: string): DecisionFn {
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
  return compiled as DecisionFn;
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
