import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

const navMocks = vi.hoisted(() => ({ fetchNavPoints: vi.fn(), getScreenRows: vi.fn() }));
vi.mock('../../services/backtestService.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../services/backtestService.js');
  return { ...actual, fetchNavPoints: navMocks.fetchNavPoints };
});
vi.mock('../../services/screeningService.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../services/screeningService.js');
  return { ...actual, getScreenRows: navMocks.getScreenRows };
});

function series(from: string, days: number) {
  const base = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => ({
    date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    nav: 1 + i / 200,
  }));
}

const BUY_MONTHLY = `
function prepare(sdk) {
  const pool = sdk.screen({ type: '混合型' });
  return { start: '2025-01-01', end: '2025-12-31', assets: pool.map((row) => row.code).slice(0, 2), initialAmount: 1000 };
}
function onDay(s) {
  if (s.date.endsWith('-01')) return { buy: [{ code: s.codes[0], amount: 500 }] };
  return {};
}
`;

describe('runStrategyCode (node:worker_threads sandbox)', () => {
  beforeEach(() => {
    navMocks.fetchNavPoints.mockReset();
    navMocks.getScreenRows.mockReset();
    navMocks.getScreenRows.mockReturnValue([
      { code: '110022', name: '测试混合', type: '混合型', return_1y: 10, sharpe_ratio_1y: 1, max_drawdown_1y: -5, nav_date: '2025-12-31' },
      { code: '161725', name: '测试混合2', type: '混合型', return_1y: 8, sharpe_ratio_1y: 0.9, max_drawdown_1y: -6, nav_date: '2025-12-31' },
      { code: '000003', name: '测试债券', type: '债券型', return_1y: 3, sharpe_ratio_1y: 2, max_drawdown_1y: -1, nav_date: '2025-12-31' },
    ]);
    navMocks.fetchNavPoints.mockImplementation(async () => series('2024-06-01', 600)); // 覆盖整个 2025 年
  });

  it('runs prepare(sdk).screen() and onDay(s) in a worker and returns the engine result', async () => {
    const { runStrategyCodeRaw } = await import('../../sandbox/runStrategyCode.js');
    const outcome = await runStrategyCodeRaw(BUY_MONTHLY);
    if ('error' in outcome) throw new Error(outcome.error);

    expect(outcome.plan.assets).toEqual(['110022', '161725']); // sdk.screen 过滤掉了债券型
    expect(outcome.result.summary.buy_count).toBe(12);
    expect(outcome.result.summary.total_invested).toBeGreaterThan(0);
    expect(navMocks.fetchNavPoints).toHaveBeenCalledTimes(2);
  });

  it('kills an infinite loop with the timeout instead of hanging', async () => {
    const { planStrategyCode } = await import('../../sandbox/runStrategyCode.js');
    const started = Date.now();
    const outcome = await planStrategyCode('function prepare() { while (true) {} }\nfunction onDay() { return {} }', [], undefined, 700);
    expect('error' in outcome && outcome.error).toContain('超时');
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('reports code errors as messages, not exceptions', async () => {
    const { runStrategyCodeRaw } = await import('../../sandbox/runStrategyCode.js');
    const outcome = await runStrategyCodeRaw('const x = 1');
    expect('error' in outcome && outcome.error).toContain('onDay');
  });
});
