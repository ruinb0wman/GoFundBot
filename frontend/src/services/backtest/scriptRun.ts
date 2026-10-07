/**
 * Code + overrides → full backtest result.
 *
 * Flow (no async engine, no RPC — the pool is fixed by `prepare()`):
 *   1. `prepare(sdk)` in the Worker → declared pool, window, amounts (local data only)
 *   2. DataBroker resolves NAV for the pool, Dexie-first
 *   3. `onDay(s)` per trading day in the Worker over the injected NAV (sync)
 *
 * Shared by the workspace page and the `run_strategy_code(script_name)` tool.
 */

import { samplePortfolioBacktest, type SampledPortfolioBacktest } from '@gofund/core/backtest/portfolioSample'
import { planStrategyCode, runPortfolioStrategyCodeRaw } from './runStrategyCode'
import { loadNav, screenRows } from './dataBroker'
import type { NavPoint, PortfolioAsset, PortfolioBacktestResult, PortfolioSpec } from './backtestTypes'
import type { StrategyPlan } from '@gofund/core/backtest/strategySandbox'
import type { StrategyScriptRecord } from '../../db/strategyScripts'

/** Optional host overrides applied on top of what `prepare()` declared (LLM tool args). */
export interface RunOverrides {
  start_date?: string
  end_date?: string
  initial_amount?: number
  fee_rate?: number
}

const CASH_RE = /^CASH(?::([\d.]+))?$/i

export function isCashEntry(entry: string): boolean {
  return CASH_RE.test(entry)
}

export function assetFromPlanEntry(entry: string): PortfolioAsset {
  const cash = CASH_RE.exec(entry)
  if (cash) return { kind: 'cash', name: '现金', annualRate: cash[1] ? Number(cash[1]) : 0, weight: 1 }
  return { kind: 'fund', fundCode: entry, weight: 1 }
}

export function portfolioSpecFromPlan(plan: StrategyPlan): PortfolioSpec {
  return {
    assets: plan.assets.map(assetFromPlanEntry),
    initialAmount: plan.initialAmount,
    feeRate: plan.feeRate,
  }
}

function applyOverrides(plan: StrategyPlan, overrides: RunOverrides = {}): StrategyPlan {
  const start = overrides.start_date ? String(overrides.start_date).slice(0, 10) : plan.start
  const end = overrides.end_date ? String(overrides.end_date).slice(0, 10) : plan.end
  return {
    ...plan,
    start,
    end,
    initialAmount: overrides.initial_amount != null ? Math.max(0, Number(overrides.initial_amount) || 0) : plan.initialAmount,
    feeRate: overrides.fee_rate != null ? Math.max(0, Number(overrides.fee_rate)) : plan.feeRate,
  }
}

export interface PreparedStrategyRun {
  plan: StrategyPlan
  spec: PortfolioSpec
  navByCode: Record<string, NavPoint[]>
  /** Per-code data problems (partial failures do not abort the run). */
  errors: Record<string, string>
}

export type PrepareRunResult = PreparedStrategyRun | { error: string }

/** Phase 1 + 2: run `prepare()`, then resolve NAV for the declared pool. */
export async function prepareRun(code: string, overrides: RunOverrides = {}): Promise<PrepareRunResult> {
  const rows = await screenRows()
  const planned = await planStrategyCode(code, rows)
  if ('error' in planned) return planned
  const plan = applyOverrides(planned.plan, overrides)
  const fundCodes = plan.assets.filter((entry) => !isCashEntry(entry))
  const { navByCode, errors } = await loadNav(fundCodes, { start: plan.start, end: plan.end })
  const usable = fundCodes.filter((fundCode) => (navByCode[fundCode]?.length ?? 0) > 0)
  if (usable.length === 0) {
    const detail = Object.values(errors)[0]
    return {
      error: detail
        ? `未获取到任何标的的净值数据：${detail}`
        : `未获取到 ${plan.assets.join('、')} 在 ${plan.start} ~ ${plan.end} 的净值数据`,
    }
  }
  return { plan, spec: portfolioSpecFromPlan(plan), navByCode, errors }
}

export type ScriptRunOutcome = { result: PortfolioBacktestResult } | { error: string }

async function executePrepared(prepared: PreparedStrategyRun, code: string, label: string) {
  return runPortfolioStrategyCodeRaw(
    { spec: prepared.spec, navByCode: prepared.navByCode, code, args: prepared.plan },
    { specLabel: label },
  )
}

/** Full (unsampled) result — the workspace page needs every day for its charts. */
export async function runScript(code: string, overrides: RunOverrides = {}): Promise<ScriptRunOutcome> {
  const prepared = await prepareRun(code, overrides)
  if ('error' in prepared) return prepared
  const outcome = await executePrepared(prepared, code, '自定义策略代码')
  if ('error' in outcome) return outcome
  return { result: outcome.result }
}

/** Compact payload for the chat model (inline code). */
export async function runCodeSampled(
  code: string,
  overrides: RunOverrides = {},
): Promise<SampledPortfolioBacktest | { error: string }> {
  const prepared = await prepareRun(code, overrides)
  if ('error' in prepared) return prepared
  const outcome = await executePrepared(prepared, code, '自定义策略代码')
  if ('error' in outcome) return outcome
  return samplePortfolioBacktest(outcome.result, prepared.spec, { specLabel: '自定义策略代码' })
}

/** Run a saved scheme and return the compact payload the chat model reads. */
export async function runSavedScriptSampled(
  script: StrategyScriptRecord,
): Promise<SampledPortfolioBacktest | { error: string }> {
  const prepared = await prepareRun(script.code)
  if ('error' in prepared) return prepared
  const outcome = await executePrepared(prepared, script.code, script.name)
  if ('error' in outcome) return outcome
  return samplePortfolioBacktest(outcome.result, prepared.spec, { specLabel: script.name })
}
