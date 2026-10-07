/**
 * 策略沙箱 `prepare(sdk).screen()` 的基金池 —— P3.3 起来自 service SQLite
 * （`GET /api/screening/screen-rows`，就是 core `ScreenRow` 的 7 列）。
 *
 * 进程内缓存 10 分钟：一次代码回测里可能多次 `screen()`，没必要反复拉 ~250KB。
 */
import { screeningAPI } from './api'

export interface ScreenRowDto {
  code: string
  name: string
  type: string | null
  return_1y: number | null
  sharpe_ratio_1y: number | null
  max_drawdown_1y: number | null
  nav_date: string | null
}

const TTL_MS = 10 * 60 * 1000
let cache: { rows: ScreenRowDto[]; at: number } | null = null

export async function screenRows(): Promise<ScreenRowDto[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows
  const res = await screeningAPI.getScreenRows()
  const body = res.data as { data?: { items?: ScreenRowDto[] } } | undefined
  const rows = body?.data?.items ?? []
  cache = { rows, at: Date.now() }
  return rows
}

export function clearScreenRowsCache(): void {
  cache = null
}
