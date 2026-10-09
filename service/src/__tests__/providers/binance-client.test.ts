import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchBinanceCryptoKline, fetchBinanceCryptoQuotes } from '../../providers/binance/binanceClient.js';

const { fetchUrlMock } = vi.hoisted(() => ({ fetchUrlMock: vi.fn() }));

vi.mock('../../core/fetch.js', () => ({ fetchUrl: fetchUrlMock }));

/**
 * Binance 加密取数（替换 Yahoo）。
 *
 * Yahoo 在这台机器上直连与代理都不通（15.8s 超时），4 个代码 2 批 × 15s = 30s；
 * `api.binance.com` 实测**直连 0.75s 可用**，所以主路径必须是 `proxy: 'never'`。
 */

const TICKERS = [
  {
    symbol: 'BTCUSDT', lastPrice: '81058.00000000', priceChange: '-2351.88000000',
    priceChangePercent: '-2.820', prevClosePrice: '83409.88000000', openPrice: '83409.88000000',
    highPrice: '83630.02000000', lowPrice: '80800.95000000', closeTime: 1791478483003,
  },
  {
    symbol: 'ETHUSDT', lastPrice: '2422.31000000', priceChange: '-144.70000000',
    priceChangePercent: '-5.637', prevClosePrice: '2567.01000000', openPrice: '2567.01000000',
    highPrice: '2587.28000000', lowPrice: '2416.59000000', closeTime: 1791478483013,
  },
];

describe('fetchBinanceCryptoQuotes', () => {
  beforeEach(() => {
    fetchUrlMock.mockReset();
  });

  it('maps 24hr tickers to GlobalIndexDto in CRYPTO_DEFS order', async () => {
    // Binance 的返回顺序不保证，这里把 ETH 放前面，断言输出仍是 BTC/ETH（按 defs）。
    fetchUrlMock.mockResolvedValue([TICKERS[1], TICKERS[0]]);

    const { items } = await fetchBinanceCryptoQuotes();

    // 4 个 defs 里只有 2 个有行情 → 只输出这 2 个
    expect(items.map((item) => item.code)).toEqual(['BTC', 'ETH']);
    expect(items[0]).toMatchObject({
      code: 'BTC',
      name: '比特币',
      price: 81058,
      changeAmount: -2351.88,
      changePercent: -2.82,
      open: 83409.88,
      high: 83630.02,
      low: 80800.95,
      prevClose: 83409.88,
      market: '加密货币',
      date: new Date(1791478483003).toISOString().slice(0, 10),
    });
    expect(items[0].updateTime).toBe(new Date(1791478483003).toISOString());
  });

  it('hits binance over a direct connection first', async () => {
    fetchUrlMock.mockResolvedValue(TICKERS);

    await fetchBinanceCryptoQuotes();

    const [url, options] = fetchUrlMock.mock.calls[0];
    expect(String(url)).toContain('api.binance.com/api/v3/ticker/24hr');
    expect(String(url)).toContain('BTCUSDT');
    expect(options).toMatchObject({ proxy: 'never', as: 'json' });
  });

  it('retries once through the proxy and then throws so the caller can degrade', async () => {
    fetchUrlMock.mockRejectedValue(new Error('fetch failed'));

    await expect(fetchBinanceCryptoQuotes()).rejects.toThrow('fetch failed');
    expect(fetchUrlMock).toHaveBeenCalledTimes(2);
    expect(fetchUrlMock.mock.calls[1][1]).toMatchObject({ proxy: 'auto' });
  });
});

describe('fetchBinanceCryptoKline', () => {
  beforeEach(() => {
    fetchUrlMock.mockReset();
  });

  it('maps klines and passes the date window + interval', async () => {
    fetchUrlMock.mockResolvedValue([
      [1791244800000, '85766.87', '86698.99', '85136.11', '85549.93', '12614.47572'],
      [1791331200000, '85549.94', '85598.22', '82787.25', '83321.81', '20838.08376'],
    ]);

    const candles = await fetchBinanceCryptoKline('BTC', {
      period: 'daily',
      startDate: '20260901',
      endDate: '20261008',
    });

    expect(candles).toHaveLength(2);
    expect(candles[1]).toEqual({
      timestamp: 1791331200000,
      open: 85549.94,
      high: 85598.22,
      low: 82787.25,
      close: 83321.81,
      volume: 20838.08376,
    });

    const url = String(fetchUrlMock.mock.calls[0][0]);
    expect(url).toContain('interval=1d');
    expect(url).toContain('symbol=BTCUSDT');
    expect(url).toContain(`startTime=${new Date('2026-09-01T00:00:00Z').getTime()}`);
  });

  it('returns [] for an unknown crypto code without hitting the network', async () => {
    expect(await fetchBinanceCryptoKline('DOGE', { period: 'daily' })).toEqual([]);
    expect(fetchUrlMock).not.toHaveBeenCalled();
  });
});
