import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

const fundMocks = vi.hoisted(() => ({
  getFundScreeningSnapshot: vi.fn(),
  getFundNavBatch: vi.fn(),
}));
vi.mock('../../services/fundService.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../services/fundService.js');
  return { ...actual, ...fundMocks };
});

function snapshot(items: Array<Record<string, unknown>>) {
  return {
    data: { items, failedPages: [], summary: { total: items.length, types: [], pageSize: 500 } },
    provider: 'test',
    fallback: false,
    cached: false,
    stale: false,
    updatedAt: new Date('2026-10-07T01:00:00Z'),
  };
}

function fund(code: string, name: string, type: string, returns: Record<string, number | null> = {}) {
  return {
    code,
    name,
    type,
    nav: 1,
    navDate: '2026-10-06',
    return1m: returns['1m'] ?? null,
    return3m: returns['3m'] ?? null,
    return6m: returns['6m'] ?? null,
    return1y: returns['1y'] ?? null,
    return2y: returns['2y'] ?? null,
    return3y: returns['3y'] ?? null,
    ytd: null,
    sinceInception: null,
    fee: null,
    source: 'test',
    updatedAt: '2026-10-07T01:00:00Z',
  };
}

/** 20 只同类基金，收益递减 —— 用来验证分组百分位。 */
function uniformGroup(prefix: string, type = '混合型') {
  return Array.from({ length: 20 }, (_, i) =>
    fund(`${prefix}${String(i).padStart(3, '0')}`, `${prefix}基金${i}`, type, {
      '3m': 30 - i,
      '6m': 60 - i,
      '1y': 100 - i * 2,
      '2y': 80 - i * 2,
      '3y': 120 - i * 2,
    })
  );
}

/** 400 个日频净值，一直到「今天」（风险指标要 200+ 个近一年交易日）。 */
function navSeries(days = 400): { date: string; nav: number }[] {
  const end = Date.now();
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    nav: 1 + i / 500,
  }));
}

async function freshDb() {
  const { resetDbForTests, getDb } = await import('../../db/index.js');
  resetDbForTests();
  const db = getDb();
  db.exec('DELETE FROM screening_funds; DELETE FROM screening_meta');
  return db;
}

