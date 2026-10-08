import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

vi.mock('../../services/fundService.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../services/fundService.js');
  return {
    ...actual,
    getFundBasic: vi.fn(async (code: string) => ({ data: { code, name: '测试基金', type: '混合型' } })),
  };
});

vi.mock('../../services/marketService.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../services/marketService.js');
  return {
    ...actual,
    getMarketIndices: vi.fn(async () => ({ data: { items: [{ code: 'sh000688', name: '科创50', changePercent: -4.1 }] } })),
    getMarketSectorsFromAkshare: vi.fn(async () => ({ items: [{ name: '电池', raw_change: 5.2 }] })),
    getAVolume7Days: vi.fn(async () => ({ success: true, data: [], update_time: 'x' })),
  };
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

async function freshDb() {
  const { resetDbForTests, getDb } = await import('../../db/index.js');
  resetDbForTests();
  getDb();
}

/** 走一遍确认令牌流程：第一次拿令牌，第二次带令牌重调。 */
async function callWithConfirm(app: express.Express, tool: string, args: Record<string, unknown>) {
  const first = await request(app).post('/api/agent/call').send({ tool, args });
  expect(first.body.data.confirm_required).toBe(true);
  const token = first.body.data.token as string;
  return request(app)
    .post('/api/agent/call')
    .send({ tool, args: { ...args, __confirm_token: token } });
}

describe('告警工具', () => {
  beforeEach(freshDb);

  it('creates a rule through the confirm-token flow and can delete it again', async () => {
    const app = await createApp();
    const { listAlerts } = await import('../../services/alertService.js');

    const created = await callWithConfirm(app, 'save_alert', {
      fund_code: '110022',
      alert_type: 'price_up',
      threshold: 4.2,
    });
    expect(created.status).toBe(200);
    expect(created.body.data.result.saved).toMatchObject({
      fund_code: '110022',
      alert_type: 'price_up',
      threshold: 4.2,
      enabled: 1,
      fund_name: '测试基金', // resolveFund 补全
    });
    expect(listAlerts()).toHaveLength(1);

    const id = created.body.data.result.saved.id as number;
    const updated = await callWithConfirm(app, 'save_alert', { id, threshold: 6, enabled: false });
    expect(updated.body.data.result.saved).toMatchObject({ threshold: 6, enabled: 0 });

    const removed = await callWithConfirm(app, 'delete_alert', { id });
    expect(removed.body.data.result.deleted).toMatchObject({ id, fund_code: '110022' });
    expect(listAlerts()).toHaveLength(0);
  });

  it('refuses to create a rule without fund_code / alert_type', async () => {
    const app = await createApp();
    const res = await callWithConfirm(app, 'save_alert', { threshold: 5 });
    expect(res.body.data.result.error).toContain('fund_code');
  });

  it('reads rules without a token and reports anomalies', async () => {
    const app = await createApp();
    const rules = await request(app).post('/api/agent/call').send({ tool: 'get_alerts', args: {} });
    expect(rules.status).toBe(200);
    expect(rules.body.data.result.rules).toEqual([]);
    expect(rules.body.data.result.anomaly_config).toMatchObject({ index_surge_threshold: 3 });

    const anomaly = await request(app).post('/api/agent/call').send({ tool: 'get_market_anomaly', args: {} });
    const types = anomaly.body.data.result.anomalies.map((item: { type: string }) => item.type);
    expect(types).toContain('index_plunge');
    expect(types).toContain('sector_surge');
  });

  it('updates anomaly thresholds and keeps the other fields', async () => {
    const app = await createApp();
    const { getAnomalyConfig } = await import('../../services/alertService.js');

    const res = await callWithConfirm(app, 'save_anomaly_config', { index_surge_threshold: 4.5 });
    expect(res.body.data.result.config.index_surge_threshold).toBe(4.5);
    expect(getAnomalyConfig()).toMatchObject({ index_surge_threshold: 4.5, volume_surge_ratio: 1.5 });
  });

  it('check_alerts is read-only (no token required)', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/agent/call').send({ tool: 'check_alerts', args: {} });
    expect(res.status).toBe(200);
    expect(res.body.data.result).toHaveProperty('checked_count', 0);
    expect(res.body.data.confirm_required).toBeUndefined();
  });
});
