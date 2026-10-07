/**
 * 基金筛选富化 —— 4433 排名的**唯一实现**（原前端 `useScreeningDb.ts` 的逐行移植）。
 *
 * 语义（不要随手改，改了筛选页面数字就变）：
 * 1. 按 `fund_type`（缺省 `(untyped)`）分组；
 * 2. 组内 < 3 只 → 全部排名置 null、`pass_4433 = 0`；
 * 3. 每个周期在**有该周期收益**的样本里按收益降序算百分位 `i / n * 100`；
 *    该周期有效样本 < 3 → 该周期排名保持 null；
 * 4. `check4433Rule` 判定：近 1 年 ≤ 25%、且（近 2 年 ≤ 25% 或 近 3 年 ≤ 25%）、近 6 月 ≤ 33.33%、近 3 月 ≤ 33.33%。
 */
export const RANK_PERIODS = ['1m', '3m', '6m', '1y', '2y', '3y'] as const

export type RankPeriod = (typeof RANK_PERIODS)[number]

export interface ScreeningRankRow {
  fund_type?: string | null
  return_1m?: number | null
  return_3m?: number | null
  return_6m?: number | null
  return_1y?: number | null
  return_2y?: number | null
  return_3y?: number | null
  rank_pct_1m?: number | null
  rank_pct_3m?: number | null
  rank_pct_6m?: number | null
  rank_pct_1y?: number | null
  rank_pct_2y?: number | null
  rank_pct_3y?: number | null
  pass_4433?: number
}

export interface RankRanks {
  rank_pct_1y: number | null
  rank_pct_2y: number | null
  rank_pct_3y: number | null
  rank_pct_6m: number | null
  rank_pct_3m: number | null
}

function toFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getReturn(row: ScreeningRankRow, period: RankPeriod): number | null {
  switch (period) {
    case '1m': return toFinite(row.return_1m)
    case '3m': return toFinite(row.return_3m)
    case '6m': return toFinite(row.return_6m)
    case '1y': return toFinite(row.return_1y)
    case '2y': return toFinite(row.return_2y)
    case '3y': return toFinite(row.return_3y)
    default: return null
  }
}

function setRank(row: ScreeningRankRow, period: RankPeriod, value: number | null): void {
  switch (period) {
    case '1m': row.rank_pct_1m = value; break
    case '3m': row.rank_pct_3m = value; break
    case '6m': row.rank_pct_6m = value; break
    case '1y': row.rank_pct_1y = value; break
    case '2y': row.rank_pct_2y = value; break
    case '3y': row.rank_pct_3y = value; break
  }
}

/** 就地为每行写入 `rank_pct_*` 与 `pass_4433`。 */
export function computeScreeningRanks(rows: ScreeningRankRow[]): void {
  const groups = new Map<string, ScreeningRankRow[]>()
  for (const row of rows) {
    const key = row.fund_type || '(untyped)'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }

  for (const [, group] of groups) {
    if (group.length < 3) {
      for (const row of group) {
        for (const period of RANK_PERIODS) setRank(row, period, null)
        row.pass_4433 = 0
      }
      continue
    }

    for (const period of RANK_PERIODS) {
      const withReturn = group
        .map((row) => ({ row, ret: getReturn(row, period) }))
        .filter((entry): entry is { row: ScreeningRankRow; ret: number } => entry.ret !== null)

      if (withReturn.length < 3) continue

      withReturn.sort((a, b) => b.ret - a.ret)
      const total = withReturn.length
      for (let i = 0; i < total; i++) {
        setRank(withReturn[i].row, period, (i / total) * 100)
      }
    }

    for (const row of group) {
      row.pass_4433 = check4433Rule({
        rank_pct_1y: row.rank_pct_1y ?? null,
        rank_pct_2y: row.rank_pct_2y ?? null,
        rank_pct_3y: row.rank_pct_3y ?? null,
        rank_pct_6m: row.rank_pct_6m ?? null,
        rank_pct_3m: row.rank_pct_3m ?? null,
      })
        ? 1
        : 0
    }
  }
}

export function check4433Rule(ranks: RankRanks): boolean {
  if (ranks.rank_pct_1y == null || ranks.rank_pct_1y > 25) return false
  const longTermPass =
    (ranks.rank_pct_2y != null && ranks.rank_pct_2y <= 25) ||
    (ranks.rank_pct_3y != null && ranks.rank_pct_3y <= 25)
  if (!longTermPass) return false
  if (ranks.rank_pct_6m == null || ranks.rank_pct_6m > 33.33) return false
  if (ranks.rank_pct_3m == null || ranks.rank_pct_3m > 33.33) return false
  return true
}
