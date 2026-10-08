import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EastMoneyFundProvider } from '../../providers/eastmoney/eastmoneyFundProvider.js';

const { fetchTextMock, fetchUrlMock } = vi.hoisted(() => ({ fetchTextMock: vi.fn(), fetchUrlMock: vi.fn() }));

vi.mock('../../providers/eastmoney/eastmoneyRequest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/eastmoney/eastmoneyRequest.js')>();
  return { ...actual, fetchText: fetchTextMock };
});

// `fetchFundDetailScript()` 直接走 core/fetch 的 fetchUrl（不经过 eastmoneyRequest.fetchText）。
vi.mock('../../core/fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/fetch.js')>();
  return { ...actual, fetchUrl: fetchUrlMock };
});

const MONEY_ROW =
  '940037,华泰紫金货币增利C,HTZJHBZLC,2026-07-30,0.3153,1.157,0.02,0.1,0.31,0.63,1.32,2.97,5.15,0.74,7.71,2022-05-09,1,1.157,1.1619,1.199,1.2085,0.00%,0.00%,,货币型-普通货币,';

const REITS_LIST = 'var r = [["508000","华安张江","华安张江产业园REIT","Reits","huaanzjcy"]];';

const REITS_NAV_SCRIPT =
  'var fS_name = "华安张江产业园REIT";var fS_code = "508000";' +
  'var Data_netWorthTrend = [{"x":1780000000000,"y":3.0},{"x":1782000000000,"y":3.3},{"x":1784000000000,"y":3.1}];' +
  'var other = 1;';

function rankhandlerPayload(row: string, allRecords = 1): string {
  return `var rankData = {datas:["${row}"],allRecords:${allRecords},pageIndex:1,pageNum:500,allPages:1};`;
}

function installRankhandlerMock(): () => void {
  fetchTextMock.mockImplementation((url: string) => {
    if (url.includes('rankhandler')) {
      if (url.includes('dt=hb')) {
        return rankhandlerPayload(MONEY_ROW, 542);
      }
      return rankhandlerPayload('000001,华夏成长,000001,2026-07-30,1.5,2.0,1.2,1.3,1.4,1.5,1.6,1.7,1.8,1.9,2.0,2.1,1.5,');
    }
    throw new Error(`Unexpected url: ${url}`);
  });
  return () => fetchTextMock.mockReset();
}

describe('EastMoneyFundProvider screeningSnapshot', () => {
  beforeEach(() => {
    fetchTextMock.mockReset();
    fetchUrlMock.mockReset();
  });

  it('maps money-fund (dt=hb) rows into screening items', async () => {
    installRankhandlerMock();
    const provider = new EastMoneyFundProvider();

    const result = await provider.screeningSnapshot({ types: ['hb'], limitPerType: 500 });

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.code).toBe('940037');
    expect(item.name).toBe('华泰紫金货币增利C');
    expect(item.nav).toBe(1);
    expect(item.navDate).toBe('2026-07-30');
    expect(item.return1m).toBe(0.1);
    expect(item.return3m).toBe(0.31);
    expect(item.return6m).toBe(0.63);
    expect(item.return1y).toBe(1.32);
    expect(item.return2y).toBe(2.97);
    expect(item.return3y).toBe(5.15);
    expect(item.ytd).toBe(0.74);
    expect(item.sinceInception).toBe(7.71);
    expect(item.source).toBe('eastmoney.rankhandler.moneyfund');

    const hbUrl = String(fetchTextMock.mock.calls.find((c) => String(c[0]).includes('dt=hb'))?.[0]);
    expect(hbUrl).toContain('ft=hb');
    expect(hbUrl).toContain('sc=7nzf');
  });

  it('includes hb and reits in default type buckets', async () => {
    fetchTextMock.mockImplementation((url: string) => {
      if (url.includes('fundcode_search.js')) return REITS_LIST;
      if (url.includes('pingzhongdata')) return REITS_NAV_SCRIPT;
      if (url.includes('rankhandler')) {
        if (url.includes('dt=hb')) return rankhandlerPayload(MONEY_ROW, 1);
        return rankhandlerPayload('000001,华夏成长,000001,2026-07-30,1.5,2.0,1.2,1.3,1.4,1.5,1.6,1.7,1.8,1.9,2.0,2.1,1.5,');
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    const provider = new EastMoneyFundProvider();

    const result = await provider.screeningSnapshot();

    expect(result.summary.types).toContain('hb');
    expect(result.summary.types).toContain('reits');
    const urls = fetchTextMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('dt=hb') && u.includes('ft=hb'))).toBe(true);
    expect(urls.some((u) => u.includes('pingzhongdata/508000.js'))).toBe(true);
  });
});

