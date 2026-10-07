/**
 * 策略代码沙箱的 worker 入口（Node 版，对应前端的 `frontend/src/services/backtest/strategyWorker.ts`）。
 *
 * 为什么还是要 worker：**只有它能被强制结束** —— AI 写的死循环不能把 service 拖死
 * （宿主在超时后 `worker.terminate()`）。真正的逻辑在 `packages/core/src/backtest/strategySandbox.ts`（纯函数、已单测）。
 *
 * 两种消息：
 *   - `plan`：编译模块 + 跑 `prepare(sdk)` → 声明标的池与窗口
 *   - `portfolio`：在注入的净值上逐日跑 `onDay(s)`（不联网）
 *
 * 隔离强度（实验 4 结论，2026-10-07）：
 * - 抹掉宿主全局后，用户代码里 `fetch` / `process`? / 存储类 API 都不可达；
 * - 但 `new Function` 里**关不掉动态 `import()`**（浏览器里那一段是语法错误，Node 不是）——
 *   也就是说这不是硬沙箱。信任边界仍是「用户确认后才执行」（`service/src/agent/confirm.ts`），
 *   本文件只负责「不误伤（无网络/无存储）+ 不死循环（宿主可 terminate）」。
 */
import { parentPort } from 'node:worker_threads';
import {
  handlePlanRequest,
  handleRunPortfolioStrategyRequest,
  type PlanRequestPayload,
  type RunPortfolioStrategyPayload,
} from '../../../packages/core/src/backtest/strategySandbox.js';

/** 与浏览器 worker 同一份清单（顺序也一致，便于两边对照）。 */
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
    Object.defineProperty(globalThis, key, { value: undefined, configurable: false, writable: false });
  } catch {
    // 宿主属性不可配置 —— 忽略（用户确认仍然挡在前面）。
  }
}

export type StrategyWorkerRequest =
  | { id: number; kind: 'plan'; payload: PlanRequestPayload }
  | { id: number; kind: 'portfolio'; payload: RunPortfolioStrategyPayload };

parentPort?.on('message', (event: StrategyWorkerRequest) => {
  const { id, kind, payload } = event ?? { id: 0, kind: 'plan', payload: {} as PlanRequestPayload };
  const response =
    kind === 'plan'
      ? handlePlanRequest(payload as PlanRequestPayload)
      : handleRunPortfolioStrategyRequest(payload as RunPortfolioStrategyPayload);
  parentPort?.postMessage({ id, ...response });
});
