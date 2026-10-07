/**
 * 服务端「自由代码回测」：把用户/AI 写的策略代码放进 `node:worker_threads` 跑。
 *
 * 流程（与前端 `services/backtest/runStrategyCode.ts` + `scriptRun.ts` 对齐）：
 *   1. worker `plan`：`prepare(sdk)` → 标的池 + 窗口（只读内存里的筛选池，不联网）
 *   2. 宿主取净值：`fetchNavPoints`（走 service 自己的 SQLite 净值缓存），按计划窗口裁剪
 *   3. worker `portfolio`：`onDay(s)` 逐日决策 → `runPortfolioBacktest` 完整结果
 *
 * 超时（默认 5s）后 `worker.terminate()` —— 死循环杀得掉。详见 `strategyWorker.ts` 的隔离说明。
 */
import { Worker } from 'node:worker_threads';
import {
  samplePortfolioBacktest,
  type SampledPortfolioBacktest,
} from '../../../packages/core/src/backtest/portfolioSample.js';
import type {
  NavPoint,
  PortfolioAsset,
  PortfolioBacktestResult,
  PortfolioSpec,
} from '../../../packages/core/src/backtest/backtestTypes.js';
import type {
  PlanRequestPayload,
  RunPortfolioStrategyPayload,
  ScreenRow,
  StrategyPlan,
} from '../../../packages/core/src/backtest/strategySandbox.js';
import { fetchNavPoints, clipNavPoints } from '../services/backtestService.js';
import { getScreenRows } from '../services/screeningService.js';

export const STRATEGY_TIMEOUT_MS = 5000;
/** 一次代码回测最多取多少只基金的净值（与前端 `MAX_FETCHES_PER_RUN` 同口径）。 */
export const MAX_FETCHES_PER_RUN = 60;
const NAV_CONCURRENCY = 6;

const CASH_RE = /^CASH(?::([\d.]+))?$/i;

type WorkerMessage =
  | { id: number; ok: true; plan: StrategyPlan }
  | { id: number; ok: true; result: PortfolioBacktestResult }
  | { id: number; ok: false; error: string };

/**
 * worker 文件与当前模块同后缀：开发期（tsx）磁盘上是 `.ts`，构建产物里是 `.js`。
 * 写死其中一个都会在另一种形态下找不到文件。
 */
function workerUrl(): URL {
  const ext = new URL(import.meta.url).pathname.endsWith('.ts') ? '.ts' : '.js';
  return new URL(`./strategyWorker${ext}`, import.meta.url);
}

/**
 * 在 worker 里跑一段（plan 或 portfolio），超时即 terminate。
 *
 * `execArgv` 只在 vitest 下加：开发期 worker 继承 tsx 的 loader（能直接加载 `.ts`），
 * 但 vitest 有自己的转换管线、worker 里没有，于是 worker 里的 `strategySandbox.js` 解析不了。
 * 生产（`node dist/...`）走的是 `.js`，本来就不需要 loader。
 */
const LOADER_ARGV = process.env.VITEST ? ['--import', 'tsx'] : [];

async function executeInWorker(
  kind: 'plan' | 'portfolio',
  payload: unknown,
  timeoutMs: number
): Promise<WorkerMessage> {
  const worker = new Worker(workerUrl(), LOADER_ARGV.length > 0 ? { execArgv: LOADER_ARGV } : {});
  try {
    return await new Promise<WorkerMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`策略代码执行超时（>${timeoutMs}ms），已终止`)), timeoutMs);
      worker.once('message', (message: WorkerMessage) => {
        clearTimeout(timer);
        resolve(message);
      });
      worker.once('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`策略代码执行失败：${error.message}`));
      });
      worker.postMessage({ id: 1, kind, payload });
    });
  } finally {
    void worker.terminate();
  }
}

function toError(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) };
}

/** `prepare(sdk)`：拿到标的池与窗口。 */
export async function planStrategyCode(
  code: string,
  screenRows: ScreenRow[],
  defaults?: { start: string; end: string },
  timeoutMs = STRATEGY_TIMEOUT_MS
): Promise<{ plan: StrategyPlan } | { error: string }> {
  try {
    const payload: PlanRequestPayload = { code, screenRows, defaults };
    const response = await executeInWorker('plan', payload, timeoutMs);
    if (!response.ok) return { error: response.error };
    return { plan: (response as { plan: StrategyPlan }).plan };
  } catch (error) {
    return toError(error);
  }
}

/** `onDay(s)`：在注入的净值上跑完整回测（返回未抽样结果）。 */
export async function runPortfolioStrategyCodeRaw(
  request: RunPortfolioStrategyPayload,
  timeoutMs = STRATEGY_TIMEOUT_MS
): Promise<{ result: PortfolioBacktestResult } | { error: string }> {
  try {
    const response = await executeInWorker('portfolio', request, timeoutMs);
    if (!response.ok) return { error: response.error };
    return { result: (response as { result: PortfolioBacktestResult }).result };
  } catch (error) {
    return toError(error);
  }
}

export function isCashEntry(entry: string): boolean {
  return CASH_RE.test(entry);
}

