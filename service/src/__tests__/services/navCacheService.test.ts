import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

/** 造一条净值序列（日期连续，便于断言窗口切片）。 */
function series(from: string, days: number, start = 1) {
  const base = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    timestamp: null,
    nav: start + i / 100,
    accNav: null,
    dailyReturn: null,
    unitMoney: '元',
  }));
}

async function freshDb() {
  const { resetDbForTests, getDb } = await import('../../db/index.js');
  resetDbForTests();
  getDb();
  const { clearNavCache } = await import('../../services/navCacheService.js');
  clearNavCache();
}

describe('navCacheService', () => {
  beforeEach(freshDb);

  it('stores a series and reads any window out of it', async () => {
    const { saveNav, readNavItems, getNavMeta } = await import('../../services/navCacheService.js');
    saveNav('110022', series('2025-01-01', 100), { fetchedThrough: '2026-10-07', name: '测试基金' });

    const meta = getNavMeta('110022');
    expect(meta).toMatchObject({
      code: '110022',
      name: '测试基金',
      firstDate: '2025-01-01',
      lastDate: '2025-04-10',
      fetchedThrough: '2026-10-07',
    });

    expect(readNavItems('110022')).toHaveLength(100);
    const window = readNavItems('110022', { startDate: '2025-02-01', endDate: '2025-02-28' });
    expect(window).toHaveLength(28);
    expect(window[0].date).toBe('2025-02-01');
    expect(window[window.length - 1].date).toBe('2025-02-28');
    // 缓存条目补齐 DTO 形状（没有消费方的字段给 null）
    expect(window[0]).toMatchObject({ timestamp: null, dailyReturn: null, unitMoney: '元' });
  });

  it('merges by date (newer wins) and only moves `fetchedThrough` forward', async () => {
    const { saveNav, readNavItems, getNavMeta } = await import('../../services/navCacheService.js');
    saveNav('110022', series('2025-01-01', 10, 1), { fetchedThrough: '2026-01-01' });
    // 第二批：与第一批重叠 5 天，值不同
    saveNav('110022', series('2025-01-06', 10, 9), { fetchedThrough: '2025-06-01' });

    const items = readNavItems('110022');
    expect(items).toHaveLength(15);
    const overlap = items.find((item) => item.date === '2025-01-06');
    expect(overlap?.nav).toBeCloseTo(9); // 新的覆盖旧的
    expect(getNavMeta('110022')?.fetchedThrough).toBe('2026-01-01'); // 不倒退
  });

  it('treats a window in the past as covered even when the TTL lapsed', async () => {
    const { saveNav, getNavMeta, isCovered } = await import('../../services/navCacheService.js');
    saveNav('110022', series('2020-01-01', 300), { fetchedThrough: '2026-10-07' });
    const meta = { ...getNavMeta('110022')!, updatedAt: Date.now() - 30 * 24 * 3600 * 1000 };

    expect(isCovered(meta, { startDate: '2024-01-01', endDate: '2024-06-30' }, '2026-10-07')).toBe(true);
    // 但要的是「到今天」的窗口 → TTL 过期就得重取
    expect(isCovered(meta, { startDate: '2026-01-01', endDate: '2026-10-07' }, '2026-10-07')).toBe(false);
    // 新鲜度够就命中
    expect(isCovered({ ...meta, updatedAt: Date.now() }, { startDate: '2026-01-01', endDate: '2026-10-07' }, '2026-10-07')).toBe(true);
  });

  it('is not covered when the fetch never reached the window end', async () => {
    const { saveNav, getNavMeta, isCovered } = await import('../../services/navCacheService.js');
    saveNav('110022', series('2025-01-01', 10), { fetchedThrough: '2026-06-01' });
    const meta = getNavMeta('110022')!;
    expect(isCovered(meta, { endDate: '2026-09-30' }, '2026-10-07')).toBe(false);
    expect(isCovered(meta, { endDate: '2026-05-31' }, '2026-10-07')).toBe(true);
  });

  it('reports stats and can clear', async () => {
    const { saveNav, navCacheStats, clearNavCache } = await import('../../services/navCacheService.js');
    saveNav('110022', series('2025-01-01', 10));
    saveNav('161725', series('2025-01-01', 5));
    expect(navCacheStats()).toEqual({ funds: 2, points: 15 });

    clearNavCache('110022');
    expect(navCacheStats()).toEqual({ funds: 1, points: 5 });
    clearNavCache();
    expect(navCacheStats()).toEqual({ funds: 0, points: 0 });
  });
});
