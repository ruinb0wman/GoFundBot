/**
 * Compact LLM payload for a portfolio backtest (mirrors `timelineSample.sampleBacktest`).
 *
 * Split from `portfolioBacktest.ts` (the engine) to keep both files under the
 * 500-line lint cap, and because this layer is presentation-shaped: the engine owns
 * accounting, this owns what the model gets to see.
 */

import { sampleTimeline, type BacktestCheckpoint } from './timelineSample';
import type { PortfolioBacktestResult, PortfolioSpec, PortfolioSummary, RebalanceFrequency } from './backtestTypes';

export interface SampledPortfolioAsset {
  code: string;
  kind: 'fund' | 'cash';
  target_pct: number;
  final_pct: number;
  return_pct: number;
}

export interface SampledPortfolioBacktest {
  summary: PortfolioSummary;
  spec: string;
  /** Compact rows — the page renders the full `result.assets`, the model only needs these. */
  assets: SampledPortfolioAsset[];
  checkpoints: BacktestCheckpoint[];
  checkpoints_omitted: number;
  effective_start: string;
  effective_end: string;
  excluded: { code: string; reason: string }[];
  note: string;
}

/**
 * `truncateJson` pretty-prints (`JSON.stringify(value, null, 2)`) and hard-cuts at
 * 4000 chars, which produces *invalid JSON* — the exact regression the single-fund
 * `sampleBacktest` was written to avoid. A portfolio payload is bigger (per-asset
 * rows on top of the checkpoints), so we compact the asset rows and shrink the
 * checkpoint count until it fits.
 */
const MAX_PAYLOAD_CHARS = 3800;
const INITIAL_CHECKPOINTS = 12;
const MIN_CHECKPOINTS = 4;

function assemblePortfolioPayload(
  result: PortfolioBacktestResult,
  spec: PortfolioSpec,
  maxCheckpoints: number,
  specLabel?: string,
): SampledPortfolioBacktest {
  const checkpoints = sampleTimeline(result.timeline, maxCheckpoints);
  return {
    summary: result.summary,
    spec: specLabel ?? describePortfolioSpec(spec),
    assets: result.assets.map((asset) => ({
      code: asset.code,
      kind: asset.kind,
      target_pct: asset.targetWeight,
      final_pct: asset.finalWeight,
      return_pct: asset.return_rate,
    })),
    checkpoints,
    checkpoints_omitted: result.timeline.length - checkpoints.length,
    effective_start: result.effective_start,
    effective_end: result.effective_end,
    excluded: result.excluded,
    note: result.note,
  };
}

export function samplePortfolioBacktest(
  result: PortfolioBacktestResult,
  spec: PortfolioSpec,
  options: { maxCheckpoints?: number; specLabel?: string } = {},
): SampledPortfolioBacktest {
  let count = options.maxCheckpoints ?? INITIAL_CHECKPOINTS;
  let payload = assemblePortfolioPayload(result, spec, count, options.specLabel);
  while (count > MIN_CHECKPOINTS && JSON.stringify({ ok: true, data: payload }, null, 2).length > MAX_PAYLOAD_CHARS) {
    count = Math.max(MIN_CHECKPOINTS, count - 2);
    payload = assemblePortfolioPayload(result, spec, count, options.specLabel);
  }
  return payload;
}

/** One-line description for tool output and the page. */
export function describePortfolioSpec(spec: PortfolioSpec): string {
  const assets = (spec.assets ?? [])
    .filter((a) => Number(a.weight) > 0)
    .map((a) => (a.kind === 'cash' ? `现金 ${a.weight}` : `${(a as { fundCode: string }).fundCode} ${a.weight}`))
    .join(' / ');
  const parts = [`资产 ${assets}`];
  if (spec.initialAmount) parts.push(`期初 ${spec.initialAmount} 元`);
  if (spec.contribution && spec.contribution.amount > 0) {
    const label: Record<RebalanceFrequency, string> = { none: '不注水', monthly: '每月', quarterly: '每季', yearly: '每年' };
    parts.push(`${label[spec.contribution.period]}注水 ${spec.contribution.amount} 元`);
  }
  if (spec.rebalance && spec.rebalance.frequency !== 'none') {
    const label: Record<RebalanceFrequency, string> = { none: '不再平衡', monthly: '每月', quarterly: '每季', yearly: '每年' };
    parts.push(`${label[spec.rebalance.frequency]}再平衡`);
  }
  if (spec.rebalance?.threshold != null) parts.push(`偏离 ${(spec.rebalance.threshold * 100).toFixed(1)}pp 触发`);
  return parts.join('，');
}
