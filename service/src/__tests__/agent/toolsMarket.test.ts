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
  getMarketConceptSectorsFromAkshare: vi.fn(),
  getMarketBreadth: vi.fn(),
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

  it('reports sector constituents and rejects a call with no code and no name', async () => {
    const app = await createApp();
    const ok = await call(app, 'get_sector_constituents', { sector_code: 'BK0475' });
    expect(ok.body.data.result).toMatchObject({ data_status: 'available', sector_name: '酿酒行业', count: 1 });

    // 两个参数都空 → Zod refine 拦下（INVALID_ARGUMENT），不去请求上游
    const blank = await call(app, 'get_sector_constituents', { sector_code: ' ' });
    expect(blank.body.success).toBe(false);
    expect(mocks.getMarketSectorConstituents).toHaveBeenCalledTimes(1);
  });

  it('accepts a sector name for boards whose data source has no code (THS fallback)', async () => {
    // 同花顺降级的行业板块只给 name，旧契约下这条成分股根本查不了
    mocks.getMarketSectorConstituents.mockResolvedValue({
      ...serviceResult({
        items: [
          { code: '300299', name: '富春股份', price: 6.88, changePercent: 20.07, marketValue: 4743000000, pe: 71.18, turnoverRate: 27.05 },
        ],
        sectorCode: '881275',
        sectorName: '游戏',
      }),
      provider: 'akshare_ths',
      fallback: true,
    });

    const app = await createApp();
    const res = await call(app, 'get_sector_constituents', { sector_name: '游戏' });
    expect(mocks.getMarketSectorConstituents).toHaveBeenCalledWith('', '游戏');
    expect(res.body.data.result).toMatchObject({
      data_status: 'available',
      provider: 'akshare_ths',
      fallback: true,
      sector_code: '881275',
      sector_name: '游戏',
      count: 1,
    });
    expect(res.body.data.result.items[0]).toMatchObject({ code: '300299', name: '富春股份' });
  });

  // 回归：`getMarketConceptSectorsFromAkshare` 返回的是 { items, source, data_date }，
  // **不是** ServiceResult / 路由信封。曾经在这个 handler 里读 `body.data` → items 恒空，
  // 工具永远报 unavailable，而 HTTP 路由一直是好的。
  it('reads concept sectors from the service return shape (items), not a route envelope', async () => {
    mocks.getMarketConceptSectorsFromAkshare.mockResolvedValue({
      items: [
        { name: '手机游戏', code: '', change_pct: '+2.27%', raw_change: 2.27, main_inflow: '+11.46亿', raw_main_inflow: 1146000000 },
        { name: '短剧游戏', code: '', change_pct: '+2.09%', raw_change: 2.09, main_inflow: '+21.91亿', raw_main_inflow: 2191000000 },
      ],
      source: 'akshare_ths',
      data_date: '2026-10-14',
    });

    const app = await createApp();
    const res = await call(app, 'get_concept_sectors', { limit: 5 });
    expect(mocks.getMarketConceptSectorsFromAkshare).toHaveBeenCalledWith(5);
    expect(res.body.data.result).toMatchObject({
      data_status: 'available',
      date: '2026-10-14',
      source: 'akshare_ths',
      count: 2,
    });
    expect(res.body.data.result.items.map((i: { name: string }) => i.name)).toEqual(['手机游戏', '短剧游戏']);
  });

  it('tells the model when concept sectors came from the serve-stale fallback', async () => {
    mocks.getMarketConceptSectorsFromAkshare.mockResolvedValue({
      items: [
        { name: '手机游戏', code: '', change_pct: '+2.27%', raw_change: 2.27, main_inflow: '+11.46亿', raw_main_inflow: 1146000000 },
      ],
      source: 'akshare_ths',
      data_date: '2026-10-14',
      stale: true,
      stale_reason: '概念板块本次抓取失败（超时），返回 90s 前的快照',
    });

    const app = await createApp();
    const res = await call(app, 'get_concept_sectors', { limit: 5 });
    expect(res.body.data.result).toMatchObject({ data_status: 'available', count: 1, stale: true });
    expect(res.body.data.result.note).toContain('本次抓取失败');
    expect(res.body.data.result.note).toContain('90s 前的快照');
  });

  it('labels the breadth fallback source so the model knows the 口径 differs', async () => {
    mocks.getMarketBreadth.mockResolvedValue({
      ...serviceResult({
        upCount: 918,
        downCount: 4213,
        flatCount: 83,
        limitUp: 39,
        limitDown: 13,
        total: 5214,
        scope: '沪深两市',
        date: '2026-10-14',
        data_status: 'available',
      }),
      provider: 'akshare_legu',
      fallback: true,
    });

    const app = await createApp();
    const res = await call(app, 'get_market_breadth', {});
    expect(res.body.data.result).toMatchObject({
      data_status: 'available',
      provider: 'akshare_legu',
      fallback: true,
      up_count: 918,
      down_count: 4213,
    });
    expect(res.body.data.result.note).toContain('备用源 akshare_legu');
    expect(res.body.data.result.note).toContain('不要与其他来源逐位对比');
  });

  it('notes when limit up/down counts are missing instead of reporting them as zero', async () => {
    mocks.getMarketBreadth.mockResolvedValue(
      serviceResult({
        upCount: 3000,
        downCount: 1000,
        flatCount: 100,
        limitUp: null,
        limitDown: null,
        total: 4100,
        scope: '沪深两市',
        date: '2026-10-14',
        data_status: 'available',
      }),
    );

    const app = await createApp();
    const res = await call(app, 'get_market_breadth', {});
    expect(res.body.data.result).toMatchObject({ data_status: 'available', limit_up: null, limit_down: null });
    expect(res.body.data.result.note).toContain('仅涨跌家数有效');
  });

  it('keeps concept sectors unavailable (with the upstream error) when the source fails', async () => {
    mocks.getMarketConceptSectorsFromAkshare.mockResolvedValue({
      items: [],
      source: 'failed',
      data_date: '',
      error: '概念板块数据源不可用',
    });

    const app = await createApp();
    const res = await call(app, 'get_concept_sectors', { limit: 5 });
    expect(res.body.data.result).toMatchObject({ data_status: 'unavailable', count: 0, items: [] });
    expect(res.body.data.result.note).toContain('概念板块数据源不可用');
  });
});
