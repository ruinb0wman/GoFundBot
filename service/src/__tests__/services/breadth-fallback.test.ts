import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

const mocks = vi.hoisted(() => ({
  runPython: vi.fn(),
  fetchMarketBreadth: vi.fn(),
}));

vi.mock('../../services/pythonRunner.js', () => ({ runPython: mocks.runPython }));
vi.mock('../../providers/eastmoney/marketBreadth.js', () => ({ fetchMarketBreadth: mocks.fetchMarketBreadth }));

const { getMarketBreadth, getMarketBreadthFromAkshare } = await import('../../services/marketService.js');
const { cache } = await import('../../core/cache.js');

/** 东财不可用时的 DTO（与 `marketBreadth.ts` 的 empty 同形状）。 */
const eastmoneyUnavailable = (error: string) => ({
  upCount: 0,
  downCount: 0,
  flatCount: 0,
  limitUp: null,
  limitDown: null,
  total: 0,
  scope: '沪深两市',
  date: '',
  data_status: 'unavailable' as const,
  error,
});

/** 复刻 python `complete_market_breadth` 的返回形状。 */
const leguPayload = (overrides: Record<string, unknown> = {}) => ({
  breadth: {
    date: '2026-10-14',
    up_count: 918,
    down_count: 4213,
    flat_count: 83,
    limit_up: 39,
    limit_down: 13,
    total: 5214,
    scope: '沪深两市',
    ...overrides,
  },
});

describe('涨跌家数：东财 push2 被限流时回退到乐咕', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.delete('market:breadth');
  });

  it('returns eastmoney data when push2 works (no fallback)', async () => {
    mocks.fetchMarketBreadth.mockResolvedValue({
      upCount: 1372,
      downCount: 3796,
      flatCount: 123,
      limitUp: 39,
      limitDown: 5,
      total: 5291,
      scope: '沪深两市',
      date: '2026-10-14',
      data_status: 'available',
    });

    const result = await getMarketBreadth();
    expect(result.data).toMatchObject({ upCount: 1372, data_status: 'available' });
    expect(result.provider).toBe('eastmoney');
    expect(result.fallback).toBe(false);
    expect(mocks.runPython).not.toHaveBeenCalled();
  });

  it('falls back to 乐咕 when eastmoney reports unavailable (push2 blocked)', async () => {
    mocks.fetchMarketBreadth.mockResolvedValue(eastmoneyUnavailable('涨跌家数抓取失败：fetch failed'));
    mocks.runPython.mockResolvedValue(leguPayload());

    const result = await getMarketBreadth();
    expect(mocks.runPython).toHaveBeenCalledWith('data_complete.py', {
      args: ['--source', 'akshare', '--type', 'breadth'],
      timeoutMs: 30_000,
    });
    expect(result.data).toMatchObject({
      upCount: 918,
      downCount: 4213,
      flatCount: 83,
      limitUp: 39,
      limitDown: 13,
      total: 5214,
      date: '2026-10-14',
      data_status: 'available',
    });
    expect(result.provider).toBe('akshare_legu');
    expect(result.fallback).toBe(true);
  });

  it('falls back when eastmoney throws outright (breaker open)', async () => {
    mocks.fetchMarketBreadth.mockRejectedValue(new Error('eastmoney endpoint is cooling down'));
    mocks.runPython.mockResolvedValue(leguPayload());

    const result = await getMarketBreadth();
    expect(result.data.data_status).toBe('available');
    expect(result.provider).toBe('akshare_legu');
  });

  it('still reports unavailable (not zeros) when both sources fail', async () => {
    mocks.fetchMarketBreadth.mockResolvedValue(eastmoneyUnavailable('fetch failed'));
    mocks.runPython.mockRejectedValue(new Error('akshare market activity failed: timeout'));

    const result = await getMarketBreadth();
    expect(result.data.data_status).toBe('unavailable');
    expect(result.data.total).toBe(0);
    expect(result.data.error).toContain('eastmoney: fetch failed');
    expect(result.data.error).toContain('akshare: akshare market activity failed');
  });

  it('does not cache the unavailable result (so one blip cannot pin 0 家上涨)', async () => {
    mocks.fetchMarketBreadth.mockResolvedValue(eastmoneyUnavailable('fetch failed'));
    mocks.runPython.mockRejectedValue(new Error('boom'));
    await getMarketBreadth();
    expect(cache.get('market:breadth')).toBeNull();

    // 上游恢复后立刻能拿到真数据
    mocks.runPython.mockResolvedValue(leguPayload());
    const recovered = await getMarketBreadth();
    expect(recovered.data).toMatchObject({ upCount: 918, data_status: 'available' });
  });

  it('rejects a legu payload with no counts / no date instead of reporting zeros', async () => {
    mocks.runPython.mockResolvedValue({}); // python 没给 breadth
    await expect(getMarketBreadthFromAkshare()).resolves.toMatchObject({ data_status: 'unavailable' });

    mocks.runPython.mockResolvedValue(leguPayload({ up_count: 0, down_count: 0 }));
    const zero = await getMarketBreadthFromAkshare();
    expect(zero.data_status).toBe('unavailable');
    expect(zero.error).toContain('乐咕涨跌家数异常');

    mocks.runPython.mockResolvedValue(leguPayload({ date: '' }));
    await expect(getMarketBreadthFromAkshare()).resolves.toMatchObject({ data_status: 'unavailable' });
  });

  it('keeps limitUp/limitDown null when legu does not provide them', async () => {
    mocks.runPython.mockResolvedValue(leguPayload({ limit_up: null, limit_down: null }));
    const result = await getMarketBreadthFromAkshare();
    expect(result).toMatchObject({ data_status: 'available', limitUp: null, limitDown: null });
  });
});
