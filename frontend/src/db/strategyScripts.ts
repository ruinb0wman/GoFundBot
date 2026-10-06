/**
 * Saved backtest schemes (IndexedDB via Dexie).
 *
 * One record = one replayable strategy: the code itself. Pool / window / amounts all
 * live in the code's `prepare()`, so there is no separate config to keep in sync.
 */

import { db, type StrategyScriptRecord } from './index'
import type { BacktestSummary, PortfolioSummary } from '../services/backtest/backtestTypes'

export type { StrategyScriptRecord }

export interface StrategyScriptInput {
  name: string
  code: string
  source?: 'manual' | 'ai'
}

/** All schemes, most recently updated first. */
export async function listStrategyScripts(): Promise<StrategyScriptRecord[]> {
  const all = await db.strategyScripts.toArray()
  return all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export async function getStrategyScript(id: number): Promise<StrategyScriptRecord | undefined> {
  return db.strategyScripts.get(id)
}

/** Case-insensitive name lookup. Returns every match so the caller can disambiguate. */
export async function findStrategyScriptsByName(name: string): Promise<StrategyScriptRecord[]> {
  const needle = name.trim().toLowerCase()
  if (!needle) return []
  const all = await db.strategyScripts.toArray()
  return all.filter((script) => script.name.trim().toLowerCase() === needle)
}

export async function createStrategyScript(input: StrategyScriptInput): Promise<number> {
  const now = Date.now()
  return db.strategyScripts.add({
    name: input.name.trim() || '未命名方案',
    code: input.code,
    source: input.source ?? 'manual',
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateStrategyScript(id: number, patch: Partial<Omit<StrategyScriptInput, 'source'>>): Promise<void> {
  await db.strategyScripts.update(id, {
    ...(patch.name !== undefined ? { name: patch.name.trim() || '未命名方案' } : {}),
    ...(patch.code !== undefined ? { code: patch.code } : {}),
    updatedAt: Date.now(),
  })
}

export async function deleteStrategyScript(id: number): Promise<void> {
  await db.strategyScripts.delete(id)
}

export async function duplicateStrategyScript(id: number): Promise<number | undefined> {
  const source = await getStrategyScript(id)
  if (!source) return undefined
  return createStrategyScript({ name: `${source.name} 副本`, code: source.code, source: 'manual' })
}

/** Record the outcome of a run so the list can show "上次运行". */
export async function recordScriptRun(id: number, summary: BacktestSummary | PortfolioSummary): Promise<void> {
  await db.strategyScripts.update(id, { lastRunAt: Date.now(), lastSummary: summary, updatedAt: Date.now() })
}
