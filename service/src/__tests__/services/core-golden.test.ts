import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBacktest } from '../../../../packages/core/src/backtest/backtestEngine.js';
import { runPortfolioBacktest } from '../../../../packages/core/src/backtest/portfolioBacktest.js';
import { computeRiskMetricsLocal } from '../../../../packages/core/src/number.js';
import type { BacktestSpec, NavPoint } from '../../../../packages/core/src/backtest/backtestTypes.js';

/**
 * 黄金 fixtures 在 **service（Node 运行时）** 侧逐值复现。
 *
 * fixtures 由真实 Python 实现生成（`python/tests/gen_backtest_fixtures.py`，已冻结），
 * 前端测试也跑同一批。这里证明共享内核在 Node 上（tsx / 无打包器）结果一致 ——
 * P3「计算抽包」的核心验收：两边同源、同值。
 */
const FIXTURE_DIR = join(
  import.meta.dirname,
  '../../../../frontend/src/services/backtest/__fixtures__'
);

interface FixtureCase {
  name: string;
  input: {
    navHistory: NavPoint[];
    investmentType: string;
    amount?: number;
    initialAmount?: number;
    feeRate?: number;
    takeProfitRate?: number | null;
    stopLossRate?: number | null;
  };
  output: Record<string, unknown>;
}

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf-8')) as T;
}

function specFrom(input: FixtureCase['input']): BacktestSpec {
  return {
    period: input.investmentType as BacktestSpec['period'],
    amount: input.amount,
    initialAmount: input.initialAmount,
    feeRate: input.feeRate,
    takeProfitRate: input.takeProfitRate ?? null,
    stopLossRate: input.stopLossRate ?? null,
  };
}

describe('core golden fixtures (service/Node runtime)', () => {
  const cases = load<FixtureCase[]>('engine.json');

  it('covers every fixture case', () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
  });

  for (const testCase of cases) {
    it(`reproduces ${testCase.name}`, () => {
      expect(runBacktest(testCase.input.navHistory, specFrom(testCase.input))).toEqual(testCase.output);
    });
  }
});

describe('core portfolio engine (service/Node runtime)', () => {
  it('runs a single-asset portfolio and returns a summary', () => {
    const nav: NavPoint[] = Array.from({ length: 40 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      nav: 1 + i / 500,
    }));

    const outcome = runPortfolioBacktest(
      {
        assets: [{ kind: 'fund', fundCode: '110022', weight: 1 }],
        initialAmount: 10_000,
        feeRate: 0.0015,
        startDate: '2026-01-01',
        endDate: '2026-02-28',
      },
      { navByCode: { '110022': nav } }
    );

    expect('summary' in outcome).toBe(true);
  });
});

describe('core risk metrics (service/Node runtime)', () => {
  it('returns the five metric keys and stays null below the trading-day floor', () => {
    const short: NavPoint[] = Array.from({ length: 5 }, (_, i) => ({
      date: `2026-01-0${i + 1}`,
      nav: 1 + i / 100,
    }));
    expect(computeRiskMetricsLocal(short)).toEqual({
      max_drawdown_1y: null,
      sharpe_ratio_1y: null,
      sharpe_ratio_3y: null,
      volatility_1y: null,
      calmar_ratio_1y: null,
    });
  });
});
