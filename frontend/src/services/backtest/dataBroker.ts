/**
 * Main-thread data broker for strategy-code backtests.
 *
 * NAV comes from the **service** (`/api/funds/:code/nav-history`), which keeps the series in
 * SQLite and answers any window from it — so this layer no longer does cache bookkeeping
 * (a NAV window used to be resolved from a Dexie table with its own coverage/freshness rules,
 * mirroring what the service now does once, centrally).
 *
 * Fetches stay bounded: one code at a time per worker slot, with a per-run budget so a
 * strategy that touches hundreds of codes cannot hammer the provider chain.
 */
import { screenRows as fetchScreenRowsFromServer } from '../../services/screeningRows'
import { fetchNavHistory, clipNavHistory } from './runBacktestForFund'
import type { NavPoint } from './backtestTypes'
import type { ScreenRow } from '@gofund/core/backtest/strategySandbox'

/** Hard cap on network fetches in one backtest run (protects the 300/15min rate limit). */
export const MAX_FETCHES_PER_RUN = 60;
const CONCURRENCY = 6;

export interface LoadNavResult {
  navByCode: Record<string, NavPoint[]>
  /** Number of codes we asked the service for. */
  fetched: number
  errors: Record<string, string>
}

/** Fund database projected to the fields `prepare(sdk).screen()` sees (service SQLite). */
export async function screenRows(): Promise<ScreenRow[]> {
  try {
    const rows = await fetchScreenRowsFromServer()
    return rows.map((fund) => ({
      code: String(fund.code ?? ''),
      name: String(fund.name ?? ''),
      type: (fund.type as string | null) ?? null,
      return_1y: fund.return_1y ?? null,
      sharpe_ratio_1y: fund.sharpe_ratio_1y ?? null,
      max_drawdown_1y: fund.max_drawdown_1y ?? null,
      nav_date: (fund.nav_date as string | null) ?? null,
    }))
  } catch {
    return []
  }
}

/**
 * Resolve NAV for every code with bounded concurrency and a per-run fetch budget.
 * Never throws: partial failures land in `errors` with an empty series.
 */
export async function loadNav(codes: string[], range: { start: string; end: string }): Promise<LoadNavResult> {
  const unique = [...new Set(codes.map((code) => code.trim()).filter(Boolean))]
  const navByCode: Record<string, NavPoint[]> = {}
  const errors: Record<string, string> = {}
  const clip = (points: NavPoint[]) => clipNavHistory(points, { startDate: range.start, endDate: range.end })
  let fetched = 0

  const queue = [...unique]
  const runWorker = async () => {
    for (;;) {
      const code = queue.shift()
      if (code === undefined) return
      if (fetched >= MAX_FETCHES_PER_RUN) {
        errors[code] = `单轮回测取数超过上限 ${MAX_FETCHES_PER_RUN}，已跳过`
        navByCode[code] = []
        continue
      }
      fetched += 1
      try {
        // 带上窗口：service 从 SQLite 按区间切片，不再白传整条序列（110022 全量 ≈ 300KB）。
        const points = await fetchNavHistory(code, range.start, range.end)
        if (points.length === 0) errors[code] = '净值序列为空'
        navByCode[code] = clip(points)
      } catch (error) {
        errors[code] = `净值获取失败：${error instanceof Error ? error.message : String(error)}`
        navByCode[code] = []
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, runWorker))
  return { navByCode, fetched, errors }
}
