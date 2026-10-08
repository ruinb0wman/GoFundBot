import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

async function createApp() {
  const { portfolioRouter } = await import('../../routes/portfolio.routes.js');
  const { errorHandler, notFoundHandler } = await import('../../core/errors.js');
  const app = express();
  app.use(express.json());
  app.use('/api/user/portfolio', portfolioRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function freshDb() {
  const { resetDbForTests, getDb } = await import('../../db/index.js');
  resetDbForTests();
  getDb();
}

describe('Portfolio Data Routes', () => {
  beforeEach(freshDb);

  it('round-trips funds, groups, group map and trades', async () => {
    const app = await createApp();

    const added = await request(app)
      .post('/api/user/portfolio/funds')
      .send({ fund_code: '110022', fund_name: '易方达消费', fund_type: '混合型' });
    expect(added.status).toBe(200);
    expect(added.body.data).toMatchObject({ fund_code: '110022', fund_name: '易方达消费' });

    const group = await request(app).post('/api/user/portfolio/groups').send({ name: '核心' });
    expect(group.status).toBe(200);

    await request(app)
      .put('/api/user/portfolio/fund-group-map')
      .send({ mappings: [{ fund_code: '110022', group_id: String(group.body.data.id) }] });
    const map = await request(app).get('/api/user/portfolio/fund-group-map');
    expect(map.body.data).toEqual({ '110022': group.body.data.id });

    // 交易 → 持仓由已结算交易推导
    await request(app).post('/api/user/portfolio/trades').send({
      fund_code: '110022',
      type: 'buy',
      trade_date: '2025-01-02',
      amount: 1000,
      share: 100,
      nav: 10,
      status: 'settled',
    });
    const holdings = await request(app).get('/api/user/portfolio/holdings');
    expect(holdings.status).toBe(200);
    expect(holdings.body.data['110022']).toMatchObject({ share: 100, cost: 10 });

    const trades = await request(app).get('/api/user/portfolio/trades').query({ fund_code: '110022' });
    expect(trades.body.data).toHaveLength(1);
    expect(trades.body.data[0]).toMatchObject({ type: 'buy', status: 'settled' });
  });

  it('deletes a group and clears its mappings', async () => {
    const app = await createApp();
    const group = await request(app).post('/api/user/portfolio/groups').send({ name: '卫星' });
    await request(app)
      .put('/api/user/portfolio/fund-group-map')
      .send({ mappings: [{ fund_code: '110022', group_id: String(group.body.data.id) }] });

    const removed = await request(app).delete(`/api/user/portfolio/groups/${group.body.data.id}`);
    expect(removed.body.data).toEqual([]);
    const map = await request(app).get('/api/user/portfolio/fund-group-map');
    expect(map.body.data).toEqual({});
  });

  it('settles pending trades by txn id', async () => {
    const app = await createApp();
    await request(app).post('/api/user/portfolio/trades').send({
      fund_code: '110022',
      type: 'buy',
      trade_date: '2025-01-02',
      amount: 1000,
      share: 100,
      nav: 10,
      status: 'pending',
      txn_id: 'txn-9',
    });
    expect((await request(app).get('/api/user/portfolio/holdings')).body.data).toEqual({});

    await request(app).post('/api/user/portfolio/trades/batch-settle').send({ txn_ids: ['txn-9'] });
    expect((await request(app).get('/api/user/portfolio/holdings')).body.data['110022']).toMatchObject({ share: 100 });
  });

  it('rejects an invalid body', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/user/portfolio/funds').send({ fund_code: '' });
    expect(res.status).toBe(400);
  });
});
