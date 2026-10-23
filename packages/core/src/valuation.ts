/**
 * 估值分位：把一条 PE 历史序列换算成「当前分位 + 机会/中位/危险值」。
 *
 * 口径（加权/等权、窗口、频率）由**调用方**决定并写进 DTO 的 `definition` ——
 * 这里只做纯计算，同一个序列必须算出同一个数字（前端与 service 共用）。
 *
 * 为什么单独一个文件：分位数算法一旦两边各写一份，页面和工具就会给出两个数
 * （与 `number.ts` 的风险指标同款教训）。
 */

/** 少于这个点数不给分位：新指数（如科创50 只有 352 个周频点）够用，再短就是假精度。 */
export const MIN_VALUATION_POINTS = 30

/** 20/50/80 对应「机会 / 中位 / 危险」，这是分位值不是目标价。 */
export const VALUATION_BAND_QUANTILES = { opportunity: 0.2, median: 0.5, danger: 0.8 } as const

function finite(values: readonly number[]): number[] {
  return values.filter((val) => Number.isFinite(val))
}

/** 线性插值分位数，等价 Excel `PERCENTILE.INC`（numpy 默认插值）。 */
export function quantile(values: readonly number[], q: number): number | null {
  const sorted = finite(values).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const clamped = Math.min(1, Math.max(0, q))
  const pos = (sorted.length - 1) * clamped
  const lower = Math.floor(pos)
  const upper = Math.min(lower + 1, sorted.length - 1)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower)
}

/**
 * 当前值在序列中的分位：`count(v < current) / n`。
 * 并列值不取中点 —— 与蛋卷自带的 `pe_percentile` 同算法（沪深300 复现 0.496 vs 官方 0.498）。
 */
export function percentileRank(values: readonly number[], current: number): number | null {
  const series = finite(values)
  if (series.length === 0 || !Number.isFinite(current)) return null
  return series.filter((val) => val < current).length / series.length
}

export interface ValuationBands {
  /** 当前值在窗口内的分位（0..1）；点数不足为 null */
  percentile: number | null
  /** 窗口内 20% 分位值 */
  opportunity: number | null
  /** 窗口内 50% 分位值 */
  median: number | null
  /** 窗口内 80% 分位值 */
  danger: number | null
}

export function buildValuationBands(values: readonly number[], current: number): ValuationBands {
  const empty: ValuationBands = { percentile: null, opportunity: null, median: null, danger: null }
  const series = finite(values)
  if (series.length < MIN_VALUATION_POINTS || !Number.isFinite(current)) return empty

  return {
    percentile: percentileRank(series, current),
    opportunity: quantile(series, VALUATION_BAND_QUANTILES.opportunity),
    median: quantile(series, VALUATION_BAND_QUANTILES.median),
    danger: quantile(series, VALUATION_BAND_QUANTILES.danger),
  }
}
