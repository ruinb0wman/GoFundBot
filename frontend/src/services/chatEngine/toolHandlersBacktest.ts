/**
 * Backtest-family chat tool handlers.
 *
 * Split out of `toolHandlers.ts` (500-line cap) — merged back into the single handler
 * map there via spread. `run_strategy_code` runs a code module (fixed pool via
 * `prepare()`, per-day decisions via `onDay()`); the two saved-scheme tools let the
 * model list / save / re-run schemes created on the 「回测」 page.
 */

import { isBacktestResult, isPortfolioResult } from '../backtest/backtestTypes'
import { backtestFund, clipNavHistory, fetchNavHistory } from '../backtest/runBacktestForFund'
import { backtestPortfolio } from '../backtest/runPortfolioBacktest'
import { samplePortfolioBacktest } from '../backtest/portfolioSample'
import { compareStrategies } from '../backtest/strategyCompare'
import { sampleBacktest } from '../backtest/timelineSample'
import { runCodeSampled, runSavedScriptSampled, type RunOverrides } from '../backtest/scriptRun'
import { resolveDateRange, portfolioSpecFromToolArgs, specFromToolArgs, type PortfolioToolArgs, type ToolArgs } from '../backtest/toolArgs'
import { createStrategyScript, findStrategyScriptsByName, listStrategyScripts } from '../../db/strategyScripts'
import type { ToolContext } from './toolContext'

type ToolArgsRecord = Record<string, unknown>

/** Shared by `suggest_strategy` and `compare_backtest_strategies`. */
async function compareStrategiesTool(args: ToolArgsRecord) {
  const toolArgs = args as ToolArgs
  const { startDate, endDate } = resolveDateRange(toolArgs)
  try {
    const nav = clipNavHistory(await fetchNavHistory(String(toolArgs.fund_code ?? ''), startDate, endDate), {
      startDate,
      endDate,
    })
    const comparison = compareStrategies(
      nav,
      {
        ...specFromToolArgs(toolArgs),
        takeProfitRate: toolArgs.take_profit_rate ?? null,
        stopLossRate: toolArgs.stop_loss_rate ?? null,
      },
      { range: `${startDate} ~ ${endDate}` },
    )
    if ('error' in comparison) return { error: comparison.error }
    return {
      data_status: 'available',
      range: `${startDate} ~ ${endDate}`,
      recommended: {
        key: comparison.recommended.key,
        name: comparison.recommended.name,
        reason: comparison.recommended.reason,
        spec: comparison.recommended.spec,
        summary: comparison.recommended.summary,
      },
      strategies: comparison.strategies.map((s) => ({ key: s.key, name: s.name, spec: s.spec, summary: s.summary })),
    }
  } catch (error) {
    return { error: `策略对比失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

function overridesFromArgs(args: ToolArgsRecord): RunOverrides {
  return {
    start_date: args.start_date as string | undefined,
    end_date: args.end_date as string | undefined,
    initial_amount: args.initial_amount as number | undefined,
    fee_rate: args.fee_rate as number | undefined,
  }
}

export const backtestToolHandlers: Record<
  string,
  (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
> = {
  run_backtest: async (args) => {
    const request = {
      ...specFromToolArgs(args as ToolArgs),
      ...resolveDateRange(args as ToolArgs),
    };
    const outcome = await backtestFund(String(args.fund_code ?? ''), request);
    if (!isBacktestResult(outcome)) return { error: outcome.error };
    // Sampled on purpose: the raw 3-year timeline is ~150 KB and would be cut off by
    // truncateJson()'s 4000-char budget before the model could read it.
    return sampleBacktest(outcome, request);
  },

  run_portfolio_backtest: async (args) => {
    const { startDate, endDate } = resolveDateRange(args as ToolArgs)
    const spec = portfolioSpecFromToolArgs(args as PortfolioToolArgs)
    if (spec.assets.length < 2) {
      return { error: '至少需要 2 个资产（基金或现金）才能回测组合；单只基金请改用 run_backtest 或 run_strategy_code' }
    }
    const result = await backtestPortfolio({ ...spec, startDate, endDate })
    if (!isPortfolioResult(result)) return { error: result.error }
    return samplePortfolioBacktest(result, spec)
  },

  // User/LLM-authored strategy code. Runs only after the user approves (see
  // chatEngine/toolApproval.ts + ChatPanel's approval card). `script_name` re-runs a
  // scheme saved on the 「回测」 page instead of taking inline code.
  run_strategy_code: async (args) => {
    if (args.script_name) {
      const scripts = await findStrategyScriptsByName(String(args.script_name))
      if (scripts.length === 0) {
        return { error: `未找到名为「${args.script_name}」的方案，请先用 list_strategy_scripts 查看可用名称` }
      }
      if (scripts.length > 1) {
        return {
          error: `有 ${scripts.length} 个同名方案，请换用更精确的名称`,
          candidates: scripts.map((script) => ({ id: script.id, name: script.name })),
        }
      }
      return runSavedScriptSampled(scripts[0])
    }
    const code = String(args.code ?? '')
    if (!code.trim()) return { error: '请提供 code（策略模块）或 script_name（已保存方案）' }
    return runCodeSampled(code, overridesFromArgs(args))
  },

  suggest_strategy: async (args) => compareStrategiesTool(args),

  compare_backtest_strategies: async (args) => compareStrategiesTool(args),

  list_strategy_scripts: async () => {
    const scripts = await listStrategyScripts()
    return {
      count: scripts.length,
      scripts: scripts.map((script) => ({
        id: script.id,
        name: script.name,
        updated_at: new Date(script.updatedAt).toISOString(),
        last_run_at: script.lastRunAt ? new Date(script.lastRunAt).toISOString() : null,
        last_summary: script.lastSummary ?? null,
      })),
      note: '用 run_strategy_code 的 script_name 参数即可运行某个已保存方案（仍需用户确认）。',
    }
  },

  save_strategy_script: async (args) => {
    const name = String(args.name ?? '').trim()
    if (!name) return { error: '缺少 name（方案名称）' }
    const code = String(args.code ?? '')
    if (!code.trim()) return { error: '缺少 code（策略模块）' }
    const id = await createStrategyScript({ name, code, source: 'ai' })
    return { ok: true, id, name, note: '已保存到本机，用户可在「回测」页查看并运行。' }
  },
}
