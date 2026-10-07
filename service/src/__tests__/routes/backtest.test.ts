import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.hoisted(() => {
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

const navMocks = vi.hoisted(() => ({ getFundNavHistory: vi.fn() }));
vi.mock('../../services/fundService.js', () => navMocks);

/** 造一条从 2025-01-01 起的日频净值（落在默认 3 年窗口内）。 */
function makeNav(days = 400, drift = 0.0004) {
  const start = Date.UTC(2025, 0, 1);
  const items: Array<{ date: string; nav: number }> = [];
  let nav = 1;
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * 86_400_000);
    nav = nav * (1 + drift) * (1 + Math.sin(i / 7) * 0.004);
    items.push({ date: d.toISOString().slice(0, 10), nav: Number(nav.toFixed(4)) });
  }
  return items;
}

function navResult(items: unknown) {
  return {
    data: { items },
    provider: 'test',
    fallback: false,
    cached: false,
    stale: false,
    updatedAt: new Date(),
  };
}

async function createApp() {
  const { backtestRouter } = await import('../../routes/backtest.routes.js');
  const { errorHandler, notFoundHandler } = await import('../../core/errors.js');
  const app = express();
  app.use(express.json());
  app.use('/api/backtest', backtestRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('POST /api/backtest/fixed-investment', () => {
  beforeEach(() => {
    navMocks.getFundNavHistory.mockReset();
    navMocks.getFundNavHistory.mockResolvedValue(navResult(makeNav()));
  });

  it('returns a sampled payload with the summary', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/backtest/fixed-investment')
      .send({ fund_code: '110022', amount: 1000, investment_type: 'monthly' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.fund_code).toBe('110022');
    expect(res.body.data.summary).toBeTypeOf('object');
    expect(res.body.data.checkpoints.length).toBeGreaterThan(0);
    expect(res.body.data.summary.total_invested).toBeGreaterThan(0);
    expect(navMocks.getFundNavHistory).toHaveBeenCalled();
  });

  it('rejects a missing fund_code with 400', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/backtest/fixed-investment').send({ amount: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
    expect(navMocks.getFundNavHistory).not.toHaveBeenCalled();
  });

  it('reports empty NAV as an inline error (200 + data.error)', async () => {
    navMocks.getFundNavHistory.mockResolvedValue(navResult([]));
    const app = await createApp();
    const res = await request(app)
      .post('/api/backtest/fixed-investment')
      .send({ fund_code: '110022' });
    expect(res.status).toBe(200);
    expect(res.body.data.error).toContain('未获取到');
  });

  it('reports a provider failure as an inline error', async () => {
    navMocks.getFundNavHistory.mockRejectedValue(new Error('provider down'));
    const app = await createApp();
    const res = await request(app)
      .post('/api/backtest/fixed-investment')
      .send({ fund_code: '110022' });
    expect(res.status).toBe(200);
    expect(res.body.data.error).toContain('provider down');
  });
});

describe('POST /api/backtest/portfolio', () => {
  beforeEach(() => {
    navMocks.getFundNavHistory.mockReset();
    navMocks.getFundNavHistory.mockResolvedValue(navResult(makeNav()));
  });

  it('runs a two-fund portfolio and returns sampled assets', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/backtest/portfolio')
      .send({
        assets: [
          { fund_code: '110022', weight: 0.6 },
          { fund_code: '161725', weight: 0.4 },
        ],
        initial_amount: 10000,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toBeTypeOf('object');
    expect(res.body.data.assets).toHaveLength(2);
    expect(res.body.data.effective_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('supports a cash leg (no fund_code)', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/backtest/portfolio')
      .send({ assets: [{ fund_code: '110022', weight: 0.7 }, { weight: 0.3, annual_rate: 0.02 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.assets.map((a: { kind: string }) => a.kind)).toContain('cash');
  });

  it('rejects an empty assets array with 400', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/backtest/portfolio').send({ assets: [] });
    expect(res.status).toBe(400);
  });

  it('reports an inline error when every fund has no NAV', async () => {
    navMocks.getFundNavHistory.mockResolvedValue(navResult([]));
    const app = await createApp();
    const res = await request(app)
      .post('/api/backtest/portfolio')
      .send({ assets: [{ fund_code: '110022', weight: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.error).toContain('未获取到');
  });
});

describe('POST /api/backtest/compare-strategies', () => {
  beforeEach(() => {
    navMocks.getFundNavHistory.mockReset();
    navMocks.getFundNavHistory.mockResolvedValue(navResult(makeNav()));
  });

  it('returns the recommended strategy plus the alternatives', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/backtest/compare-strategies')
      .send({ fund_code: '110022' });

    expect(res.status).toBe(200);
    expect(res.body.data.recommended.key).toBeTruthy();
    expect(res.body.data.strategies.length).toBeGreaterThan(1);
    expect(res.body.data.range).toMatch(/^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/);
  });

  it('rejects a missing fund_code with 400', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/backtest/compare-strategies').send({});
    expect(res.status).toBe(400);
  });
});
