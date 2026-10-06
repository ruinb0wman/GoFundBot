/**
 * Main-thread data broker for strategy-code backtests.
 *
 * Policy: **Dexie first**. A NAV window is served from the `navHistory` cache when it
 * is covered and fresh; otherwise the series is fetched and merged back. Fetches use a
 * **stable range** (full history, no query params) because the service cache key
 * includes the range and every provider downloads full history before slicing — asking
 * for a "tail" would miss the cache and trigger another full download.
 *
 * Coverage is tracked with `fetchedThrough` ("we last fetched through this date"), not
 * `lastDate`: NAV only exists on trading days, so a cache ending on the last trading day
 * (e.g. before a holiday) is still complete for a window ending "today".
 */

import { db } from '../../db'
import { getNavEntry, mergeNavEntry } from '../../db/navCache'
import { fetchNavHistory, clipNavHistory } from './runBacktestForFund'
import type { NavPoint } from './backtestTypes'
import type { ScreenRow } from './strategySandbox'

export const NAV_TTL_MS = 24 * 60 * 60 * 1000;
/** Hard cap on network fetches in one backtest run (protects the 300/15min rate limit). */
export const MAX_FETCHES_PER_RUN = 60;
const CONCURRENCY = 6;

export interface LoadNavResult {
  navByCode: Record<string, NavPoint[]>
  /** Number of codes that needed a network fetch. */
  fetched: number
  /** Number of codes served entirely from the cache. */
  hits: number
  errors: Record<string, string>
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Local fund database projected to the fields `prepare(sdk).screen()` sees. */
export async function screenRows(): Promise<ScreenRow[]> {
  try {
    const funds = await db.screeningFunds.toArray()
    return funds.map((fund) => ({
      code: fund.fund_code,
      name: fund.fund_name,
      type: fund.fund_type,
      return_1y: fund.return_1y,
      sharpe_ratio_1y: fund.sharpe_ratio_1y,
      max_drawdown_1y: fund.max_drawdown_1y,
      nav_date: fund.nav_date,
    }))
  } catch {
    return []
  }
}

/** Can this cached entry answer `[start, end]` without a fetch? */
export function isFresh(
  entry: { firstDate: string; fetchedThrough: string; updatedAt: number },
  range: { start: string; end: string },
  todayStr: string = today(),
): boolean {
  const target = range.end < todayStr ? range.end : todayStr
  // Missing marker = legacy entry → treat as stale so it gets a `fetchedThrough`.
  // `firstDate` is deliberately NOT checked: we always fetch full history, and a fund
  // younger than the window simply has no earlier data to get.
  if (!entry.fetchedThrough || entry.fetchedThrough < target) return false
  // The window ends before the last fetch → the data can never change again.
  if (range.end < entry.fetchedThrough) return true
  return Date.now() - entry.updatedAt < NAV_TTL_MS
}

/**
 * Resolve NAV for every code, cache-first, with bounded concurrency and a per-run
 * fetch budget. Never throws: partial failures land in `errors` with empty series.
 */
export async function loadNav(codes: string[], range: { start: string; end: string }): Promise<LoadNavResult> {
  const unique = [...new Set(codes.map((code) => code.trim()).filter(Boolean))]
  const navByCode: Record<string, NavPoint[]> = {}
  const errors: Record<string, string> = {}
  const todayStr = today()
  const clip = (points: NavPoint[]) => clipNavHistory(points, { startDate: range.start, endDate: range.end })
  let fetched = 0
  let hits = 0

  const queue = [...unique]
  const runWorker = async () => {
    for (;;) {
      const code = queue.shift()
      if (code === undefined) return
      const entry = await getNavEntry(code)
      if (entry && isFresh(entry, range, todayStr)) {
        navByCode[code] = clip(entry.points)
        hits += 1
        continue
      }
      if (fetched >= MAX_FETCHES_PER_RUN) {
        errors[code] = `单轮回测取数超过上限 ${MAX_FETCHES_PER_RUN}，已跳过`
        navByCode[code] = entry ? clip(entry.points) : []
        continue
      }
      fetched += 1
      try {
        const points = await fetchNavHistory(code)
        const merged = await mergeNavEntry(code, points, todayStr)
        navByCode[code] = clip(merged.points)
      } catch (error) {
        errors[code] = `净值获取失败：${error instanceof Error ? error.message : String(error)}`
        navByCode[code] = entry ? clip(entry.points) : []
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, runWorker))
  return { navByCode, fetched, hits, errors }
}
