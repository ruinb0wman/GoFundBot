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
    });
  });

  it('rejects partial data (only one market returned) instead of reporting a subset', async () => {
    installMock({ ulist: { data: { diff: [ULIST_PAYLOAD.data.diff[0]] } } });
    const result = await new EastMoneyMarketProvider().breadth();

    expect(result.total).toBe(0);
    expect(result.upCount).toBe(0);
    expect(result.limitUp).toBeNull();
    expect(result.date).toBe('');
  });

  it('keeps counts but nulls limit counts when the limit pools are unavailable', async () => {
    installMock({ zt: { rc: 102, data: null }, dt: { rc: 102, data: null } });
    const result = await new EastMoneyMarketProvider().breadth();

    expect(result.total).toBe(5286);
    expect(result.limitUp).toBeNull();
    expect(result.limitDown).toBeNull();
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

  it('returns empty breadth when the quote endpoint fails', async () => {
    fetchJsonMock.mockRejectedValue(new Error('boom'));
    const result = await new EastMoneyMarketProvider().breadth();

    expect(result.total).toBe(0);
    expect(result.scope).toBe('沪深两市');
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