export function assetFromPlanEntry(entry: string): PortfolioAsset {
  const cash = CASH_RE.exec(entry);
  if (cash) return { kind: 'cash', name: '现金', annualRate: cash[1] ? Number(cash[1]) : 0, weight: 1 };
  return { kind: 'fund', fundCode: entry, weight: 1 };
}

export function portfolioSpecFromPlan(plan: StrategyPlan): PortfolioSpec {
  return {
    assets: plan.assets.map(assetFromPlanEntry),
    initialAmount: plan.initialAmount,
    feeRate: plan.feeRate,
  };
}

export interface RunOverrides {
  start_date?: string;
  end_date?: string;
  initial_amount?: number;
  fee_rate?: number;
}

function applyOverrides(plan: StrategyPlan, overrides: RunOverrides = {}): StrategyPlan {
  const start = overrides.start_date ? String(overrides.start_date).slice(0, 10) : plan.start;
  const end = overrides.end_date ? String(overrides.end_date).slice(0, 10) : plan.end;
  return {
    ...plan,
    start,
    end,
    initialAmount:
      overrides.initial_amount != null ? Math.max(0, Number(overrides.initial_amount) || 0) : plan.initialAmount,
    feeRate: overrides.fee_rate != null ? Math.max(0, Number(overrides.fee_rate)) : plan.feeRate,
  };
}

export interface PreparedStrategyRun {
  plan: StrategyPlan;
  spec: PortfolioSpec;
  navByCode: Record<string, NavPoint[]>;
  errors: Record<string, string>;
}

/** 阶段 1 + 2：跑 `prepare()`，再为声明的池取净值（限并发 + 每轮预算）。 */
export async function prepareStrategyRun(
  code: string,
  overrides: RunOverrides = {}
): Promise<PreparedStrategyRun | { error: string }> {
  const rows = getScreenRows() as unknown as ScreenRow[];
  const planned = await planStrategyCode(code, rows);
  if ('error' in planned) return planned;

  const plan = applyOverrides(planned.plan, overrides);
  const fundCodes = plan.assets.filter((entry) => !isCashEntry(entry));
  if (fundCodes.length > MAX_FETCHES_PER_RUN) {
    return { error: `声明的标的超过单轮上限 ${MAX_FETCHES_PER_RUN} 只（${fundCodes.length}）` };
  }

  const navByCode: Record<string, NavPoint[]> = {};
  const errors: Record<string, string> = {};
  const queue = [...fundCodes];
  const runWorker = async () => {
    for (;;) {
      const fundCode = queue.shift();
      if (fundCode === undefined) return;
      try {
        navByCode[fundCode] = clipNavPoints(await fetchNavPoints(fundCode, plan.start, plan.end), {
          startDate: plan.start,
          endDate: plan.end,
        });
        if (navByCode[fundCode].length === 0) errors[fundCode] = '净值序列为空';
      } catch (error) {
        errors[fundCode] = `净值获取失败：${error instanceof Error ? error.message : String(error)}`;
        navByCode[fundCode] = [];
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(NAV_CONCURRENCY, fundCodes.length) }, runWorker));

  const usable = fundCodes.filter((fundCode) => (navByCode[fundCode]?.length ?? 0) > 0);
  if (fundCodes.length > 0 && usable.length === 0) {
    const detail = Object.values(errors)[0];
    return {
      error: detail
        ? `未获取到任何标的的净值数据：${detail}`
        : `未获取到 ${plan.assets.join('、')} 在 ${plan.start} ~ ${plan.end} 的净值数据`,
    };
  }

  return { plan, spec: portfolioSpecFromPlan(plan), navByCode, errors };
}

/** 代码 → 完整回测结果（页面图表要每一天）。 */
export async function runStrategyCodeRaw(
  code: string,
  overrides: RunOverrides = {}
): Promise<{ result: PortfolioBacktestResult; plan: StrategyPlan; spec: PortfolioSpec } | { error: string }> {
  const prepared = await prepareStrategyRun(code, overrides);
  if ('error' in prepared) return prepared;
  const outcome = await runPortfolioStrategyCodeRaw({
    spec: prepared.spec,
    navByCode: prepared.navByCode,
    code,
    args: prepared.plan,
  });
  if ('error' in outcome) return outcome;
  return { result: outcome.result, plan: prepared.plan, spec: prepared.spec };
}

/** 代码 → 给模型读的紧凑结果（与旧聊天工具口径一致）。 */
export async function runStrategyCodeSampled(
  code: string,
  overrides: RunOverrides = {},
  specLabel = '自定义策略代码'
): Promise<SampledPortfolioBacktest | { error: string }> {
  const prepared = await prepareStrategyRun(code, overrides);
  if ('error' in prepared) return prepared;
  const outcome = await runPortfolioStrategyCodeRaw({
    spec: prepared.spec,
    navByCode: prepared.navByCode,
    code,
    args: prepared.plan,
  });
  if ('error' in outcome) return outcome;
  return samplePortfolioBacktest(outcome.result, prepared.spec, { specLabel });
}
