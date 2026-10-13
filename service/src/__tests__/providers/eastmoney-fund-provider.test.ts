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

// ---------------------------------------------------------------------------
// holdings：主源走东财移动 F10（名称/占比/行业），失败才回退 pingzhongdata + push2
// ---------------------------------------------------------------------------

const MOBILE_POSITION_PAYLOAD = {
  Datas: {
    fundStocks: [
      { GPDM: '600519', GPJC: '贵州茅台', JZBL: '9.77', TEXCH: '1', INDEXNAME: '食品饮料' },
      { GPDM: '000333', GPJC: '美的集团', JZBL: '9.31', TEXCH: '2', INDEXNAME: '家用电器' },
      { GPDM: 'NVDA', GPJC: '英伟达', JZBL: '7.25', TEXCH: '7', INDEXNAME: '--' },
    ],
    fundboods: [{ ZQDM: '127045', ZQMC: '某转债' }],
  },
  Expansion: '2026-06-30',
};

const POSITION_SCRIPT =
  'var stockCodes = ["6005191","0003330"];' +
  'var stockCodesNew = ["1.600519","0.000333"];' +
  'var zqCodes = "127045";' +
  'var fundSharesPositionDate = "2026-06-30";';

const ULIST_PAYLOAD = {
  data: {
    diff: [
      { f12: '600519', f13: 1, f14: '贵州茅台', f100: '白酒Ⅱ' },
      { f12: '000333', f13: 0, f14: '美的集团', f100: '白色家电' },
    ],
  },
};

describe('EastMoneyFundProvider holdings', () => {
  beforeEach(() => {
    fetchTextMock.mockReset();
    fetchUrlMock.mockReset();
  });

  it('prefers the mobile F10 source: name + industry + percent ratio', async () => {
    fetchUrlMock.mockResolvedValue(JSON.stringify(MOBILE_POSITION_PAYLOAD));
    const provider = new EastMoneyFundProvider();

    const result = await provider.holdings('110022');

    expect(result.items).toHaveLength(3);
    // 名称不再是代码，且占比是百分数（9.77，不是 /100 后的 0.0977）
    expect(result.items[0]).toMatchObject({
      stockCode: '600519',
      stockName: '贵州茅台',
      market: '上海',
      symbol: 'sh600519',
      ratio: 9.77,
      industry: '食品饮料',
    });
    expect(result.items[1]).toMatchObject({ stockName: '美的集团', market: '深圳', ratio: 9.31 });
    // 海外代码（QDII）：不硬套市场/行业
    expect(result.items[2]).toMatchObject({ stockCode: 'NVDA', stockName: '英伟达', market: null, symbol: null, industry: null });
    expect(result.bondCodes).toEqual(['127045']);
    expect(result.reportDate).toBe('2026-06-30');

    const [url, options] = fetchUrlMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain('fundmobapi.eastmoney.com');
    // 桌面 Chrome UA 会被该接口回 ErrCode 61136403，必须用非浏览器 UA
    expect(options.headers['User-Agent']).not.toContain('Chrome');
    // 主源成功就不该再打 pingzhongdata
    expect(fetchUrlMock.mock.calls.some((c) => String(c[0]).includes('pingzhongdata'))).toBe(false);
  });

  it('treats an empty fundStocks list as a valid (not failed) answer', async () => {
    fetchUrlMock.mockResolvedValue(JSON.stringify({ Datas: { fundStocks: [], fundboods: [] }, Expansion: '2026-06-30' }));
    const provider = new EastMoneyFundProvider();

    const result = await provider.holdings('007301');

    expect(result.items).toEqual([]);
    expect(fetchUrlMock.mock.calls.some((c) => String(c[0]).includes('pingzhongdata'))).toBe(false);
  });

  it('falls back to pingzhongdata codes + push2 names/industry when mobile is down', async () => {
    fetchUrlMock.mockImplementation((url: string) => {
      if (String(url).includes('fundmobapi')) throw new Error('mobile down');
      if (String(url).includes('pingzhongdata')) return POSITION_SCRIPT;
      throw new Error(`Unexpected url: ${url}`);
    });
    fetchTextMock.mockImplementation((url: string) => {
      if (String(url).includes('ulist.np')) return JSON.stringify(ULIST_PAYLOAD);
      throw new Error(`Unexpected url: ${url}`);
    });
    const provider = new EastMoneyFundProvider();

    const result = await provider.holdings('110022');

    expect(result.items.map((i) => [i.stockCode, i.stockName, i.industry, i.market])).toEqual([
      ['600519', '贵州茅台', '白酒Ⅱ', '上海'],
      ['000333', '美的集团', '白色家电', '深圳'],
    ]);
    // pingzhongdata 已无占比字段 → 老实给 null，不再编造 0
    expect(result.items.every((i) => i.ratio === null)).toBe(true);
    expect(result.bondCodes).toEqual(['127045']);
    expect(result.reportDate).toBe('2026-06-30');

    const ulistUrl = String(fetchTextMock.mock.calls[0][0]);
    expect(ulistUrl).toContain('secids=1.600519,0.000333');
  });

  it('still returns the holding list when the push2 enrichment fails', async () => {
    fetchUrlMock.mockImplementation((url: string) => {
      if (String(url).includes('fundmobapi')) throw new Error('mobile down');
      return POSITION_SCRIPT;
    });
    fetchTextMock.mockImplementation(() => {
      throw new Error('push2 down');
    });
    const provider = new EastMoneyFundProvider();

    const result = await provider.holdings('110022');

    expect(result.items.map((i) => i.stockName)).toEqual(['600519', '000333']);
    expect(result.items.every((i) => i.industry === null)).toBe(true);
  });
});
