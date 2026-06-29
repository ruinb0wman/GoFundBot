import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { fundRouter } from '../../routes/fund.routes.js';

vi.mock('../../services/fundService.js', () => ({
  getFundScreeningSnapshot: vi.fn().mockResolvedValue({
    data: { items: [{ code: '000001', name: 'Test Fund' }], total: 1 },
    provider: 'eastmoney', fallback: false, cached: false, stale: false,
    updatedAt: new Date(),
  }),
  searchFunds: vi.fn().mockResolvedValue({
    data: { items: [] }, provider: 'eastmoney',
    fallback: false, cached: false, stale: false, updatedAt: new Date(),
  }),
  getFundEstimates: vi.fn().mockResolvedValue({
    data: { items: [] }, provider: 'eastmoney',
    fallback: false, cached: false, stale: false, updatedAt: new Date(),
  }),
  getFundDetail: vi.fn().mockResolvedValue({
    data: { fund_code: '000001', fund_name: 'Test Fund' }, provider: 'eastmoney',
    fallback: false, cached: false, stale: false, updatedAt: new Date(),
  }),
  getFundEstimate: vi.fn().mockResolvedValue({
    data: { fund_code: '000001', estimate: 1.5 }, provider: 'eastmoney',
    fallback: false, cached: false, stale: false, updatedAt: new Date(),
  }),
  getFundBasic: vi.fn().mockResolvedValue({
    data: { fund_code: '000001' }, provider: 'eastmoney',
    fallback: false, cached: false, stale: false, updatedAt: new Date(),
  }),
  getFundNavHistory: vi.fn().mockResolvedValue({
    data: { items: [] }, provider: 'eastmoney',
    fallback: false, cached: false, stale: false, updatedAt: new Date(),
  }),
  getFundRankHistory: vi.fn().mockResolvedValue({
    data: { items: [] }, provider: 'eastmoney',
    fallback: false, cached: false, stale: false, updatedAt: new Date(),
  }),
  getFundDividends: vi.fn().mockResolvedValue({
    data: { items: [] }, provider: 'eastmoney',
    fallback: false, cached: false, stale: false, updatedAt: new Date(),
  }),
  getFundHoldings: vi.fn().mockResolvedValue({
    data: { items: [] }, provider: 'eastmoney',
    fallback: false, cached: false, stale: false, updatedAt: new Date(),
  }),
  getFundManagers: vi.fn().mockResolvedValue({
    data: { managers: [] }, provider: 'eastmoney',
    fallback: false, cached: false, stale: false, updatedAt: new Date(),
  }),
  getFundAssetAllocation: vi.fn().mockResolvedValue({
    data: { items: [] }, provider: 'eastmoney',
    fallback: false, cached: false, stale: false, updatedAt: new Date(),
  }),
}));

function createApp() {
  const app = express();
  app.use('/api/funds', fundRouter);
  return app;
}

describe('Fund Routes', () => {
  it('GET /api/funds/screening-snapshot returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/api/funds/screening-snapshot?types=gp&sort=1nzf&pageSize=100');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(1);
  });

  it('GET /api/funds/search returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/api/funds/search?q=%E5%8D%8E%E5%A4%8F');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/funds/:code/detail returns fund data', async () => {
    const app = createApp();
    const res = await request(app).get('/api/funds/000001/detail');
    expect(res.status).toBe(200);
    expect(res.body.data.fund_code).toBe('000001');
  });

  it('GET /api/funds/:code/estimate returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/api/funds/000001/estimate');
    expect(res.status).toBe(200);
  });

  it('GET /api/funds/:code/basic returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/api/funds/000001/basic');
    expect(res.status).toBe(200);
  });

  it('GET /api/funds/:code/nav-history with date params', async () => {
    const app = createApp();
    const res = await request(app).get('/api/funds/000001/nav-history?startDate=2024-01-01');
    expect(res.status).toBe(200);
  });

  it('GET /api/funds/:code/rank-history returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/api/funds/000001/rank-history');
    expect(res.status).toBe(200);
  });

  it('GET /api/funds/:code/dividends returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/api/funds/000001/dividends');
    expect(res.status).toBe(200);
  });

  it('GET /api/funds/:code/holdings returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/api/funds/000001/holdings');
    expect(res.status).toBe(200);
  });

  it('GET /api/funds/:code/managers returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/api/funds/000001/managers');
    expect(res.status).toBe(200);
  });

  it('GET /api/funds/:code/asset-allocation returns 200', async () => {
    const app = createApp();
    const res = await request(app).get('/api/funds/000001/asset-allocation');
    expect(res.status).toBe(200);
  });
});
