/**
 * Backtest run history (IndexedDB via Dexie).
 *
 * Only sampled checkpoints are persisted — a full 3-year daily timeline is
 * ~150 KB per run, and the engine can rebuild it from the spec + NAV data at any
 * time. What cannot be rebuilt is the *spec the user actually ran*, so that is what
 * we store, together with the compact summary and (Phase 2) any AI-authored
 * strategy source, so a past backtest stays replayable and auditable.
 */

import { db, type BacktestRunRecord } from './index'
import type { BacktestSpec, BacktestSummary } from '../services/backtest/backtestTypes'
import type { BacktestCheckpoint } from '../services/backtest/timelineSample'
import { specHash } from '../services/backtest/specHash'

export { specHash }

/** Runs kept per fund before the oldest are pruned. */
export const MAX_RUNS_PER_FUND = 10

export interface SaveBacktestRunInput {
  fundCode: string
  spec: BacktestSpec
  specLabel: string
  summary: BacktestSummary
  checkpoints: BacktestCheckpoint[]
  strategyCode?: string
}

export async function saveBacktestRun(input: SaveBacktestRunInput): Promise<number> {
  const record: BacktestRunRecord = {
    fundCode: input.fundCode,
    createdAt: Date.now(),
    specHash: specHash(input.spec),
    spec: input.spec,
    specLabel: input.specLabel,
    summary: input.summary,
    checkpoints: input.checkpoints,
    ...(input.strategyCode ? { strategyCode: input.strategyCode } : {}),
  }
  const id = await db.backtestRuns.add(record)
  await pruneBacktestRuns(input.fundCode)
  return id
}

export async function latestBacktestRun(fundCode: string): Promise<BacktestRunRecord | undefined> {
  const runs = await db.backtestRuns.where('fundCode').equals(fundCode).toArray()
  return runs.sort((a, b) => b.createdAt - a.createdAt)[0]
}

export async function findBacktestRun(fundCode: string, hash: string): Promise<BacktestRunRecord | undefined> {
  const runs = await db.backtestRuns.where('fundCode').equals(fundCode).toArray()
  return runs.find((run) => run.specHash === hash)
}

export async function pruneBacktestRuns(fundCode: string, keep = MAX_RUNS_PER_FUND): Promise<number> {
  const runs = (await db.backtestRuns.where('fundCode').equals(fundCode).toArray()).sort((a, b) => b.createdAt - a.createdAt)
  const stale = runs.slice(keep)
  if (stale.length === 0) return 0
  await db.backtestRuns.bulkDelete(stale.map((run) => run.id as number))
  return stale.length
}

export async function clearBacktestRuns(fundCode: string): Promise<number> {
  return db.backtestRuns.where('fundCode').equals(fundCode).delete()
}
