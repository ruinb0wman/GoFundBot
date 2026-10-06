/**
 * Dedicated worker that runs LLM-authored strategy code.
 *
 * This file is deliberately tiny: the real logic lives in `strategySandbox.ts` (pure,
 * unit-tested). The worker exists for exactly one reason — it can be **terminated**,
 * so an infinite loop in generated code cannot freeze the page.
 *
 * Lockdown (best effort, see plan §2.3): before any user code runs we shadow the
 * globals a strategy has no legitimate use for. This is not a hardened sandbox; the
 * user confirmation step is the actual trust boundary.
 */

import {
  handleRunPortfolioStrategyRequest,
  handleRunStrategyRequest,
  type RunPortfolioStrategyPayload,
  type RunStrategyPayload,
} from './strategySandbox';

const BLOCKED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'indexedDB',
  'caches',
  'importScripts',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'Notification',
  'navigator',
  'location',
];

for (const key of BLOCKED_GLOBALS) {
  try {
    Object.defineProperty(self, key, { value: undefined, configurable: false, writable: false });
  } catch {
    // Non-configurable host property — ignore; the user confirmation still gates execution.
  }
}

type WorkerRequest =
  | { id: number; kind: 'single'; payload: RunStrategyPayload }
  | { id: number; kind: 'portfolio'; payload: RunPortfolioStrategyPayload };

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { id, kind, payload } = event.data;
  const response = kind === 'portfolio'
    ? handleRunPortfolioStrategyRequest(payload as RunPortfolioStrategyPayload)
    : handleRunStrategyRequest(payload as RunStrategyPayload);
  self.postMessage({ id, ...response });
});
