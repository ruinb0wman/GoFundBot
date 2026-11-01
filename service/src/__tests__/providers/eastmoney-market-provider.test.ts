import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EastMoneyMarketProvider } from '../../providers/eastmoney/eastmoneyMarketProvider.js';

const { fetchJsonMock } = vi.hoisted(() => ({ fetchJsonMock: vi.fn() }));

vi.mock('../../providers/eastmoney/eastmoneyRequest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/eastmoney/eastmoneyRequest.js')>();
  return { ...actual, fetchJson: fetchJsonMock };
});

/** 上证指数 1240/1031/83（沪市全体）+ 深证成指 1489/1334/109（深市全体） */
const ULIST_PAYLOAD = {
  data: {
    total: 2,
    diff: [
      { f12: '000001', f14: '上证指数', f104: 1240, f105: 1031, f106: 83, f124: 1790049273 },
      { f12: '399001', f14: '深证成指', f104: 1489, f105: 1334, f106: 109, f124: 1790049270 },
    ],
  },
};

function mutualPayload(dealAmount: number, date = '2026-09-21') {
  return {
    result: { pages: 1, data: [{ TRADE_DATE: `${date} 00:00:00`, FUND_INFLOW: null, NET_DEAL_AMT: null, DEAL_AMT: dealAmount }] },
    success: true,
  };
}

/** 按 URL 分派 mock；未覆盖的 URL 直接抛错（暴露意外的请求） */
function installMock(overrides: { ulist?: unknown; zt?: unknown; dt?: unknown; mutual?: (type: string) => unknown } = {}) {
  fetchJsonMock.mockImplementation((url: string) => {
    if (url.includes('ulist.np/get')) return overrides.ulist ?? ULIST_PAYLOAD;
    if (url.includes('getTopicZTPool')) return overrides.zt ?? { data: { tc: 57 } };
    if (url.includes('getTopicDTPool')) return overrides.dt ?? { data: { tc: 0 } };
    if (url.includes('datacenter-web')) {
      const decoded = decodeURIComponent(url);
      const type = /MUTUAL_TYPE="(\d+)"/.exec(decoded)?.[1] ?? '';
      if (overrides.mutual) return overrides.mutual(type);
      if (type === '005') return mutualPayload(283911.86);
      if (type === '001') return mutualPayload(133832.25);
      if (type === '003') return mutualPayload(150079.61);
    }
    throw new Error(`Unexpected url: ${url}`);
  });
}

describe('EastMoneyMarketProvider.breadth', () => {
  // 注意：必须用块体，`() => mock.mockReset()` 会把 mock 当 teardown 回调返回
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it('sums SH + SZ up/down/flat counts from f104/f105/f106', async () => {
    installMock();
    const result = await new EastMoneyMarketProvider().breadth();

    expect(result).toEqual({
      upCount: 2729,
      downCount: 2365,
      flatCount: 192,
      total: 5286,
      limitUp: 57,
      limitDown: 0,
      scope: '沪深两市',
      date: '2026-09-22',
      data_status: 'available',
    });
  });

  it('rejects partial data (only one market returned) instead of reporting a subset', async () => {
    installMock({ ulist: { data: { diff: [ULIST_PAYLOAD.data.diff[0]] } } });
    const result = await new EastMoneyMarketProvider().breadth();

    expect(result.total).toBe(0);
    expect(result.upCount).toBe(0);
    expect(result.limitUp).toBeNull();
    expect(result.date).toBe('');
    // 关键：半截数据必须标 unavailable，不能让消费方看到「0 家上涨」就当真
    expect(result.data_status).toBe('unavailable');
    expect(result.error).toMatch(/只回了一个市场/);
  });

  it('keeps counts but nulls limit counts when the limit pools are unavailable', async () => {
    installMock({ zt: { rc: 102, data: null }, dt: { rc: 102, data: null } });
    const result = await new EastMoneyMarketProvider().breadth();

    expect(result.total).toBe(5286);
    expect(result.limitUp).toBeNull();
    expect(result.limitDown).toBeNull();
    expect(result.data_status).toBe('available');
  });

  it('does not use f168/f169/f170 (the old wrong fields)', async () => {
    // 旧实现会读到的「换手率/涨跌额/涨跌幅」；此处确保它们不再影响结果
    installMock({
      ulist: {
        data: {
          diff: [
            { f12: '000001', f104: 1240, f105: 1031, f106: 83, f168: 68, f169: 873, f170: 22, f124: 1790049273 },
            { f12: '399001', f104: 1489, f105: 1334, f106: 109, f124: 1790049270 },
          ],
        },
      },
    });
    const result = await new EastMoneyMarketProvider().breadth();

    expect(result.upCount).toBe(2729);
    expect(result.downCount).toBe(2365);
  });

  it('marks the result unavailable when the quote endpoint fails', async () => {
    fetchJsonMock.mockRejectedValue(new Error('boom'));
    const result = await new EastMoneyMarketProvider().breadth();

    expect(result.total).toBe(0);
    expect(result.scope).toBe('沪深两市');
    expect(result.data_status).toBe('unavailable');
    expect(result.error).toMatch(/boom/);
  });

  it('marks out-of-range totals unavailable (upstream throttling / non-trading day)', async () => {
    installMock({
      ulist: {
        data: {
          diff: [
            { f12: '000001', f104: 11, f105: 3, f106: 1, f124: 1790049273 },
            { f12: '399001', f104: 5, f105: 2, f106: 0, f124: 1790049270 },
          ],
        },
      },
    });
    const result = await new EastMoneyMarketProvider().breadth();

    expect(result.data_status).toBe('unavailable');
    expect(result.error).toMatch(/合计 22/);
  });
});

