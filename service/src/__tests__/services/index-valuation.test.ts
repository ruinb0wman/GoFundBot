import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SH300_FIRST_TS, SH300_LAST_TS, sh300PeSeries } from '../fixtures/danjuan-pe.js';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

const mocks = vi.hoisted(() => ({
  fetchIndexPeHistory: vi.fn(),
}));

vi.mock('../../services/pythonRunner.js', () => ({ runPython: vi.fn() }));
vi.mock('../../providers/danjuan/danjuanValuationClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/danjuan/danjuanValuationClient.js')>();
  // 只替换取数；`toDanjuanCode` 保持真实实现（service 用它判断是否支持该代码）。
  return { ...actual, fetchIndexPeHistory: mocks.fetchIndexPeHistory };
});

const { getIndexValuation } = await import('../../services/valuationService.js');
const { cache } = await import('../../core/cache.js');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 用真实 PE 序列 + 人为周频时间戳拼点（分位/分档只看 pe，日期只影响 as_of/window）。 */
function sh300Points() {
  const series = sh300PeSeries();
  return series.map((pe, i) => ({
    ts: i === series.length - 1 ? SH300_LAST_TS : SH300_FIRST_TS + i * WEEK_MS,
    pe,
  }));
}

describe('指数估值 getIndexValuation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.delete('market:valuation:sh000300');
    cache.delete('market:valuation:sh000001');
    cache.delete('market:valuation:sh000688');
  });

  it('returns PE + percentile + 三档分位值（真实 516 点序列的黄金数字）', async () => {
    mocks.fetchIndexPeHistory.mockResolvedValue(sh300Points());

    const result = await getIndexValuation('sh000300');

    expect(result.data).toMatchObject({
      code: 'sh000300',
      source_code: 'SH000300',
      data_status: 'available',
      source: 'danjuan',
      definition: '加权滚动PE(TTM) · 20/50/80 分位',
    });
    expect(result.data.pe).toBeCloseTo(12.7291, 4);
    expect(result.data.percentile).toBeCloseTo(0.4961, 4);
    expect(result.data.bands.opportunity).toBeCloseTo(11.7383, 4);
    expect(result.data.bands.median).toBeCloseTo(12.737, 4);
    expect(result.data.bands.danger).toBeCloseTo(14.1813, 4);
    expect(result.data.window).toEqual({
      start: '2016-10-24',
      end: '2026-10-22',
      points: 516,
      freq: 'weekly',
    });
    // as_of 按北京时间：数据源时间戳是北京 00:00，直接 toISOString 会退一天。
    expect(result.data.as_of).toBe('2026-10-22');
    expect(result.cached).toBe(false);
  });

  it('caches the result for 6h (second call does not hit the source)', async () => {
    mocks.fetchIndexPeHistory.mockResolvedValue(sh300Points());

    await getIndexValuation('sh000300');
    const second = await getIndexValuation('sh000300');

    expect(mocks.fetchIndexPeHistory).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
    expect(second.data.pe).toBeCloseTo(12.7291, 4);
  });

  it('reports unavailable for an uncovered index and does not cache it', async () => {
    mocks.fetchIndexPeHistory.mockResolvedValue([]);

    const first = await getIndexValuation('sh000001');
    const second = await getIndexValuation('sh000001');

    expect(first.data.data_status).toBe('unavailable');
    expect(first.data.error).toContain('未收录');
    expect(first.data.pe).toBeNull();
    // 瞬时失败/未收录都不能被缓存钉住 6 小时。
    expect(mocks.fetchIndexPeHistory).toHaveBeenCalledTimes(2);
    expect(second.data.data_status).toBe('unavailable');
  });

  it('degrades to unavailable instead of throwing when the source fails', async () => {
    mocks.fetchIndexPeHistory.mockRejectedValue(new Error('direct blocked'));

    const result = await getIndexValuation('sh000688');

    expect(result.data.data_status).toBe('unavailable');
    expect(result.data.error).toBe('估值数据源暂不可用');
    expect(result.data.bands).toEqual({ opportunity: null, median: null, danger: null });
  });

  it('rejects non A-share codes without any request', async () => {
    for (const symbol of ['DJI', 'BTC', 'hkHSI', 'bj430047']) {
      const result = await getIndexValuation(symbol);
      expect(result.data.data_status).toBe('unavailable');
      expect(result.data.error).toBe('仅支持 A 股股票指数');
    }
    expect(mocks.fetchIndexPeHistory).not.toHaveBeenCalled();
  });

  it('normalizes dotted codes from the EastMoney style', async () => {
    mocks.fetchIndexPeHistory.mockResolvedValue(sh300Points());

    const result = await getIndexValuation('1.000300');

    expect(result.data.code).toBe('sh000300');
    expect(mocks.fetchIndexPeHistory).toHaveBeenCalledWith('sh000300');
  });
});
