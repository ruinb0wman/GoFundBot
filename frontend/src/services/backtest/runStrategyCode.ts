/**
 * Main-thread entry point for the LLM strategy-code sandbox.
 *
 * Spawns `strategyWorker.ts`, enforces a hard timeout (`terminate()` kills an
 * infinite loop), then turns the raw engine result into the compact payload the
 * model receives. Two contracts share one worker:
 *   - single fund: `onDay(s) -> { buy?, sellAll? }`  (sampleBacktest)
 *   - portfolio:   `onDay(s) -> { buy?, sell?, rebalance?, sellAll? }` (samplePortfolioBacktest)
 */

import { sampleBacktest, type SampledBacktest } from './timelineSample';
import { samplePortfolioBacktest, type SampledPortfolioBacktest } from './portfolioSample';
import type { BacktestResult, BacktestSpec, NavPoint, PortfolioBacktestResult, PortfolioSpec } from './backtestTypes';

export const STRATEGY_TIMEOUT_MS = 5000;

export interface StrategyRunRequest {
  nav: NavPoint[];
  spec: BacktestSpec;
  code: string;
}

export interface PortfolioStrategyRunRequest {
  spec: PortfolioSpec;
  navByCode: Record<string, NavPoint[]>;
  code: string;
}

export interface StrategyRunOptions {
  /** Label shown in the tool payload's `spec` field (defaults to describeSpec). */
  specLabel?: string;
  timeoutMs?: number;
}

export type StrategyRunResult = SampledBacktest | { error: string };
export type PortfolioStrategyRunResult = SampledPortfolioBacktest | { error: string };

type WorkerRunResponse = { ok: true; result: unknown } | { ok: false; error: string };

async function executeInWorker(
  kind: 'single' | 'portfolio',
  payload: unknown,
  timeoutMs: number,
): Promise<WorkerRunResponse> {
  const worker = new Worker(new URL('./strategyWorker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<WorkerRunResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`策略代码执行超时（>${timeoutMs}ms），已终止`));
      }, timeoutMs);
      worker.addEventListener('message', (event: MessageEvent<WorkerRunResponse>) => {
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

export async function runStrategyCode(
  request: StrategyRunRequest,
  options: StrategyRunOptions = {},
): Promise<StrategyRunResult> {
  try {
    const response = await executeInWorker('single', request, options.timeoutMs ?? STRATEGY_TIMEOUT_MS);
    if (!response.ok) return { error: response.error };
    return sampleBacktest(response.result as BacktestResult, request.spec, { specLabel: options.specLabel });
  } catch (error) {
    return toError(error);
  }
}

export async function runPortfolioStrategyCode(
  request: PortfolioStrategyRunRequest,
  options: StrategyRunOptions = {},
): Promise<PortfolioStrategyRunResult> {
  try {
    const response = await executeInWorker('portfolio', request, options.timeoutMs ?? STRATEGY_TIMEOUT_MS);
    if (!response.ok) return { error: response.error };
    return samplePortfolioBacktest(response.result as PortfolioBacktestResult, request.spec, {
      specLabel: options.specLabel,
    });
  } catch (error) {
    return toError(error);
  }
}
