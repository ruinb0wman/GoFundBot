/**
 * Main-thread entry points for the strategy-code sandbox.
 *
 * Spawns `strategyWorker.ts`, enforces a hard timeout (`terminate()` kills an infinite
 * loop), and exposes two phases:
 *   - `planStrategyCode`   — `prepare(sdk)` → declared pool + window (no NAV needed)
 *   - `runPortfolioStrategyCodeRaw` — `onDay(s)` over the injected NAV (full engine result)
 *
 * The workspace page and `scriptRun.ts` consume the raw result; the sampled payload for the
 * model is produced by `portfolioSample.samplePortfolioBacktest` at the call site.
 */

import type { NavPoint, PortfolioBacktestResult, PortfolioSpec } from './backtestTypes';
import type { ScreenRow, StrategyPlan } from './strategySandbox';

export const STRATEGY_TIMEOUT_MS = 5000;

export interface PortfolioStrategyRunRequest {
  spec: PortfolioSpec;
  navByCode: Record<string, NavPoint[]>;
  code: string;
  /** The plan produced by `prepare()`, surfaced to the code as `s.args`. */
  args?: StrategyPlan;
}

export interface StrategyRunOptions {
  /** Label shown in the tool payload's `spec` field (defaults to describePortfolioSpec). */
  specLabel?: string;
  timeoutMs?: number;
}

export type RawPortfolioRunResult = { result: PortfolioBacktestResult } | { error: string };
export type PlanRunResult = { plan: StrategyPlan } | { error: string };

type WorkerMessage =
  | { id: number; ok: true; plan: StrategyPlan }
  | { id: number; ok: true; result: PortfolioBacktestResult }
  | { id: number; ok: false; error: string };

async function executeInWorker(
  kind: 'plan' | 'portfolio',
  payload: unknown,
  timeoutMs: number,
): Promise<WorkerMessage> {
  const worker = new Worker(new URL('./strategyWorker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<WorkerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`策略代码执行超时（>${timeoutMs}ms），已终止`));
      }, timeoutMs);
      worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
        clearTimeout(timer);
        resolve(event.data);
      });
      worker.addEventListener('error', (event: ErrorEvent) => {
        clearTimeout(timer);
        reject(new Error(`策略代码执行失败：${event.message || 'worker error'}`));
      });
      worker.postMessage({ id: 1, kind, payload });
    });
  } finally {
    worker.terminate();
  }
}

function toError(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

/** Phase 1: run `prepare(sdk)` and return the declared pool + window. */
export async function planStrategyCode(
  code: string,
  screenRows: ScreenRow[],
  defaults?: { start: string; end: string },
  options: StrategyRunOptions = {},
): Promise<PlanRunResult> {
  try {
    const response = await executeInWorker(
      'plan',
      { code, screenRows, defaults },
      options.timeoutMs ?? STRATEGY_TIMEOUT_MS,
    );
    if (!response.ok) return { error: response.error };
    return { plan: (response as { plan: StrategyPlan }).plan };
  } catch (error) {
    return toError(error);
  }
}

/** Phase 2: run the backtest in the worker and return the untouched engine result. */
export async function runPortfolioStrategyCodeRaw(
  request: PortfolioStrategyRunRequest,
  options: StrategyRunOptions = {},
): Promise<RawPortfolioRunResult> {
  try {
    const response = await executeInWorker('portfolio', request, options.timeoutMs ?? STRATEGY_TIMEOUT_MS);
    if (!response.ok) return { error: response.error };
    return { result: (response as { result: PortfolioBacktestResult }).result };
  } catch (error) {
    return toError(error);
  }
}
