import { describe, expect, it } from 'vitest';
import {
  MIN_VALUATION_POINTS,
  buildValuationBands,
  percentileRank,
  quantile,
} from '../../../../packages/core/src/valuation.js';
import { sh300PeSeries } from '../fixtures/danjuan-pe.js';

describe('quantile（线性插值，等价 PERCENTILE.INC）', () => {
  const oneToTen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('interpolates between neighbours', () => {
    expect(quantile(oneToTen, 0.2)).toBeCloseTo(2.8, 10);
    expect(quantile(oneToTen, 0.5)).toBeCloseTo(5.5, 10);
    expect(quantile(oneToTen, 0.8)).toBeCloseTo(8.2, 10);
  });

  it('does not require a sorted input', () => {
    expect(quantile([10, 1, 5, 3, 8, 2, 9, 4, 7, 6], 0.5)).toBeCloseTo(5.5, 10);
  });

  it('clamps q and handles tiny / empty series', () => {
    expect(quantile([4], 0.9)).toBe(4);
    expect(quantile([4], -1)).toBe(4);
    expect(quantile([], 0.5)).toBeNull();
  });

  it('ignores non-finite values', () => {
    expect(quantile([1, Number.NaN, 3], 0.5)).toBe(2);
  });
});

describe('percentileRank（count(v < current) / n，并列不取中点）', () => {
  it('counts strictly smaller values', () => {
    expect(percentileRank([1, 2, 3, 4], 3)).toBe(0.5);
    expect(percentileRank([1, 2, 3, 4], 5)).toBe(1);
    expect(percentileRank([1, 2, 3, 4], 0)).toBe(0);
  });

  it('treats ties as “not smaller”', () => {
    expect(percentileRank([2, 2, 2], 2)).toBe(0);
  });

  it('returns null for empty series or non-finite current', () => {
    expect(percentileRank([], 1)).toBeNull();
    expect(percentileRank([1, 2], Number.NaN)).toBeNull();
  });
});

describe('buildValuationBands', () => {
  it('needs at least MIN_VALUATION_POINTS points', () => {
    const short = Array.from({ length: MIN_VALUATION_POINTS - 1 }, (_, i) => i + 1);
    expect(buildValuationBands(short, 10)).toEqual({
      percentile: null,
      opportunity: null,
      median: null,
      danger: null,
    });
  });

  it('returns 20/50/80 quantiles for 1..30', () => {
    const series = Array.from({ length: 30 }, (_, i) => i + 1);
    const bands = buildValuationBands(series, 30);
    expect(bands.percentile).toBeCloseTo(29 / 30, 10);
    expect(bands.opportunity).toBeCloseTo(6.8, 10);
    expect(bands.median).toBeCloseTo(15.5, 10);
    expect(bands.danger).toBeCloseTo(24.2, 10);
  });

  it('matches the recorded 沪深300 slice (516 weekly points, 2026-10-22)', () => {
    const series = sh300PeSeries();
    const bands = buildValuationBands(series, series[series.length - 1]);
    // 蛋卷自带 `pe_percentile` 是 0.498（它内部按日频算）；我们按周频复现出 0.496。
    expect(bands.percentile).toBeCloseTo(0.4961, 4);
    expect(bands.opportunity).toBeCloseTo(11.7383, 4);
    expect(bands.median).toBeCloseTo(12.737, 4);
    expect(bands.danger).toBeCloseTo(14.1813, 4);
  });
});
