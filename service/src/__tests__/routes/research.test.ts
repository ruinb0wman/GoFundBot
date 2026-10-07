import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

async function seed() {
  const { resetDbForTests, getDb } = await import('../../db/index.js');
  resetDbForTests();
  const db = getDb();
  db.exec('DELETE FROM screening_funds');
  const insert = db.prepare(
    `INSERT INTO screening_funds
       (fund_code, fund_name, fund_type, return_1y, return_3m, sharpe_ratio_1y, pass_4433, industry_tag_name, updated_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // 4 只：两只通过 4433、三只有夏普；分属两个类型
  insert.run('000001', '测试混合A', '混合型', 10, 3, 1.2, 1, '科技', '2026-10-01T00:00:00Z');
  insert.run('000002', '测试混合B', '混合型', 5, -1, 0.8, 0, '科技', '2026-10-02T00:00:00Z');
  insert.run('000003', '测试债券A', '债券型', 3, 1, null, 1, '固收', '2026-10-03T00:00:00Z');
  insert.run('000004', '测试债券B', '债券型', -2, -3, null, 0, '固收', '2026-10-03T00:00:00Z');
}

async function createApp() {
  const { researchRouter } = await import('../../routes/research.routes.js');
  const { errorHandler, notFoundHandler } = await import('../../core/errors.js');
  const app = express();
  app.use(express.json());
  app.use('/api/research', researchRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('GET /api/research/dashboard', () => {
  beforeEach(seed);

  it('aggregates from SQLite without shipping every fund row', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/research/dashboard');
    expect(res.status).toBe(200);

    const stats = res.body.data.market_stats;
    expect(stats.summary).toMatchObject({
      total_funds: 4,
      pass_4433: 2,
      pass_4433_rate: 50,
      risk_ready: 2,
      risk_ready_rate: 50,
    });
    // 1.6MB 的全量行列表曾经挂在这里（页面用不到、模型也塞不下）
    expect(stats.items).toBeUndefined();
    expect(stats.enrichment_summary).toMatchObject({ total: 4, enriched: 2, missing: 2 });

    // 分类型的 4433 通过数由 core 算好（不再靠前端重算覆盖）
    const byType = Object.fromEntries(stats.type_stats.map((row: { fund_type: string; pass_4433: number }) => [row.fund_type, row.pass_4433]));
    expect(byType).toEqual({ 混合型: 1, 债券型: 1 });

    expect(res.body.data.fund_dashboard.cards.length).toBeGreaterThan(0);
    expect(res.body.data.industry_performance.items.length).toBeGreaterThan(0);
  });

  it('keeps the full card/ETF detail for the page', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/research/dashboard?limit=2&etf_limit=5');
    const cards = res.body.data.fund_dashboard.cards;
    expect(cards[0].items.length).toBeLessThanOrEqual(2);
    expect(res.body.data.etf_tracking.items.length).toBeLessThanOrEqual(5);
  });
});

describe('compactDashboard', () => {
  it('drops per-fund lists and keeps the aggregate numbers', async () => {
    await seed();
    const { compactDashboard, getResearchDashboard } = await import('../../services/researchService.js');
    const full = await getResearchDashboard({ limit: 3, etfLimit: 20 });
    const compact = compactDashboard(full, 5);

    const compactCards = (compact.fund_dashboard as { cards: Record<string, unknown>[] }).cards;
    expect(compactCards.every((card) => !('items' in card))).toBe(true);
    expect(compactCards.every((card) => 'summary' in card)).toBe(true);
    const etf = compact.etf_tracking as { items: unknown[]; note: string };
    expect(etf.items.length).toBeLessThanOrEqual(5);
    expect(etf.note).toContain('截取');
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length);
  });
});