const MONEY_SCRIPT =
  'var fS_name = "信澳慧管家货币C";var fS_code = "000682";' +
  'var ishb = true;' +
  'var Data_millionCopiesIncome = [[1780000000000,1.0],[1780086400000,2.0],[1780172800000,0.5]];' +
  'var Data_sevenDaysYearIncome = [[1780000000000,3.0],[1780086400000,3.2],[1780172800000,3.261]];';

// 1*(1+1/10000)*(1+2/10000)*(1+0.5/10000) = 1.0003501...
const MONEY_LAST_NAV = 1 * (1 + 1 / 10000) * (1 + 2 / 10000) * (1 + 0.5 / 10000);

describe('EastMoneyFundProvider money funds', () => {
  beforeEach(() => {
    fetchTextMock.mockReset();
    fetchUrlMock.mockReset();
  });

  it('synthesizes a cumulative-return nav series from 每万份收益', async () => {
    fetchTextMock.mockImplementation((url: string) => {
      if (url.includes('pingzhongdata')) return MONEY_SCRIPT;
      throw new Error(`Unexpected url: ${url}`);
    });
    const provider = new EastMoneyFundProvider();

    const nav = await provider.navHistory('000682');

    expect(nav.name).toBe('信澳慧管家货币C');
    expect(nav.items).toHaveLength(3);
    expect(nav.items[2].nav).toBeCloseTo(MONEY_LAST_NAV, 6);
    expect(nav.items[2].accNav).toBeCloseTo(MONEY_LAST_NAV, 6);
    // 每万份收益 2 元 → 当日 0.02%
    expect(nav.items[1].dailyReturn).toBeCloseTo(0.02, 6);
    // 单位净值起步：第一条就已经赚了一天
    expect(nav.items[0].nav).toBeGreaterThan(1);
  });

  it('returns 7d yield + 每万份收益 and nav=1 for money-fund estimates', async () => {
    fetchTextMock.mockImplementation((url: string) => {
      if (url.includes('FundGuZhi')) throw new Error('batch unavailable');
      throw new Error(`Unexpected url: ${url}`);
    });
    fetchUrlMock.mockResolvedValue(MONEY_SCRIPT);
    const provider = new EastMoneyFundProvider();

    const estimate = await provider.estimate('000682');

    expect(estimate.isMoneyFund).toBe(true);
    expect(estimate.nav).toBe(1);
    expect(estimate.sevenDayYield).toBe(3.261);
    expect(estimate.unitIncome).toBe(0.5);
    expect(estimate.estimatedNav).toBeNull();
    expect(estimate.navDate).toBe('2026-05-31');
  });

  it('keeps the normal nav/estimate path for non-money funds', async () => {
    fetchTextMock.mockImplementation((url: string) => {
      if (url.includes('pingzhongdata')) return REITS_NAV_SCRIPT;
      throw new Error(`Unexpected url: ${url}`);
    });
    fetchUrlMock.mockResolvedValue(REITS_NAV_SCRIPT);
    const provider = new EastMoneyFundProvider();

    const nav = await provider.navHistory('508000');
    expect(nav.items.map((i) => i.nav)).toEqual([3.0, 3.3, 3.1]);

    const estimate = await provider.estimate('508000');
    expect(estimate.isMoneyFund).toBe(false);
    expect(estimate.sevenDayYield).toBeNull();
    expect(estimate.nav).toBe(3.1);
    expect(estimate.estimatedChangePercent).toBeCloseTo(((3.1 - 3.3) / 3.3) * 100, 6);
  });
});
