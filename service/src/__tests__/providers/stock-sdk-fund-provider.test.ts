import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StockSdkFundProvider } from '../../providers/stock-sdk/stockSdkFundProvider.js';

/**
 * Regression test: stock-sdk 的 `date` 是 `new Date(x).toISOString().slice(0,10)`（UTC），
 * 而东财 pingzhongdata 的 `x` 是「北京时间零点」（= UTC 前一天 16:00）→ SDK 返回的日期整体
 * 早一天（实测连周日的净值都出现）。provider 必须用 timestamp 按 Asia/Shanghai 重算。
 *
 * 这里用的就是真机拿到的真实 payload（110022 / 017641），SDK 给的 date 故意是错的那天。
 */
const sdkMocks = vi.hoisted(() => {
  const navHistory = vi.fn();
  const rankHistory = vi.fn();
  return {
    navHistory,
    rankHistory,
    getStockSdk: vi.fn(() => ({
      fund: { navHistory, rankHistory },
    })),
  };
});

vi.mock('../../providers/stock-sdk/stockSdkClient.js', () => ({
  getStockSdk: sdkMocks.getStockSdk,
}));

describe('StockSdkFundProvider date normalization', () => {
  let provider: StockSdkFundProvider;

  beforeEach(() => {
    provider = new StockSdkFundProvider();
    sdkMocks.navHistory.mockReset();
    sdkMocks.rankHistory.mockReset();
  });

  it('recomputes nav dates from the Beijing-midnight timestamp (fixes the -1 day shift)', async () => {
    sdkMocks.navHistory.mockResolvedValue({
      code: '110022',
      name: '易方达消费行业股票',
      items: [
        // 1790524800000 = 2026-09-28 00:00 Asia/Shanghai（周日！），SDK 报 09-27
        { date: '2026-09-27', timestamp: 1790524800000, nav: 2.754, accNav: 2.754, dailyReturn: -0.97 },
        // 1790697600000 = 2026-09-30 00:00 Asia/Shanghai，SDK 报 09-29
        { date: '2026-09-29', timestamp: 1790697600000, nav: 2.79, accNav: 2.79, dailyReturn: 1.34 },
        // 1791388800000 = 2026-10-08 00:00 Asia/Shanghai，SDK 报 10-07
        { date: '2026-10-07', timestamp: 1791388800000, nav: 2.761, accNav: 2.761, dailyReturn: -1.04 },
      ],
    });

    const result = await provider.navHistory('110022');

    expect(result.items.map((item) => item.date)).toEqual([
      '2026-09-28',
      '2026-09-30',
      '2026-10-08',
    ]);
  });

  it('keeps the SDK date when there is no timestamp to recompute from', async () => {
    sdkMocks.navHistory.mockResolvedValue({
      code: '110022',
      name: null,
      items: [{ date: '2026-10-08', timestamp: null, nav: 2.761, accNav: null, dailyReturn: null }],
    });

    const result = await provider.navHistory('110022');

    expect(result.items[0].date).toBe('2026-10-08');
  });

  it('recomputes rank dates the same way', async () => {
    sdkMocks.rankHistory.mockResolvedValue({
      code: '017641',
      name: null,
      items: [{ date: '2026-09-29', timestamp: 1790697600000, rank: 130, total: 362, percentile: 64.09 }],
    });

    const result = await provider.rankHistory('017641');

    expect(result.items[0].date).toBe('2026-09-30');
  });
});
