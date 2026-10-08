import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

const mocks = vi.hoisted(() => ({
  getMarketKline: vi.fn(),
  getAVolume7Days: vi.fn(),
  getMarketSectorConstituents: vi.fn(),
}));

vi.mock('../../services/marketService.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../services/marketService.js');
  return { ...actual, ...mocks };
});

/** 造一个 ServiceResult 信封（`unwrapServiceResult` 靠这几个字段识别）。 */
const serviceResult = (data: unknown) => ({
  data,
  provider: 'test',
  fallback: false,
  cached: false,
  stale: false,
  updatedAt: new Date(),
});

async function createApp() {
  const { agentRouter } = await import('../../routes/agent.routes.js');
  const { errorHandler, notFoundHandler } = await import('../../core/errors.js');
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const call = (app: express.Express, tool: string, args: Record<string, unknown>) =>
  request(app).post('/api/agent/call').send({ tool, args });

describe('行情细节工具', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMarketKline.mockResolvedValue(
      serviceResult([
        { code: '000001', date: '2026-10-08', open: 1, close: 2, high: 3, low: 0.5, volume: 10, amount: 20 },
      ]),
    );
    mocks.getAVolume7Days.mockResolvedValue({
      success: true,
      update_time: '2026-10-08T00:00:00.000Z',
      data: [{ date: '2026-10-08', total: '16821.27亿', shanghai: '8111.83亿', shenzhen: '8709.44亿', beijing: '0亿' }],
    });
    mocks.getMarketSectorConstituents.mockResolvedValue(
      serviceResult({ items: [{ code: '600519', name: '贵州茅台' }], sectorCode: 'BK0475', sectorName: '酿酒行业' }),
    );
  });

  it('unwraps the ServiceResult so index kline is not silently empty', async () => {
    const app = await createApp();
    const res = await call(app, 'get_index_kline', { code: 'sh000001', start_date: '2026-10-01', end_date: '2026-10-08' });
    expect(res.body.data.result.count).toBe(1);
    expect(res.body.data.result.kline[0].date).toBe('2026-10-08');
  });

  it('returns individual-stock kline with the adjust flag', async () => {
    const app = await createApp();
    const res = await call(app, 'get_stock_kline', {
      code: 'sz000001',
      start_date: '2026-10-01',
      end_date: '2026-10-08',
      adjust: 'qfq',
    });
    expect(mocks.getMarketKline).toHaveBeenCalledWith('sz000001', {
      startDate: '2026-10-01',
      endDate: '2026-10-08',
      period: 'daily',
      adjust: 'qfq',
    });
    expect(res.body.data.result).toMatchObject({ count: 1, adjust: 'qfq' });
  });

  it('flags empty volume data as unavailable instead of zero', async () => {
    const app = await createApp();
    const ok = await call(app, 'get_a_volume_7days', {});
    expect(ok.body.data.result.data_status).toBe('available');
    expect(ok.body.data.result.data).toHaveLength(1);

    mocks.getAVolume7Days.mockResolvedValue({ success: false, update_time: 'x', data: [] });
    const empty = await call(app, 'get_a_volume_7days', {});
    expect(empty.body.data.result).toMatchObject({ data_status: 'unavailable', data: [] });
    expect(empty.body.data.result.note).toContain('不是 0');
  });

  it('reports sector constituents and guards the empty-code fallback', async () => {
    const app = await createApp();
    const ok = await call(app, 'get_sector_constituents', { sector_code: 'BK0475' });
    expect(ok.body.data.result).toMatchObject({ data_status: 'available', sector_name: '酿酒行业', count: 1 });

    const blank = await call(app, 'get_sector_constituents', { sector_code: ' ' });
    expect(blank.body.data.result.data_status).toBe('unavailable');
    expect(blank.body.data.result.note).toContain('code 为空');
    expect(mocks.getMarketSectorConstituents).toHaveBeenCalledTimes(1); // 空 code 不请求上游
  });
});
