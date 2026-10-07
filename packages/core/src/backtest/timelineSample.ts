/**
 * Compact backtest payload for LLM tool results.
 *
 * The chat loop wraps every tool result in `truncateJson(envelope)` with a 4000
 * character budget (chatEngine/toolLoop.ts:137) — a 3-year daily timeline is
 * ~148 KB, so the model used to receive a pretty-printed fragment cut mid-object.
 * Sampling keeps the answer complete and bounded: the full timeline stays in the
 * UI, the model gets the summary plus evenly spaced checkpoints.
 *
 * Budget: ~16 checkpoint records × ~130 pretty-printed chars + summary ≈ 3 KB.
 */

import type { BacktestResult, BacktestSpec, BacktestTimelineRecord } from './backtestTypes.js';
import { describeRule, normalizeSpec, type NormalizedSpec } from './strategyRules.js';

const MAX_SAMPLE = 16;

export interface BacktestCheckpoint {
  date: string;
  value: number;
  invested: number;
  return_rate: number;
  is_investment_day?: boolean;
  status?: 'sold';
}

export interface SampledBacktest {
  summary: BacktestResult['summary'] & { buy_count: number };
  spec: string;
  checkpoints: BacktestCheckpoint[];
  checkpoints_omitted: number;
  note: string;
}

function toCheckpoint(record: BacktestTimelineRecord): BacktestCheckpoint {
  const point: BacktestCheckpoint = {
    date: record.date,
    value: record.value,
    invested: record.invested,
    return_rate: record.return_rate,
  };
  if (record.is_investment_day) point.is_investment_day = true;
  if (record.status === 'sold') point.status = 'sold';
  return point;
}

/**
 * Evenly spaced checkpoints, always including the first and last day and any
 * exit day. Investment days are preferred when there is room.
 */
export function sampleTimeline(timeline: BacktestTimelineRecord[], max = MAX_SAMPLE): BacktestCheckpoint[] {
  if (timeline.length <= max) return timeline.map(toCheckpoint);

  const exitIndex = timeline.findIndex((r) => r.status === 'sold');
  const picked = new Set<number>([0, timeline.length - 1]);
  if (exitIndex >= 0) picked.add(exitIndex);

  // Fill the remaining slots with investment days first, then monthly-ish strides.
  const investmentIndexes = timeline.map((r, i) => (r.is_investment_day ? i : -1)).filter((i) => i >= 0);
  const stride = Math.max(1, Math.floor(investmentIndexes.length / Math.max(1, max - picked.size)));
  for (let k = 0; k < investmentIndexes.length && picked.size < max; k += stride) {
    picked.add(investmentIndexes[k]);
  }
  const step = Math.max(1, Math.floor(timeline.length / max));
  for (let i = 0; i < timeline.length && picked.size < max; i += step) picked.add(i);

  return [...picked].sort((a, b) => a - b).map((i) => toCheckpoint(timeline[i]));
}

export function sampleBacktest(
  result: BacktestResult,
  spec: BacktestSpec | NormalizedSpec,
  options: { specLabel?: string } = {},
): SampledBacktest {
  const normalized = normalizeSpec(spec); // idempotent on an already-normalized spec
  const checkpoints = sampleTimeline(result.timeline);
  const buyCount = result.timeline.filter((r) => r.is_investment_day).length
    + (normalized.initialAmount > 0 ? 1 : 0);

  return {
    summary: { ...result.summary, buy_count: buyCount },
    spec: options.specLabel ?? describeSpec(normalized),
    checkpoints,
    checkpoints_omitted: result.timeline.length - checkpoints.length,
    note: [
      `checkpoints 为抽样（共 ${result.timeline.length} 个交易日，省略 ${result.timeline.length - checkpoints.length} 个），完整净值曲线请在「定投回测」页查看。`,
      `investment_count=${result.summary.investment_count} 是按计划扣款次数计（含清仓后的空档）；实际买入 ${buyCount} 次。`,
      '所有金额单位为元，收益率为百分比。',
    ].join(''),
  };
}

/** One-line spec description for prompts and tool output. */
export function describeSpec(spec: NormalizedSpec): string {
  const periodText: Record<NormalizedSpec['period'], string> = {
    monthly: spec.day ? `每月 ${spec.day} 号` : '每月首交易日',
    weekly: spec.day != null ? `每周${['一', '二', '三', '四', '五'][spec.day] ?? spec.day}` : '每周首交易日',
    daily: '每个交易日',
    lump_sum: '一次性买入',
  };
  const parts = [
    `${periodText[spec.period]}投入 ${spec.amount} 元`,
    describeRule(spec.rule),
    `手续费 ${(spec.feeRate * 100).toFixed(4).replace(/\.?0+$/, '')}%`,
  ];
  if (spec.initialAmount > 0) parts.splice(1, 0, `初始资金 ${spec.initialAmount} 元`);
  if (spec.takeProfitRate) parts.push(`止盈 ${(spec.takeProfitRate * 100).toFixed(2)}%`);
  if (spec.stopLossRate) parts.push(`止损 ${(spec.stopLossRate * 100).toFixed(2)}%`);
  return parts.join('，');
}
