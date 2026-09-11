import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StockSdkMarketProvider } from '../../providers/stock-sdk/stockSdkMarketProvider.js';

/**
 * Regression tests for the indices() symbol-matching bug.
 *
 * Tencent simple/full quotes report a NUMERIC marketId ("1" = SH, "51" = SZ)
 * with a numeric-only code ("000001"), so a symbol built as `${marketId}${code}`
 * ("1000001") never matches a prefixed code like "sh000001". indices() used to
 * key its lookup map with that broken symbol, which made every index resolve to
 * null prices — the exact bug the AI chat's get_market_indices tool hit.
 */
const sdkMocks = vi.hoisted(() => {
  const cn = vi.fn();
  const cnSimple = vi.fn();
  return {
    cn,
    cnSimple,
    getStockSdk: vi.fn(() => ({
      quotes: { cn, cnSimple },
    })),
  };
});

vi.mock('../../providers/stock-sdk/stockSdkClient.js', () => ({
  getStockSdk: sdkMocks.getStockSdk,
}));

const FULL_QUOTES = [
  { marketId: '1', name: '上证指数', code: '000001', price: 3387.32, change: 7.51, changePercent: 0.22, volume: 100, amount: 1000, market: 'CN', assetType: 'stock', source: 'tencent' },
  { marketId: '51', name: '深证成指', code: '399001', price: 10543.2, change: -12.3, changePercent: -0.12, volume: 100, amount: 1000, market: 'CN', assetType: 'stock', source: 'tencent' },
  { marketId: '51', name: '创业板指', code: '399006', price: 2178.9, change: 5.6, changePercent: 0.26, volume: 100, amount: 1000, market: 'CN', assetType: 'stock', source: 'tencent' },
  { marketId: '1', name: '沪深300', code: '000300', price: 3930.4, change: 10.1, changePercent: 0.26, volume: 100, amount: 1000, market: 'CN', assetType: 'stock', source: 'tencent' },
  { marketId: '1', name: '科创50', code: '000688', price: 1012.7, change: -3.2, changePercent: -0.32, volume: 100, amount: 1000, market: 'CN', assetType: 'stock', source: 'tencent' },
];

describe('StockSdkMarketProvider.indices', () => {
  let provider: StockSdkMarketProvider;

  beforeEach(() => {
    provider = new StockSdkMarketProvider();
    sdkMocks.cn.mockReset();
    sdkMocks.cnSimple.mockReset();
  });

  it('maps full quotes with numeric marketIds onto the expected indices', async () => {
    sdkMocks.cn.mockResolvedValue(FULL_QUOTES);
    sdkMocks.cnSimple.mockRejectedValue(new Error('should not be called'));

    const result = await provider.indices();

    expect(result.items).toHaveLength(5);
    expect(result.items[0]).toMatchObject({
      code: 'sh000001',
      name: '上证指数',
      price: 3387.32,
      changePercent: 0.22,
      changeAmount: 7.51,
      market: 'A股',
    });
    expect(result.items[1]).toMatchObject({ code: 'sz399001', price: 10543.2 });
    expect(result.items[4]).toMatchObject({ code: 'sh000688', price: 1012.7 });
    expect(sdkMocks.cnSimple).not.toHaveBeenCalled();
  });

  it('falls back to cnSimple when full quotes fail', async () => {
    sdkMocks.cn.mockRejectedValue(new Error('upstream down'));
    sdkMocks.cnSimple.mockResolvedValue([
      { marketId: '51', name: '深证成指', code: '399001', price: 10543.2, change: -12.3, changePercent: -0.12, volume: 100, amount: 1000, market: 'CN', assetType: 'stock', marketType: 'ZS', source: 'tencent' },
    ]);

    const result = await provider.indices();

    // The single matched index carries its real price; the rest stay null.
    expect(result.items.find((i) => i.code === 'sz399001')).toMatchObject({
      price: 10543.2,
      changePercent: -0.12,
      changeAmount: -12.3,
    });
    expect(result.items.find((i) => i.code === 'sh000001')?.price).toBeNull();
  });

  it('returns all-null items (no throw) when the upstream returns nothing', async () => {
    sdkMocks.cn.mockResolvedValue([]);
    sdkMocks.cnSimple.mockRejectedValue(new Error('should not be called'));

    const result = await provider.indices();

    expect(result.items).toHaveLength(5);
    expect(result.items.every((i) => i.price === null)).toBe(true);
  });
});
