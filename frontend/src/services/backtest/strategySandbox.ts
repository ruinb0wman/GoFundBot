/**
 * Strategy-code sandbox — the pure half.
 *
 * One contract, no single/portfolio split: the user code is a **module** that defines
 *
 *   function prepare(sdk)  -> { start, end, assets: string[], initialAmount?, feeRate? }
 *   function onDay(s)      -> { buy?/sell?/rebalance?/sellAll? }   (addressed by fund code)
 *
 * `prepare` runs once (local data only, no network); the host then fetches NAV for the
 * declared pool and runs `onDay` per trading day through the existing multi-asset
 * engine. The engine still indexes legs; this module is the code-addressing adapter.
 *
 * Keeping this side effect-free (no Worker here) means it can be unit-tested directly;
 * `strategyWorker.ts` is only the transport shell and `runStrategyCode.ts` only manages
 * the worker lifecycle + timeout.
 *
 * Security: this is *not* a security boundary. The Worker shadows globals (best effort)
 * and the user confirms before anything runs — see the plan doc.
 */

import { runPortfolioBacktest } from './portfolioBacktest';
import { isPortfolioResult } from './backtestTypes';
import type {
  NavPoint,
  PortfolioBacktestResult,
  PortfolioDecision,
  PortfolioDecisionState,
  PortfolioHooks,
  PortfolioSpec,
} from './backtestTypes';

export const MAX_CODE_LENGTH = 8000;
/** Safety cap on the declared pool (each leg is one NAV series). */
export const MAX_POOL = 40;

export class StrategyCodeError extends Error {}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultStart(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 3);
  return date.toISOString().slice(0, 10);
}

// ───────────────────────────────── plan (prepare) ─────────────────────────────────

/** One row of the local fund database (`screeningFunds`), the only data `prepare` sees. */
export interface ScreenRow {
  code: string;
  name: string;
  type: string | null;
  return_1y: number | null;
  sharpe_ratio_1y: number | null;
  max_drawdown_1y: number | null;
  nav_date: string | null;
}

export interface PlanSdk {
  /** Filter the local fund database (already in memory; no network). */
  screen(filter?: Partial<ScreenRow>): ScreenRow[];
}

export interface StrategyPlan {
  start: string;
  end: string;
  /** Fund codes plus at most one `CASH[:annualRate]` leg. */
  assets: string[];
  initialAmount: number;
  feeRate: number;
}

export interface PlanRequestPayload {
  code: string;
  screenRows?: ScreenRow[];
  /** Host defaults for missing fields (usually the last three years). */
  defaults?: { start: string; end: string };
}

export type PlanResponse = { ok: true; plan: StrategyPlan } | { ok: false; error: string };

export interface StrategyModule {
  prepare?: (sdk: PlanSdk) => unknown;
  onDay: (s: DaySdk) => unknown;
}

/**
 * Compile the user's module and pull `prepare` / `onDay` out of it. The body goes
 * through `new Function` so `function onDay() {}` and `const onDay = () => {}` both work.
 */
export function compileStrategyModule(code: string): StrategyModule {
  const source = String(code ?? '').trim();
  if (!source) throw new StrategyCodeError('策略代码为空');
  if (source.length > MAX_CODE_LENGTH) {
    throw new StrategyCodeError(`策略代码过长（超过 ${MAX_CODE_LENGTH} 字符）`);
  }
  // Cheap guard so legacy bare-body code (pre-module contract) fails with a clear
  // message instead of executing top-level statements and throwing "s is not defined".
  if (!/\bonDay\b/.test(source)) {
    throw new StrategyCodeError(
      '代码必须是模块：请定义 function onDay(s) { ... }（可选 prepare(sdk)）；可在「模板」菜单插入示例。',
    );
  }
  let exported: unknown;
  try {
    exported = new Function(
      `${source}\n;return { prepare: typeof prepare === 'function' ? prepare : undefined, onDay: typeof onDay === 'function' ? onDay : undefined };`,
    )();
  } catch (error) {
    throw new StrategyCodeError(`策略代码编译失败：${errMsg(error)}`);
  }
  const mod = exported as StrategyModule;
  if (typeof mod?.onDay !== 'function') throw new StrategyCodeError('代码必须定义 function onDay(s) { ... }');
  return mod;
}

export function filterScreenRows(rows: ScreenRow[], filter?: Partial<ScreenRow>): ScreenRow[] {
  if (!filter) return rows.slice();
  const entries = Object.entries(filter).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return rows.slice();
  return rows.filter((row) =>
    entries.every(([key, expected]) => {
      const actual = (row as unknown as Record<string, unknown>)[key];
      if (typeof expected === 'string' && typeof actual === 'string') return actual.includes(expected) || expected.includes(actual);
      return actual === expected;
    }),
  );
}

const CASH_RE = /^CASH(?::([\d.]+))?$/i;

