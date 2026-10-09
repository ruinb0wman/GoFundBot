import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchYahooGlobalIndices } from '../../providers/yahoo/yahooClient.js';

const { fetchUrlMock } = vi.hoisted(() => ({ fetchUrlMock: vi.fn() }));

vi.mock('../../core/fetch.js', () => ({ fetchUrl: fetchUrlMock }));

/**
 * 84s 回归测试（`.pi/plans/global-market-sources.md` §1.1）。
 *
 * 症状：Yahoo 在本机直连与代理都不通（实测 15.8s 超时），而 `fetchYahooGlobalIndices`
 * 用 `concurrency = 2` 串行分批 + `timeoutMs: 15000` → 11 个代码 6 批 ≈ 84s，
 * `/api/market/indices/combined` 一天 15 次 84.0s。
 *
 * 现在：11 个一次性并发、单请求 3500ms 预算。断言「同一个波次发出去」+「总耗时 ≈ 单次超时」
 * 才能拦住退回串行分批的改动。
 */

/** 模拟真实 fetchUrl：到点按 timeoutMs 自己 reject（不是外用 60s 挂住）。 */
function timingOutFetch() {
  return (_url: string, options?: { timeoutMs?: number }) =>
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('fetch timed out')), options?.timeoutMs ?? 1);
    });
}

describe('fetchYahooGlobalIndices（预算 + 并发）', () => {
  beforeEach(() => {
    fetchUrlMock.mockReset();
  });

  it('fires all symbols in one wave instead of serial batches', async () => {
    const startedAt: number[] = [];
    fetchUrlMock.mockImplementation((url: string, options?: { timeoutMs?: number }) => {
      startedAt.push(Date.now());
      return timingOutFetch()(url, options);
    });

    await fetchYahooGlobalIndices(120);

    // 旧实现：2 并发 × 6 批，第一批与最后一批开始时间相差 5 × 120ms。
    expect(startedAt).toHaveLength(11);
    expect(Math.max(...startedAt) - Math.min(...startedAt)).toBeLessThan(60);
  });

  it('returns [] within the budget when every request times out', async () => {
    fetchUrlMock.mockImplementation(timingOutFetch());

    const started = Date.now();
    const result = await fetchYahooGlobalIndices(80);
    const elapsed = Date.now() - started;

    expect(result.items).toEqual([]);
    // 旧实现 6 批 × 80ms ≈ 480ms
    expect(elapsed).toBeLessThan(300);
  });

  it('keeps the symbols that answered even when others fail', async () => {
    fetchUrlMock.mockImplementation((url: string, options?: { timeoutMs?: number }) => {
      if (String(url).includes(encodeURIComponent('^NDX'))) {
        return Promise.resolve(JSON.stringify({
          chart: {
            result: [{
              meta: {
                regularMarketPrice: 30766.72,
                chartPreviousClose: 31160.08,
                regularMarketDayHigh: 31125.13,
                regularMarketDayLow: 30756.6,
                regularMarketTime: 1791478483,
              },
              indicators: { quote: [{ open: [30985.23] }] },
            }],
          },
        }));
      }
      return timingOutFetch()(url, options);
    });

    const { items } = await fetchYahooGlobalIndices(80);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ code: 'NDX', name: '纳斯达克100', price: 30766.72 });
  });

  it('passes the budget down to each request', async () => {
    fetchUrlMock.mockImplementation(timingOutFetch());

    await fetchYahooGlobalIndices(50);

    for (const call of fetchUrlMock.mock.calls) {
      expect(call[1]).toMatchObject({ timeoutMs: 50, proxy: 'auto' });
    }
  });
});