describe('screeningService', () => {
  beforeEach(async () => {
    fundMocks.getFundScreeningSnapshot.mockReset();
    fundMocks.getFundNavBatch.mockReset();
    fundMocks.getFundNavBatch.mockResolvedValue({
      data: {},
      provider: 'test',
      fallback: false,
      cached: false,
      stale: false,
      updatedAt: new Date(),
    });
    await freshDb();
  });

  it('syncs the snapshot into SQLite with industry tags and 4433 ranks', async () => {
    fundMocks.getFundScreeningSnapshot.mockResolvedValue(snapshot(uniformGroup('A')));
    const { syncScreening, getScreeningStatus, queryScreening } = await import(
      '../../services/screeningService.js'
    );

    const result = await syncScreening({ force: true, enrichLimit: 1 });
    expect(result.total).toBe(20);
    expect(result.ranked).toBe(20);

    const status = getScreeningStatus();
    expect(status.basic_count).toBe(20);
    expect(status.type_counts['混合型']).toBe(20);
    // 20 只里排名前 25% 即 i ≤ 5（6 只，含边界 25.00）
    expect(status.pass_4433_count).toBeGreaterThan(0);
    expect(status.pass_4433_count).toBeLessThanOrEqual(6);

    const top = queryScreening({
      filters: { fund_types: ['混合型'] },
      sortByField: 'return_1y',
      sortOrder: 'desc',
      page: 1,
      pageSize: 1,
    });
    expect(top.total).toBe(20);
    expect(top.funds[0].fund_code).toBe('A000');
    expect(top.funds[0].rank_pct_1y).toBe(0);
  });

  it('keeps existing enrichment on re-sync and drops funds missing from the snapshot', async () => {
    fundMocks.getFundScreeningSnapshot.mockResolvedValue(snapshot(uniformGroup('A')));
    fundMocks.getFundNavBatch.mockResolvedValue({
      data: { A000: navSeries() },
      provider: 'test',
      fallback: false,
      cached: false,
      stale: false,
      updatedAt: new Date(),
    });
    const { syncScreening, getScreeningStatus, getAllScreeningFunds } = await import(
      '../../services/screeningService.js'
    );

    await syncScreening({ force: true, enrichLimit: 1 });
    const enriched = getAllScreeningFunds().find((row) => row.fund_code === 'A000');
    expect(enriched?.sharpe_ratio_1y).not.toBeNull();

    // 第二次同步：快照只剩 19 只（A000 变了名字 / A019 消失）
    fundMocks.getFundScreeningSnapshot.mockResolvedValue(snapshot(uniformGroup('A').slice(0, 19)));
    await syncScreening({ force: true, enrichLimit: 0 });

    const rows = getAllScreeningFunds();
    expect(rows).toHaveLength(19);
    expect(rows.find((row) => row.fund_code === 'A019')).toBeUndefined();
    // 已有风险指标不被覆盖
    expect(rows.find((row) => row.fund_code === 'A000')?.sharpe_ratio_1y).not.toBeNull();
    // 行业标签保留
    expect(rows.find((row) => row.fund_code === 'A000')?.industry_tag_name).toBeTruthy();
    expect(getScreeningStatus().computed).toBe(true);
  });

  it('marks funds without usable NAV as attempted so enrichment converges', async () => {
    fundMocks.getFundScreeningSnapshot.mockResolvedValue(snapshot(uniformGroup('A')));
    // 全部取不到净值
    fundMocks.getFundNavBatch.mockResolvedValue({
      data: {},
      provider: 'test',
      fallback: false,
      cached: false,
      stale: false,
      updatedAt: new Date(),
    });
    const { syncScreening, enrichScreening, getScreeningStatus } = await import(
      '../../services/screeningService.js'
    );

    await syncScreening({ force: true, enrichLimit: 0 });
    expect(getScreeningStatus().risk_metrics_pending).toBe(20);

    const first = await enrichScreening({ limit: 20 });
    expect(first.enriched).toBe(0);
    expect(first.remaining).toBe(0); // 已标记尝试 → 不再重试，前端循环能收敛

    const retry = await enrichScreening({ limit: 20, retry: true });
    expect(retry.remaining).toBe(0);
  });

  it('does not overwrite the cache when the snapshot comes back empty', async () => {
    fundMocks.getFundScreeningSnapshot.mockResolvedValue(snapshot(uniformGroup('A')));
    const { syncScreening, getScreeningStatus } = await import('../../services/screeningService.js');
    await syncScreening({ force: true, enrichLimit: 0 });

    fundMocks.getFundScreeningSnapshot.mockResolvedValue(snapshot([]));
    const result = await syncScreening({ force: true, enrichLimit: 0 });
    expect(result.total).toBe(0);
    expect(String(result.note)).toContain('未改动');
    expect(getScreeningStatus().basic_count).toBe(20);
  });

  it('reports `unchanged` when the snapshot is not newer', async () => {
    fundMocks.getFundScreeningSnapshot.mockResolvedValue(snapshot(uniformGroup('A')));
    const { syncScreening } = await import('../../services/screeningService.js');
    const result = await syncScreening({ since: '2030-01-01T00:00:00Z', enrichLimit: 0 });
    expect(result.unchanged).toBe(true);
  });

  it('query honours pass_4433, keyword and range filters', async () => {
    fundMocks.getFundScreeningSnapshot.mockResolvedValue(snapshot(uniformGroup('A')));
    const { syncScreening, queryScreening } = await import('../../services/screeningService.js');
    await syncScreening({ force: true, enrichLimit: 0 });

    expect(queryScreening({ filters: { pass_4433: true }, pageSize: 100 }).total).toBeGreaterThan(0);
    expect(queryScreening({ filters: { keyword: 'A00' }, pageSize: 100 }).total).toBe(10);
    expect(
      queryScreening({ filters: { return_1y_min: 90 }, pageSize: 100 }).funds.every(
        (row) => (row.return_1y ?? 0) >= 90
      )
    ).toBe(true);
    // 排序：null 永远排最后
    const sorted = queryScreening({ sortByField: 'sharpe_ratio_1y', sortOrder: 'desc', pageSize: 100 });
    expect(sorted.funds.every((row) => row.sharpe_ratio_1y === null)).toBe(true);
  });

  it('gives small groups (<3 funds) no ranks and pass_4433 = 0', async () => {
    fundMocks.getFundScreeningSnapshot.mockResolvedValue(
      snapshot([
        fund('B001', '小组基金一', '债券型', { '1y': 10, '2y': 10, '3m': 5, '6m': 5 }),
        fund('B002', '小组基金二', '债券型', { '1y': 8, '2y': 8, '3m': 4, '6m': 4 }),
      ])
    );
    const { syncScreening, getAllScreeningFunds } = await import('../../services/screeningService.js');
    await syncScreening({ force: true, enrichLimit: 0 });

    for (const row of getAllScreeningFunds()) {
      expect(row.rank_pct_1y).toBeNull();
      expect(row.pass_4433).toBe(0);
    }
  });

  it('serves industry tag counts and sandbox screen rows', async () => {
    fundMocks.getFundScreeningSnapshot.mockResolvedValue(snapshot(uniformGroup('A')));
    const { syncScreening, getIndustryTagCounts, getScreenRows } = await import(
      '../../services/screeningService.js'
    );
    await syncScreening({ force: true, enrichLimit: 0 });

    const tags = getIndustryTagCounts();
    expect(tags.reduce((sum, tag) => sum + tag.count, 0)).toBe(20);
    expect(tags[0].name).toBeTruthy();

    const rows = getScreenRows();
    expect(rows).toHaveLength(20);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['code', 'max_drawdown_1y', 'name', 'nav_date', 'return_1y', 'sharpe_ratio_1y', 'type'].sort()
    );
  });
});