function normalizePlan(raw: unknown, defaults: { start: string; end: string }): StrategyPlan {
  if (raw == null || typeof raw !== 'object') {
    throw new StrategyCodeError('prepare() 必须返回对象：{ start, end, assets: [...] }');
  }
  const input = raw as Record<string, unknown>;
  const assets = (Array.isArray(input.assets) ? input.assets : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  if (assets.length === 0) throw new StrategyCodeError('prepare() 的 assets 不能为空');
  if (assets.length > MAX_POOL) throw new StrategyCodeError(`标的数量超过上限 ${MAX_POOL}`);
  if (assets.filter((code) => CASH_RE.test(code)).length > 1) {
    throw new StrategyCodeError('最多只能有一个现金腿（CASH[:年化]）');
  }
  const start = typeof input.start === 'string' && input.start ? input.start.slice(0, 10) : defaults.start;
  const end = typeof input.end === 'string' && input.end ? input.end.slice(0, 10) : defaults.end;
  if (start > end) throw new StrategyCodeError(`开始日期 ${start} 晚于结束日期 ${end}`);
  return {
    start,
    end,
    assets,
    initialAmount: Math.max(0, Number(input.initialAmount) || 0),
    feeRate: Number.isFinite(Number(input.feeRate)) ? Math.max(0, Number(input.feeRate)) : 0.0015,
  };
}

/** Runs `prepare(sdk)` inside the worker; the host then fetches NAV for `plan.assets`. */
export function handlePlanRequest(payload: PlanRequestPayload): PlanResponse {
  const { code = '', screenRows: rows = [], defaults } = payload ?? {};
  const baseDefaults = defaults ?? { start: defaultStart(), end: today() };
  let mod: StrategyModule;
  try {
    mod = compileStrategyModule(String(code));
  } catch (error) {
    return { ok: false, error: errMsg(error) };
  }
  if (typeof mod.prepare !== 'function') {
    return { ok: false, error: '代码必须定义 function prepare(sdk) { return { start, end, assets } }' };
  }
  const sdk: PlanSdk = { screen: (filter) => filterScreenRows(rows, filter) };
  let raw: unknown;
  try {
    raw = mod.prepare(sdk);
  } catch (error) {
    return { ok: false, error: `prepare() 执行出错：${errMsg(error)}` };
  }
  try {
    return { ok: true, plan: normalizePlan(raw, baseDefaults) };
  } catch (error) {
    return { ok: false, error: errMsg(error) };
  }
}

// ──────────────────────────────── run (onDay) ────────────────────────────────

/** Per-day state handed to `onDay(s)`; assets are addressed by **fund code**. */
export interface DaySdk {
  i: number;
  date: string;
  codes: string[];
  /** Today's NAV. Unknown code → error naming it. */
  nav(code: string): number;
  /** NAV series up to and including today (no look-ahead). */
  navs(code: string): number[];
  history(code: string): number[];
  /** Mean of the previous `n` trading days (strictly before today). */
  ma(code: string, n: number): number;
  /** NAV change vs `n` days before today (strictly before today). */
  pctChange(code: string, n: number): number;
  /** Current market-value weight, cash included in the denominator. */
  weight(code: string): number;
  shares: Record<string, number>;
  values: Record<string, number>;
  cash: number;
  invested: number;
  value: number;
  returnRate(): number;
  args: { start: string; end: string; initialAmount: number; feeRate: number };
}

/** Raw decision the user returns, addressed by fund code. */
export interface CodeDecision {
  buy?: Array<{ code: string; amount: number }>;
  sell?: Array<{ code: string; amount: number }>;
  /** Target weights by code (normalized by the engine). */
  rebalance?: Record<string, number>;
  sellAll?: boolean;
}

export const DEFAULT_ARGS: DaySdk['args'] = { start: '', end: '', initialAmount: 0, feeRate: 0.0015 }

/**
 * The engine names a synthetic cash leg `'cash'` (`portfolioBacktest.ts`), while
 * `prepare().assets` declares it as `'CASH'` / `'CASH:0.02'`. Accept both spellings so
 * a strategy never silently targets the wrong leg.
 */
const CASH_ALIAS_RE = /^cash(:.*)?$/i

function resolveCodeIndex(codes: string[], code: string): number {
  const direct = codes.indexOf(code)
  if (direct >= 0) return direct
  if (CASH_ALIAS_RE.test(code)) {
    const cashAt = codes.indexOf('cash')
    if (cashAt >= 0) return cashAt
  }
  return -1
};

function ma(series: number[], n: number): number {
  const window = Math.max(1, Math.floor(n));
  const prior = series.slice(Math.max(0, series.length - 1 - window), series.length - 1);
  if (prior.length === 0) return series[series.length - 1] ?? 0;
  return prior.reduce((a, b) => a + b, 0) / prior.length;
}

function pctChange(series: number[], n: number): number {
  const back = Math.max(1, Math.floor(n));
  const current = series[series.length - 1];
  const base = series[series.length - 1 - back];
  if (base == null || base <= 0 || current == null) return 0;
  return current / base - 1;
}

/** Convert the code-addressed decision into the engine's index-addressed shape. */
export function toIndexDecision(raw: unknown, codes: string[], date: string): PortfolioDecision {
  if (raw == null) return {};
  if (typeof raw !== 'object') throw new StrategyCodeError(`${date}：onDay 必须返回对象`);
  const input = raw as CodeDecision;
  const out: PortfolioDecision = {};
  if (input.sellAll) out.sellAll = true;

  const indexOf = (code: string): number => {
    const at = resolveCodeIndex(codes, code)
    if (at < 0) {
      throw new StrategyCodeError(`${date}：标的 ${code} 未在 prepare().assets 中声明（可用：${codes.join(', ')}）`)
    }
    return at
  }

  if (input.rebalance !== undefined) {
    const weights = input.rebalance as Record<string, number>
    if (weights == null || typeof weights !== 'object' || Array.isArray(weights)) {
      throw new StrategyCodeError(`${date}：rebalance 必须是 { 代码: 权重 } 对象`)
    }
    const list = codes.map(() => 0)
    for (const [code, value] of Object.entries(weights)) {
      // Unknown keys throw (a typo must not silently zero a leg out).
      const at = indexOf(code)
      const weight = Number(value)
      if (!Number.isFinite(weight) || weight < 0) {
        throw new StrategyCodeError(`${date}：rebalance 的权重必须是不小于 0 的数字`)
      }
      list[at] = weight
    }
    out.rebalance = list
  }

  for (const key of ['buy', 'sell'] as const) {
    const list = input[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw new StrategyCodeError(`${date}：${key} 必须是数组`);
    out[key] = list.map((item) => {
      const asset = indexOf(String((item as { code?: unknown })?.code ?? ''));
      const amount = Number((item as { amount?: unknown })?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new StrategyCodeError(`${date}：${key} 的 amount 必须是正数`);
      }
      return { asset, amount };
    });
  }
  return out;
}

/** Compile `onDay` and wrap it with the code→index adapter + date-tagged errors. */
export function makePortfolioDecision(
  code: string,
  args: DaySdk['args'] = DEFAULT_ARGS,
): NonNullable<PortfolioHooks['decide']> {
  const mod = compileStrategyModule(code);
  return (state: PortfolioDecisionState): PortfolioDecision => {
    const resolve = (fundCode: string): number => {
      const at = resolveCodeIndex(state.codes, fundCode)
      if (at < 0) {
        throw new StrategyCodeError(
          `${state.date}：标的 ${fundCode} 未在 prepare().assets 中声明（可用：${state.codes.join(', ')}）`,
        )
      }
      return at
    }
    const seriesOf = (fundCode: string): number[] => state.history[resolve(fundCode)]
    const total = state.values.reduce((sum, value) => sum + value, 0) + state.cash
    const s: DaySdk = {
      i: state.i,
      date: state.date,
      codes: [...state.codes],
      nav: (fundCode) => state.navs[resolve(fundCode)],
      navs: (fundCode) => seriesOf(fundCode),
      history: (fundCode) => seriesOf(fundCode),
      ma: (fundCode, n) => ma(seriesOf(fundCode), n),
      pctChange: (fundCode, n) => pctChange(seriesOf(fundCode), n),
      weight: (fundCode) => {
        const at = resolve(fundCode)
        return total <= 0 ? 0 : (state.values[at] ?? 0) / total
      },
      shares: Object.fromEntries(state.codes.map((fundCode, at) => [fundCode, state.shares[at] ?? 0])),
      values: Object.fromEntries(state.codes.map((fundCode, at) => [fundCode, state.values[at] ?? 0])),
      cash: state.cash,
      invested: state.invested,
      value: state.value,
      returnRate: () => (state.invested > 0 ? (state.value - state.invested) / state.invested : 0),
      args,
    };
    let raw: unknown;
    try {
      raw = mod.onDay(s);
    } catch (error) {
      throw new StrategyCodeError(`策略代码在 ${state.date} 执行出错：${errMsg(error)}`);
    }
    return toIndexDecision(raw, state.codes, state.date);
  };
}

export interface RunPortfolioStrategyPayload {
  spec: PortfolioSpec;
  navByCode: Record<string, NavPoint[]>;
  code: string;
  /** The plan produced by `prepare()`, surfaced to the code as `s.args`. */
  args?: DaySdk['args'];
}

export type RunPortfolioStrategyResponse =
  | { ok: true; result: PortfolioBacktestResult }
  | { ok: false; error: string };

/** Runs the multi-asset backtest inside the worker; never throws. */
export function handleRunPortfolioStrategyRequest(payload: RunPortfolioStrategyPayload): RunPortfolioStrategyResponse {
  const { spec = { assets: [] }, navByCode = {}, code = '', args } = payload ?? {};
  let decide: NonNullable<PortfolioHooks['decide']>;
  try {
    decide = makePortfolioDecision(code, args ?? DEFAULT_ARGS);
  } catch (error) {
    return { ok: false, error: errMsg(error) };
  }
  try {
    const outcome = runPortfolioBacktest(spec, { navByCode, hooks: { decide } });
    if (!isPortfolioResult(outcome)) return { ok: false, error: outcome.error };
    return { ok: true, result: outcome };
  } catch (error) {
    return { ok: false, error: errMsg(error) };
  }
}
