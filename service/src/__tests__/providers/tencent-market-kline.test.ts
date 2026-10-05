import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TencentMarketProvider } from '../../providers/tencent/tencentMarketProvider.js';

const { fetchUrlMock } = vi.hoisted(() => ({ fetchUrlMock: vi.fn() }));

vi.mock('../../core/fetch.js', () => ({ fetchUrl: fetchUrlMock }));

/**
 * Tencent 新格式 K 线回归测试。
 *
 * 旧端点 `web.ifzq.gtimg.cn/app/app/kline/kline` 已失效（返回 code:11），
 * 导致 ProviderChain 全线失败、「近7日A股成交量」为空。新实现改用
 * `proxy.finance.qq.com/.../newfqkline/get`，行内 [8] 是成交额（万元），
 * 必须换算成「元」以对齐 EastMoney/akshare 的 KlineDto 语义。
 */

const INDEX_NODE = {
  day: [
    ['2026-09-24', '3925.32', '3888.37', '3930.50', '3888.37', '438530412.00', {}, '0.90', '78361300.14', '0.00', '0.00'],
    ['2026-09-29', '3816.15', '3830.45', '3843.84', '3810.81', '399473391.00', {}, '0.82', '66170429.28', '0.00', '0.00'],
  ],
};

function ok(data: Record<string, Record<string, unknown>>) {
  return { code: 0, msg: '', data };
}

describe('TencentMarketProvider.kline', () => {
  beforeEach(() => {
    fetchUrlMock.mockReset();
  });

  it('maps index rows and converts 成交额 万元 → 元', async () => {
    fetchUrlMock.mockResolvedValue(ok({ sh000001: INDEX_NODE }));

    const rows = await new TencentMarketProvider().kline('sh000001', { period: 'daily', adjust: '' });

    expect(rows).toHaveLength(2);
    const [first, second] = rows;

    // 首行无前收，无法算涨跌
    expect(first.change).toBeNull();
    expect(first.changePercent).toBeNull();

    expect(second).toMatchObject({
      code: '000001',
      date: '2026-09-29',
      open: 3816.15,
      close: 3830.45,
      high: 3843.84,
      low: 3810.81,
      volume: 399473391,
      amount: 661704292800, // 66170429.28 万元
      turnoverRate: 0.82,
    });
    expect(second.change).toBeCloseTo(3830.45 - 3888.37, 5);
    expect(second.changePercent).toBeCloseTo(((3830.45 - 3888.37) / 3888.37) * 100, 5);
    expect(second.timestamp).toBe(new Date('2026-09-29').getTime());
  });

  it('uses the qfq node for stocks and filters rows to the requested window', async () => {
    fetchUrlMock.mockResolvedValue(ok({
      sh600000: {
        qfqday: [
          ['2026-09-01', '9.00', '9.10', '9.20', '8.90', '100.00', {}, '0.10', '100.00'],
          ['2026-09-20', '9.10', '9.18', '9.25', '9.05', '805097.00', {}, '0.24', '73974.10'],
          ['2026-10-05', '9.20', '9.30', '9.40', '9.15', '200.00', {}, '0.20', '200.00'],
        ],
      },
    }));

    const rows = await new TencentMarketProvider().kline('sh600000', {
      period: 'daily',
      adjust: 'qfq',
      startDate: '20260915',
      endDate: '20260930',
    });

    expect(rows.map((r) => r.date)).toEqual(['2026-09-20']);

    const [url, options] = fetchUrlMock.mock.calls[0];
    expect(url).toContain('param=sh600000%2Cday%2C2026-09-15%2C2026-09-30%2C');
    expect(url).toContain('%2Cqfq');
    expect(options).toMatchObject({ proxy: 'never', as: 'json' });
  });

  it('returns [] when Tencent reports a non-zero code', async () => {
    fetchUrlMock.mockResolvedValue({ code: 11, msg: 'No dispatch info found', data: '' });

    await expect(
      new TencentMarketProvider().kline('sh000001', { period: 'daily', adjust: '' }),
    ).resolves.toEqual([]);
  });

  it('falls back to web.ifzq when proxy.finance.qq.com fails', async () => {
    fetchUrlMock.mockImplementation((url: string) => {
      if (url.includes('proxy.finance.qq.com')) return Promise.reject(new Error('blocked'));
      return Promise.resolve(ok({ sh000001: { day: INDEX_NODE.day } }));
    });

    const rows = await new TencentMarketProvider().kline('sh000001', { period: 'daily', adjust: '' });

    expect(rows).toHaveLength(2);
    expect(fetchUrlMock).toHaveBeenCalledTimes(2);
  });

  it('returns [] when every Tencent host fails', async () => {
    fetchUrlMock.mockRejectedValue(new Error('blocked'));

    await expect(
      new TencentMarketProvider().kline('sh000001', { period: 'daily', adjust: '' }),
    ).resolves.toEqual([]);
  });
});
