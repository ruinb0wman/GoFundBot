import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

const nav = vi.hoisted(() => ({ navHistory: vi.fn() }));

vi.mock('../../providers/eastmoney/eastmoneyFundProvider.js', () => ({
  EastMoneyFundProvider: class { navHistory = nav.navHistory },
  fetchFundCodeSearchList: vi.fn(),
}));
vi.mock('../../providers/joinquant/joinquantFundProvider.js', () => ({
  JoinQuantFundProvider: class { navHistory = nav.navHistory },
}));
vi.mock('../../providers/stock-sdk/stockSdkFundProvider.js', () => ({
  StockSdkFundProvider: class { navHistory = nav.navHistory },
}));
vi.mock('../../providers/tencent/tencentFundProvider.js', () => ({
  TencentFundProvider: class { navHistory = nav.navHistory },
}));

/** 连续日期的净值序列（便于断言窗口切片）。 */
function series(from: string, days: number) {
  const base = Date.parse(`${from}T00:00:00Z`);
  return {
    code: '110022',
    name: '测试基金',
    items: Array.from({ length: days }, (_, i) => ({
      date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
      timestamp: null,
      nav: 1 + i / 100,
      accNav: null,
      dailyReturn: null,
      unitMoney: '元',
    })),
  };
}

async function fresh() {
  const { resetDbForTests, getDb } = await import('../../db/index.js');
  resetDbForTests();
  getDb();
  const { clearNavCache } = await import('../../services/navCacheService.js');
  clearNavCache();
  const { cache } = await import('../../core/cache.js');
  cache.clear();
}

describe('fundService.getFundNavHistory 的缓存路径', () => {
  beforeEach(async () => {
    nav.navHistory.mockReset();
    await fresh();
  });

  it('misses → fetches once, persists the whole series, returns the requested window', async () => {
    nav.navHistory.mockResolvedValue(series('2025-01-01', 100));
    const { getFundNavHistory } = await import('../../services/fundService.js');
    const { navCacheStats } = await import('../../services/navCacheService.js');

    const result = await getFundNavHistory('110022', { startDate: '2025-02-01', endDate: '2025-02-28' });

    expect(nav.navHistory).toHaveBeenCalledTimes(1);
    expect(result.provider).not.toBe('sqlite-nav-cache');
    expect(result.data.items).toHaveLength(28);
    expect(result.data.items[0].date).toBe('2025-02-01');
    // 落库的是**整条**序列（100 点），不是窗口里的 28 点
    expect(navCacheStats()).toMatchObject({ funds: 1, points: 100 });
  });

  it('hits the SQLite cache and slices any window without re-fetching', async () => {
    nav.navHistory.mockResolvedValue(series('2025-01-01', 100));
    const { getFundNavHistory } = await import('../../services/fundService.js');
    const { cache } = await import('../../core/cache.js');

    await getFundNavHistory('110022', { startDate: '2025-02-01', endDate: '2025-02-28' });
    cache.clear(); // 只清内存缓存，逼它走 SQLite

    const again = await getFundNavHistory('110022', { startDate: '2025-02-01', endDate: '2025-02-28' });
    expect(nav.navHistory).toHaveBeenCalledTimes(1); // 没有第二次取数
    expect(again.provider).toBe('sqlite-nav-cache');
    expect(again.cached).toBe(true);
    expect(again.data.items).toHaveLength(28);

    const march = await getFundNavHistory('110022', { startDate: '2025-03-01', endDate: '2025-03-31' });
    expect(march.data.items).toHaveLength(31);
    expect(march.data.items[0].date).toBe('2025-03-01');
    expect(nav.navHistory).toHaveBeenCalledTimes(1); // 换窗口也不重拉
  });
});
