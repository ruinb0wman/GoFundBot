import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TencentMarketProvider } from '../../providers/tencent/tencentMarketProvider.js';

const { fetchUrlMock } = vi.hoisted(() => ({ fetchUrlMock: vi.fn() }));

vi.mock('../../core/fetch.js', () => ({ fetchUrl: fetchUrlMock }));

/**
 * 腾讯全球指数回归测试。
 *
 * 背景（`.pi/plans/global-market-sources.md`）：`/api/market/indices/combined` 曾因 Yahoo
 * 走 `concurrency = 2` 串行分批 + 15s 超时而卡满 84s。主源换成腾讯 `qt.gtimg.cn`（国内直连，
 * 覆盖美股 NDX/DJI/SPX + 港股 HSI/HSCEI）后 <1s。
 *
 * 这里用的是 2026-10-08 真实响应行（GBK 解码后），别再手写 shorten 过的假行 —— 字段下标
 * `[3]/[4]/[5]/[30]/[33]/[34]` 是硬约束，行长度不够就会被 `parts.length < 35` 丢掉。
 */

// prettier-ignore
const US_DJI_ROW =
  '200~道琼斯~.DJI~51051.58~51179.87~51105.04~195502388~0~0~51037.94~0~0~0~0~0~0~0~0~0~51069.03~0~0~0~0~0~0~0~0~0~~2026-10-08 13:28:40~-128.29~-0.25~51230.46~50939.00~USD~195502388~9985479248671~~~~~~0.57~~~Dow Jones~~54744.33~45057.28~0~~~~6.22~0.25~ZS~~~-0.58~-1.94~-3.05~~~0.70~~~51076.00~~~~~';

// prettier-ignore
const HK_HSI_ROW =
  '100~恒生指数~HSI~23785.790~24130.500~24031.660~20725528.9732~0~0~23785.790~0~0~0~0~0~0~0~0~0~23785.790~0~0~0~0~0~0~0~0~0~0.0~2026/10/08 18:31:15~-344.710~-1.43~24146.010~23737.140~23785.790~20725528.9732~20725528.973~0~0~~0~0~1.69~0~0~Hang Seng Index~0~28056.100~22518.000~1.71~8.21~0~0~0~0~0~0.00~0.00~0.00~0~-7.20~-3.36~ZS~~~-4.22~-5.89~-3.63~0.00~0.00~0.00~0.000~~-11.90~HKD~1~';

function qtResponse(entries: Array<[string, string]>): string {
  return entries.map(([symbol, row]) => `v_${symbol}="${row}";`).join('\n');
}

describe('TencentMarketProvider.globalIndices', () => {
  beforeEach(() => {
    fetchUrlMock.mockReset();
  });

  it('maps US + HK index rows and self-computes change from price/prevClose', async () => {
    fetchUrlMock.mockResolvedValue(qtResponse([
      ['usDJI', US_DJI_ROW],
      ['hkHSI', HK_HSI_ROW],
    ]));

    const { items } = await new TencentMarketProvider().globalIndices();

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      code: 'DJI',
      name: '道琼斯指数',
      price: 51051.58,
      prevClose: 51179.87,
      open: 51105.04,
      high: 51230.46,
      low: 50939.00,
      changeAmount: -128.29,
      changePercent: -0.25,
      market: '全球',
      date: '2026-10-08',
      updateTime: new Date('2026-10-08T13:28:40+08:00').toISOString(),
    });

    // 港股时间用 `/` 分隔，且 market 必须是「港股」——标成「全球」会让前端
    // `useMarketOverview.indices` 的 chinaNames 与 globalNames 同时命中，卡片在两栏重复。
    expect(items[1]).toMatchObject({
      code: 'HSI',
      name: '恒生指数',
      price: 23785.79,
      high: 24146.01,
      low: 23737.14,
      changeAmount: -344.71,
      changePercent: -1.43,
      market: '港股',
      date: '2026-10-08',
      updateTime: new Date('2026-10-08T18:31:15+08:00').toISOString(),
    });
  });

  it('requests the tencent symbols with proxy never + gbk', async () => {
    fetchUrlMock.mockResolvedValue(qtResponse([['usDJI', US_DJI_ROW]]));

    await new TencentMarketProvider().globalIndices();

    const [url, options] = fetchUrlMock.mock.calls[0];
    expect(String(url)).toContain('qt.gtimg.cn');
    expect(String(url)).toContain('usDJI');
    expect(String(url)).toContain('hkHSI');
    expect(options).toMatchObject({ proxy: 'never', encoding: 'gbk' });
  });

  it('ignores unrequested symbols and malformed rows', async () => {
    fetchUrlMock.mockResolvedValue(qtResponse([
      ['sh000001', '1~上证指数~000001~3811.9~3842.2~3830.0'],
      ['usDJI', '200~道琼斯~.DJI~51051.58~51179.87'],
      ['hkHSI', HK_HSI_ROW],
    ]));

    const { items } = await new TencentMarketProvider().globalIndices();

    expect(items.map((item) => item.code)).toEqual(['HSI']);
  });
});

describe('TencentMarketProvider.kline（海外指数）', () => {
  beforeEach(() => {
    fetchUrlMock.mockReset();
  });

  it('routes global index codes to the tencent global kline endpoint', async () => {
    fetchUrlMock.mockResolvedValue({
      code: 0,
      data: {
        usDJI: {
          day: [
            ['2026-10-06', '51444.10', '51521.28', '51672.25', '51422.90', '390414563.00', {}, '0.00', '20041722223987.00'],
            ['2026-10-07', '51406.44', '51179.87', '51406.44', '50917.42', '390601297.00', {}, '0.00', '20189274668807.00'],
          ],
        },
      },
    });

    const rows = await new TencentMarketProvider().kline('DJI', { period: 'daily', adjust: '' });

    expect(rows.map((row) => row.code)).toEqual(['DJI', 'DJI']);
    expect(rows[1]).toMatchObject({ date: '2026-10-07', open: 51406.44, close: 51179.87, high: 51406.44, low: 50917.42 });
    expect(rows[1].change).toBeCloseTo(51179.87 - 51521.28, 5);
    expect(String(fetchUrlMock.mock.calls[0][0])).toContain('param=usDJI');
  });

  it('returns [] for global indices tencent does not carry (lets the chain fall back to Yahoo)', async () => {
    const rows = await new TencentMarketProvider().kline('N225', { period: 'daily', adjust: '' });

    expect(rows).toEqual([]);
    expect(fetchUrlMock).not.toHaveBeenCalled();
  });
});
