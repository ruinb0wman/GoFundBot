import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EastMoneyFundProvider } from '../../providers/eastmoney/eastmoneyFundProvider.js';

const { fetchTextMock } = vi.hoisted(() => ({ fetchTextMock: vi.fn() }));

vi.mock('../../providers/eastmoney/eastmoneyRequest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/eastmoney/eastmoneyRequest.js')>();
  return { ...actual, fetchText: fetchTextMock };
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
