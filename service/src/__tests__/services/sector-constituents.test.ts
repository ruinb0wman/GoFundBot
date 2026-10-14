import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

const mocks = vi.hoisted(() => ({
  runPython: vi.fn(),
  sectorConstituents: vi.fn(),
}));

vi.mock('../../services/pythonRunner.js', () => ({ runPython: mocks.runPython }));

/** 只替换东财 provider 的 `sectorConstituents`，其余方法给出与真实类同形的空实现。 */
vi.mock('../../providers/eastmoney/eastmoneyMarketProvider.js', () => ({
  EastMoneyMarketProvider: class {
    readonly name = 'eastmoney';
    async sectorConstituents(code: string) {
      return mocks.sectorConstituents(code);
    }
  },
}));

const { getMarketSectorConstituents, getSectorConstituentsFromAkshare } = await import(
  '../../services/marketService.js'
);
const { cache } = await import('../../core/cache.js');

const eastmoneyItems = (code: string) => ({
  items: [
    { code, name: '贵州茅台', price: 1500, changePercent: 1.2, marketValue: 1.9e12, pe: 30, turnoverRate: 0.5 },
  ],
  sectorCode: 'BK0475',
  sectorName: '酿酒行业',
});

/** 复刻 python `fetch_board_constituents` 的返回形状。 */
const thsPayload = () => ({
  sector_cons: {
    name: '游戏',
    code: '881275',
    board_type: 'industry',
    items: [
      { code: '300299', name: '富春股份', price: 6.88, change_pct: 20.07, market_value: 4743000000, pe: 71.18, turnover_rate: 27.05 },
      { code: '603258', name: '电魂网络', price: 16.15, change_pct: 10.01, market_value: 3897999999, pe: null, turnover_rate: 4.63 },
    ],
  },
});

describe('板块成分股：东财 → 同花顺（按板块名）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it('uses EastMoney when it returns items for a BK code', async () => {
    mocks.sectorConstituents.mockResolvedValue(eastmoneyItems('600519'));

    const result = await getMarketSectorConstituents('BK0475');
    expect(result.provider).toBe('eastmoney');
    expect(result.data).toMatchObject({ sectorCode: 'BK0475', sectorName: '酿酒行业' });
    expect(result.data.items[0]).toMatchObject({ code: '600519', name: '贵州茅台', turnoverRate: 0.5 });
    expect(mocks.runPython).not.toHaveBeenCalled();
  });

  it('falls back to 同花顺 by name when EastMoney throws (push2 被限流)', async () => {
    mocks.sectorConstituents.mockRejectedValue(new Error('eastmoney endpoint is cooling down'));
    mocks.runPython.mockResolvedValue(thsPayload());

    const result = await getMarketSectorConstituents('', '游戏');
    expect(mocks.runPython).toHaveBeenCalledWith('data_complete.py', {
      args: ['--source', 'akshare', '--type', 'sector_cons', '--name', '游戏'],
      timeoutMs: 60_000,
    });
    expect(result.provider).toBe('akshare_ths');
    expect(result.fallback).toBe(true);
    expect(result.data).toMatchObject({ sectorCode: '881275', sectorName: '游戏' });
    expect(result.data.items.map((i) => i.name)).toEqual(['富春股份', '电魂网络']);
    // pe 为 null 时保持 null（不要编造 0）
    expect(result.data.items[1].pe).toBeNull();
  });

  it('falls back to 同花顺 when EastMoney returns an empty list (半截数据)', async () => {
    mocks.sectorConstituents.mockResolvedValue({ items: [], sectorCode: 'BK0475', sectorName: null });
    mocks.runPython.mockResolvedValue(thsPayload());

    const result = await getMarketSectorConstituents('BK0475', '游戏');
    expect(result.provider).toBe('akshare_ths');
    expect(result.fallback).toBe(true);
  });

  it('treats a Chinese board name passed as the code as a name (THS-sourced boards have code: "")', async () => {
    mocks.runPython.mockResolvedValue(thsPayload());

    const result = await getMarketSectorConstituents('游戏');
    expect(result.provider).toBe('akshare_ths');
    expect(mocks.sectorConstituents).not.toHaveBeenCalled(); // 没有 BK 代码就不打东财
    expect(mocks.runPython).toHaveBeenCalledTimes(1);
  });

  it('keeps the akshare result cached so a name is not re-scraped every call', async () => {
    mocks.runPython.mockResolvedValue(thsPayload());
    await getMarketSectorConstituents('', '游戏');
    await getMarketSectorConstituents('', '游戏');
    expect(mocks.runPython).toHaveBeenCalledTimes(1);
  });

  it('throws when a BK code failed and no name is available to fall back on', async () => {
    mocks.sectorConstituents.mockRejectedValue(new Error('boom'));
    await expect(getMarketSectorConstituents('BK0475')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(mocks.runPython).not.toHaveBeenCalled();
  });

  it('rejects a THS payload without usable items instead of reporting an empty board', async () => {
    mocks.runPython.mockResolvedValue({ sector_cons: { name: '游戏', code: '881275', items: [] } });
    await expect(getSectorConstituentsFromAkshare('游戏')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });

    // 只有占位行（无 code/name）也一样
    mocks.runPython.mockResolvedValue({ sector_cons: { items: [{ code: '', name: '' }] } });
    await expect(getSectorConstituentsFromAkshare('游戏')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});