describe('EastMoneyMarketProvider.northFlow', () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it('reports deal amounts and always-null net inflow', async () => {
    installMock();
    const result = await new EastMoneyMarketProvider().northFlow();

    // DEAL_AMT 单位是百万元：283911.86 / 100 = 2839.12 亿元
    // 与新闻口径「沪深股通合计成交 2839.12 亿、沪股通 1338.32 亿」一致
    expect(result).toEqual({
      date: '2026-09-21',
      shNetInflow: null,
      szNetInflow: null,
      totalNetInflow: null,
      shDealAmount: 133832.25,
      szDealAmount: 150079.61,
      totalDealAmount: 283911.86,
    });
  });

  it('throws so the caller can fall back when the datacenter returns no rows', async () => {
    installMock({ mutual: () => ({ result: { data: [] }, success: true }) });

    await expect(new EastMoneyMarketProvider().northFlow()).rejects.toThrow(/no rows/);
  });
});

describe('EastMoneyMarketProvider.globalIndices', () => {
  /** 2026-10-30 真实 ulist.np 行：f15=最高、f16=最低、f17=今开、f18=昨收（别按 stock/get 的 f44/f45/f46 套） */
  const GLOBAL_PAYLOAD = {
    data: {
      total: 2,
      diff: [
        { f2: 63290.11, f3: -2.12, f4: -1369.36, f12: 'N225', f13: 100, f14: '日经225', f15: 64589.04, f16: 62711.42, f17: 64344.37, f18: 64659.47, f124: 1793341800 },
        { f2: 23294.42, f3: 1.46, f4: 335.77, f12: 'HSI', f13: 100, f14: '恒生指数', f15: 0, f16: 0, f17: 0, f18: 0, f124: 1793341800 },
      ],
    },
  };

  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it('maps secids back to the canonical codes and marks 恒生 as 港股', async () => {
    fetchJsonMock.mockResolvedValue(GLOBAL_PAYLOAD);
    const { items } = await new EastMoneyMarketProvider().globalIndices();

    expect(items.map((i) => i.code)).toEqual(['N225', 'HSI']);
    expect(items[0]).toMatchObject({ name: '日经225', open: 64344.37, high: 64589.04, low: 62711.42, prevClose: 64659.47, market: '全球' });
    // 港股标「全球」会让前端 chinaNames 与 globalNames 同时命中 → 同一张卡片两栏重复
    expect(items[1].market).toBe('港股');
  });

  it('drops rows whose secid is not in GLOBAL_INDEX_DEFS', async () => {
    fetchJsonMock.mockResolvedValue({ data: { diff: [{ f2: 1, f3: 1, f12: 'UNKNOWN', f13: 100 }] } });
    const { items } = await new EastMoneyMarketProvider().globalIndices();

    expect(items).toEqual([]);
  });

  it('fetches all defs in one ulist.np request', async () => {
    fetchJsonMock.mockResolvedValue(GLOBAL_PAYLOAD);
    await new EastMoneyMarketProvider().globalIndices();

    const url = decodeURIComponent(String(fetchJsonMock.mock.calls[0][0]));
    expect(url).toContain('ulist.np/get');
    expect(url).toContain('100.N225,100.KS11,100.FTSE,100.GDAXI,100.FCHI,100.SENSEX');
  });
});

describe('EastMoneyMarketProvider.kline', () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it('supports global indices via the 100.<code> secid', async () => {
    fetchJsonMock.mockResolvedValue({
      data: { klines: ['2026-10-30,64344.37,63290.11,64589.04,62711.42,0,0.00,2.90,-2.12,-1369.36,0.00'] },
    });
    const rows = await new EastMoneyMarketProvider().kline('N225', { period: 'daily' });

    const url = decodeURIComponent(String(fetchJsonMock.mock.calls[0][0]));
    expect(url).toContain('secid=100.N225');
    // 东财 kline 缺 beg/end 会直接回 rc:102 → 必须带默认值
    expect(url).toContain('beg=0');
    expect(url).toContain('end=20500101');
    // fields2 = f51..f61 → [7]=振幅、[8]=涨跌幅、[9]=涨跌额、[10]=换手率
    expect(rows[0]).toMatchObject({ code: 'N225', change: -1369.36, changePercent: -2.12, turnoverRate: 0 });
  });

  it('returns [] for symbols it cannot map', async () => {
    expect(await new EastMoneyMarketProvider().kline('usNDX', { period: 'daily' })).toEqual([]);
  });
});
