/**
 * 数值格式化（展示用）——「计算」那一半已移到 `@gofund/core/number`（service 也用同一份指标）。
 *
 * 这里保留 `fmt*` / `*Class` 等纯展示函数，并**转出 core 的计算函数**，
 * 因此既有 `../utils/number` 引用（16 处）无需改动。
 */
import { Decimal } from 'decimal.js'
import { isFiniteNumber, isZero } from '@gofund/core/number'

export * from '@gofund/core/number'

export interface FmtPercentOptions {
  sign?: boolean
  fallback?: string
}

export function fmtPercent(
  val: unknown,
  options?: FmtPercentOptions
): string {
  const { sign = true, fallback = '--' } = options ?? {}
  if (!isFiniteNumber(val)) return fallback
  const num = val as number
  const formatted = new Decimal(num).toFixed(2)
  if (sign) {
    return `${num >= 0 ? '+' : ''}${formatted}%`
  }
  return `${formatted}%`
}

/**
 * 涨跌幅展示：优先用数值原始值格式化，数值缺失时才退回上游已格式化的字符串。
 *
 * 板块接口（`/api/market/sectors`、`/concept-sectors`）同时给 `change_pct`（字符串 `"+11.94%"`）
 * 与 `raw_change`（数值 `11.94`）；把字符串直接喂给 `fmtPercent` 会因 `isFiniteNumber` 的类型检查
 * 落到 `--`（2026-10-13 前端右侧涨跌幅整列显示 `--` 的原因）。
 */
export function fmtPercentPreferNumber(raw: unknown, text?: unknown, fallback = '--'): string {
  if (isFiniteNumber(raw)) return fmtPercent(raw)
  const preformatted = typeof text === 'string' ? text.trim() : ''
  return preformatted || fallback
}

export function fmtNumber(
  val: unknown,
  decimals = 2
): string {
  if (!isFiniteNumber(val)) return '--'
  return new Decimal(val as number).toFixed(decimals)
}

export function fmtMoney(val: unknown, decimals = 2): string {
  if (!isFiniteNumber(val)) return '--'
  return new Decimal(val as number).toFixed(decimals)
}

export function fmtAmountYi(val: unknown): string {
  if (!isFiniteNumber(val)) return '--'
  return `${new Decimal(val as number).div(100000000).toFixed(2)}亿`
}

export function fmtChange(val: unknown): string {
  if (!isFiniteNumber(val)) return '-'
  const num = val as number
  const formatted = new Decimal(num).toFixed(2)
  return `${num >= 0 ? '+' : ''}${formatted}%`
}

export function fmtRatio(val: unknown, decimals = 4): string {
  if (!isFiniteNumber(val)) return '--'
  return new Decimal(val as number).toFixed(decimals)
}

export function fmtDrawdown(val: unknown, decimals = 2): string {
  if (!isFiniteNumber(val)) return '--'
  return `-${new Decimal(val as number).toFixed(decimals)}%`
}

export function returnClass(val: unknown): string {
  if (!isFiniteNumber(val)) return ''
  const num = val as number
  if (isZero(num)) return ''
  return num > 0 ? 'positive' : 'negative'
}

export function sharpeClass(val: unknown): string {
  if (!isFiniteNumber(val)) return ''
  const num = val as number
  if (num >= 1) return 'positive'
  if (num >= 0.5) return ''
  return 'negative'
}

export function scoreClass(val: unknown): string {
  if (!isFiniteNumber(val)) return ''
  const num = val as number
  if (num >= 80) return 'score-high'
  if (num >= 60) return 'score-mid'
  return 'score-low'
}
