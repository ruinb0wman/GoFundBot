/**
 * NAV series cache (IndexedDB via Dexie).
 *
 * NAV history is **append-only** (past points are not revised), so merging by date is
 * safe: union + de-dupe + sort. `firstDate`/`lastDate` track coverage so the broker can
 * answer "do we already have this window?" without scanning the array.
 */

import { db, type NavCacheEntry } from './index'
import type { NavPoint } from '../services/backtest/backtestTypes'

/** Union two series by date (duplicates: the newer fetch wins), ascending. */
export function mergeNavPoints(base: NavPoint[], incoming: NavPoint[]): NavPoint[] {
  const byDate = new Map<string, number>()
  for (const point of base) byDate.set(point.date, point.nav)
  for (const point of incoming) byDate.set(point.date, point.nav)
  return [...byDate.entries()]
    .map(([date, nav]) => ({ date, nav }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

export async function getNavEntry(code: string): Promise<NavCacheEntry | undefined> {
  return db.navHistory.get(code)
}

export async function readNavPoints(code: string): Promise<NavPoint[]> {
  return (await db.navHistory.get(code))?.points ?? []
}

/** Merge freshly fetched points into the cache and return the updated entry. */
export async function mergeNavEntry(
  code: string,
  incoming: NavPoint[],
  fetchedThrough: string,
): Promise<NavCacheEntry> {
  const existing = await db.navHistory.get(code)
  const points = mergeNavPoints(existing?.points ?? [], incoming ?? [])
  const through = [existing?.fetchedThrough ?? '', fetchedThrough].sort().pop() ?? fetchedThrough
  const entry: NavCacheEntry = {
    code,
    points,
    firstDate: points[0]?.date ?? '',
    lastDate: points[points.length - 1]?.date ?? '',
    fetchedThrough: through,
    updatedAt: Date.now(),
  }
  await db.navHistory.put(entry)
  return entry
}

export async function clearNavCache(): Promise<void> {
  await db.navHistory.clear()
}
