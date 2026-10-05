/**
 * Main-thread entry point for the LLM strategy-code sandbox.
 *
 * Spawns `strategyWorker.ts`, enforces a hard timeout (`terminate()` kills an
 * infinite loop), then turns the raw engine result into the compact payload the
 * model receives (`sampleBacktest`, < 4 KB).
 */

import { sampleBacktest, type SampledBacktest } from './timelineSample';
import type { RunStrategyResponse } from './strategySandbox';
import type { BacktestSpec, NavPoint } from './backtestTypes';

export const STRATEGY_TIMEOUT_MS = 5000;

export interface StrategyRunRequest {
  nav: NavPoint[];
  spec: BacktestSpec;
  code: string;
}

export interface StrategyRunOptions {
  /** Label shown in the tool payload's `spec` field (defaults to describeSpec). */
  specLabel?: string;
  timeoutMs?: number;
}

export type StrategyRunResult = SampledBacktest | { error: string };

export async function runStrategyCode(
  request: StrategyRunRequest,
  options: StrategyRunOptions = {},
): Promise<StrategyRunResult> {
  const timeoutMs = options.timeoutMs ?? STRATEGY_TIMEOUT_MS;
  const worker = new Worker(new URL('./strategyWorker.ts', import.meta.url), { type: 'module' });
  try {
    const response = await new Promise<RunStrategyResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`策略代码执行超时（>${timeoutMs}ms），已终止`));
      }, timeoutMs);
      worker.addEventListener('message', (event: MessageEvent<RunStrategyResponse>) => {
        clearTimeout(timer);
        resolve(event.data);
      });
      worker.addEventListener('error', (event: ErrorEvent) => {
        clearTimeout(timer);
        reject(new Error(`策略代码执行失败：${event.message || 'worker error'}`));
      });
      worker.postMessage({ id: 1, payload: request });
    });
    if (!response.ok) return { error: response.error };
    return sampleBacktest(response.result, request.spec, { specLabel: options.specLabel });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    worker.terminate();
  }
}
