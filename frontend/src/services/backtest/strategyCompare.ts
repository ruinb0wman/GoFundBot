/**
 * Multi-strategy comparison behind the `compare_backtest_strategies` chat tool
 * (and `suggest_strategy`).
 *
 * Contract: `{ recommended: { key, name,
 * description, reason, summary }, strategies: [{ key, name, summary }] }`.
 * The old `/api/backtest/strategy-suggest` returned a single `{summary, timeline}`,
 * so the UI card read `undefined.name` — this module is what that endpoint never was.
 *
 * Ranking is deterministic (no LLM): Sharpe ratio first, then annual return. The
 * candidates differ in how much capital they deploy, so the reason text says so
 * instead of pretending the comparison is apples-to-apples.
 */

import { runBacktest } from './backtestEngine';
import { describeSpec } from './timelineSample';
import { normalizeSpec } from './strategyRules';
import { isBacktestResult, type BacktestFailure, type BacktestResult, type BacktestSpec } from './backtestTypes';

export interface StrategyEntry {
  key: string;
  name: string;
  description: string;
  spec: string;
  summary: BacktestResult['summary'];
}

export interface StrategyComparison {
  recommended: StrategyEntry & { reason: string };
  strategies: StrategyEntry[];
}

interface Candidate {
  key: string;
  name: string;
  description: string;
  spec: BacktestSpec;
}

function candidates(base: BacktestSpec): Candidate[] {
  const common = {
    amount: base.amount,
    initialAmount: 0,
    feeRate: base.feeRate,
    takeProfitRate: base.takeProfitRate ?? null,
    stopLossRate: base.stopLossRate ?? null,
  };
  return [
    {
      key: 'monthly',
      name: '每月定投',
      description: '每月固定日期投入固定金额，最省心的基准方案',
      spec: { ...common, period: 'monthly', day: base.day ?? null },
    },
    {
      key: 'weekly',
      name: '每周定投',
      description: '每周固定星期投入，摊薄更细、扣款更频繁',
      spec: { ...common, period: 'weekly' },
    },
    {
      key: 'lump_sum',
      name: '一次性投入',
      description: '期初一次性买入同等金额（资金占用最少，择时风险集中）',
      spec: { ...common, period: 'lump_sum' },
    },
    {
      key: 'value_averaging',
      name: '价值平均定投',
      description: '按目标市值补足差额：跌得多买得多，涨上去则少买或不买',
      spec: { ...common, period: 'monthly', day: base.day ?? null, rule: { type: 'value_averaging', targetGrowth: 0 } },
    },
    {
      key: 'ma_deviation',
      name: '均线偏离定投',
      description: '净值低于长期均线时加码、高于时减码（250 日均线，±50%）',
      spec: { ...common, period: 'monthly', day: base.day ?? null, rule: { type: 'ma_deviation', window: 250, factor: 0.5 } },
    },
  ];
}

export function compareStrategies(
  navHistory: { date: string; nav: number }[],
  base: BacktestSpec = {},
  options: { range?: string } = {},
): StrategyComparison | BacktestFailure {
  const normalizedBase = normalizeSpec(base);
  const entries: StrategyEntry[] = [];
  let lastError = '回测数据不足，无法比较策略';

  for (const candidate of candidates(normalizedBase)) {
    const result = runBacktest(navHistory, candidate.spec);
    if (!isBacktestResult(result)) {
      lastError = result.error;
      continue;
    }
    if (result.summary.total_invested <= 0 || result.timeline.length < 2) continue;
    entries.push({
      key: candidate.key,
      name: candidate.name,
      description: candidate.description,
      spec: describeSpec(normalizeSpec(candidate.spec)),
      summary: result.summary,
    });
  }

  if (entries.length === 0) return { error: lastError };

  entries.sort((a, b) => b.summary.sharpe_ratio - a.summary.sharpe_ratio || b.summary.annual_return - a.summary.annual_return);
  const best = entries[0];
  const caveat = entries.length > 1
    ? `各方案投入本金不同（${entries.map((e) => `${e.name} ${e.summary.total_invested} 元`).join('、')}），收益率不可直接横比，此处以夏普比率（风险调整后收益）排序。`
    : '仅一个方案可用，无法横向比较。';

  return {
    recommended: {
      ...best,
      reason: `${options.range ? `回测区间 ${options.range}。` : ''}${best.description}。区间年化 ${best.summary.annual_return}%、最大回撤 ${best.summary.max_drawdown}%、夏普 ${best.summary.sharpe_ratio}，为本次对比中最优。${caveat}`,
    },
    strategies: entries,
  };
}
