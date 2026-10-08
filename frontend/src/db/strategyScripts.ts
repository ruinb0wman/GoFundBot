/**
 * 回测方案（策略代码）。
 *
 * Node 核心化（P2）后方案存在 service 的 SQLite（`strategy_scripts` 表）；
 * 本模块保留原导出签名，内部转发到 `services/userDataApi.ts`。
 *
 * 一条记录 = 一个可重放策略：代码本身就是全部配置（池/窗口/金额都写在 `prepare()` 里）。
 */
import type { StrategyScriptRecord } from '../types/records'
import type { BacktestSummary, PortfolioSummary } from '@gofund/core/backtest/backtestTypes'
import {
  createScriptApi,
  deleteScriptApi,
  getScriptApi,
  listScriptsApi,
  recordScriptRunApi,
  updateScriptApi,
  type StrategyScriptInput,
} from '../services/userDataApi'

export type { StrategyScriptRecord }
export type { StrategyScriptInput }

/** 所有方案，最近更新的在前（服务端已排序）。 */
export async function listStrategyScripts(): Promise<StrategyScriptRecord[]> {
  return listScriptsApi()
}

export async function getStrategyScript(id: number): Promise<StrategyScriptRecord | undefined> {
  return (await getScriptApi(id)) ?? undefined
}

/** 大小写不敏感的名称精确匹配；返回全部命中，交给调用方消歧。 */
export async function findStrategyScriptsByName(name: string): Promise<StrategyScriptRecord[]> {
  const needle = name.trim().toLowerCase()
  if (!needle) return []
  const all = await listScriptsApi()
  return all.filter((script) => script.name.trim().toLowerCase() === needle)
}

export async function createStrategyScript(input: StrategyScriptInput): Promise<number> {
  const created = await createScriptApi(input)
  return created.id
}

export async function updateStrategyScript(
  id: number,
  patch: Partial<Omit<StrategyScriptInput, 'source'>>,
): Promise<void> {
  await updateScriptApi(id, patch)
}

export async function deleteStrategyScript(id: number): Promise<void> {
  await deleteScriptApi(id)
}

export async function duplicateStrategyScript(id: number): Promise<number | undefined> {
  const source = await getStrategyScript(id)
  if (!source) return undefined
  return createStrategyScript({ name: `${source.name} 副本`, code: source.code, source: 'manual' })
}

/** Record the outcome of a run so the list can show "上次运行". */
export async function recordScriptRun(id: number, summary: BacktestSummary | PortfolioSummary): Promise<void> {
  await recordScriptRunApi(id, summary)
}
