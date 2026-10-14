import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

const mocks = vi.hoisted(() => ({ runPython: vi.fn() }));

vi.mock('../../services/pythonRunner.js', () => ({ runPython: mocks.runPython }));

const { getMarketConceptSectorsFromAkshare, resetConceptSpotCache } = await import('../../services/marketService.js');

/** 复刻 python `complete_concept_spot` 的返回形状。 */
const spotPayload = (items: unknown[]) => ({ concept_spot: { date: '2026-10-14', items } });

const item = (name: string) => ({
  name,
  code: '',
  change_pct: '+2.27%',
  raw_change: 2.27,
  main_inflow: '+11.46亿',
  raw_main_inflow: 1146000000,
  index_value: 2798.78,
  company_count: 56,
  leader: '富春股份',
  leader_change_pct: 20.07,
  event: '',
  event_date: '',
});

describe('概念板块 serve-stale 缓存', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConceptSpotCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns fresh akshare_ths data and marks it not stale', async () => {
    mocks.runPython.mockResolvedValue(spotPayload([item('手机游戏'), item('短剧游戏')]));

    const result = await getMarketConceptSectorsFromAkshare(5);
    expect(result).toMatchObject({ source: 'akshare_ths', data_date: '2026-10-14' });
    expect(result.stale).toBeUndefined();
    expect(result.items.map((i) => i.name)).toEqual(['手机游戏', '短剧游戏']);
  });

  it('serves the snapshot from cache inside the fresh window without spawning python again', async () => {
    mocks.runPython.mockResolvedValue(spotPayload([item('手机游戏'), item('短剧游戏')]));
    await getMarketConceptSectorsFromAkshare(5);
    expect(mocks.runPython).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    const cached = await getMarketConceptSectorsFromAkshare(1);
    expect(mocks.runPython).toHaveBeenCalledTimes(1); // 新鲜窗口内不再打上游
    expect(cached.items.map((i) => i.name)).toEqual(['手机游戏']); // limit 仍然生效
    expect(cached.stale).toBeUndefined();
  });

  it('falls back to the last good snapshot (stale=true) instead of an empty card', async () => {
    mocks.runPython.mockResolvedValue(spotPayload([item('手机游戏'), item('短剧游戏')]));
    await getMarketConceptSectorsFromAkshare(5);

    vi.advanceTimersByTime(60_000); // 越过新鲜窗口，仍在 10min 的 stale 窗口内
    mocks.runPython.mockRejectedValue(new Error("akshare concept spot failed: 'NoneType' object has no attribute 'text'"));

    const stale = await getMarketConceptSectorsFromAkshare(5);
    expect(mocks.runPython).toHaveBeenCalledTimes(2);
    expect(stale).toMatchObject({ source: 'akshare_ths', stale: true });
    expect(stale.items.map((i) => i.name)).toEqual(['手机游戏', '短剧游戏']);
    expect(stale.stale_reason).toContain('NoneType');
    expect(stale.error).toBeUndefined(); // 有数据就不算 error，避免路由把 items 丢掉
  });

  it('treats an empty upstream result as a failure too', async () => {
    mocks.runPython.mockResolvedValue(spotPayload([item('手机游戏')]));
    await getMarketConceptSectorsFromAkshare(5);

    vi.advanceTimersByTime(60_000);
    mocks.runPython.mockResolvedValue(spotPayload([]));

    const stale = await getMarketConceptSectorsFromAkshare(5);
    expect(stale).toMatchObject({ stale: true });
    expect(stale.stale_reason).toContain('empty result');
  });

  it('reports unavailable when it fails and has no snapshot to fall back on', async () => {
    mocks.runPython.mockRejectedValue(new Error('boom'));

    const result = await getMarketConceptSectorsFromAkshare(5);
    expect(result).toMatchObject({ source: 'failed', items: [], error: '概念板块数据源不可用' });
    expect(result.stale).toBeUndefined();
  });

  it('stops serving the snapshot once it is older than the stale window', async () => {
    mocks.runPython.mockResolvedValue(spotPayload([item('手机游戏')]));
    await getMarketConceptSectorsFromAkshare(5);

    vi.advanceTimersByTime(11 * 60_000); // 超过 10 分钟
    mocks.runPython.mockRejectedValue(new Error('boom'));

    const result = await getMarketConceptSectorsFromAkshare(5);
    expect(result).toMatchObject({ source: 'failed', items: [] });
  });
});
