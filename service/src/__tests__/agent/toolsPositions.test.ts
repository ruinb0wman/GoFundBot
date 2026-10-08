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

async function callWithConfirm(app: express.Express, tool: string, args: Record<string, unknown>) {
  const first = await request(app).post('/api/agent/call').send({ tool, args });
  expect(first.body.data.confirm_required).toBe(true);
  return request(app)
    .post('/api/agent/call')
    .send({ tool, args: { ...args, __confirm_token: first.body.data.token as string } });
}

describe('持仓工具', () => {
  beforeEach(freshDb);

  it('adds / updates / deletes a position through the confirm-token flow', async () => {
    const app = await createApp();

    const empty = await request(app).post('/api/agent/call').send({ tool: 'get_positions', args: {} });
    expect(empty.body.data.result.positions).toEqual([]);

    const added = await callWithConfirm(app, 'add_position', {
      fund_code: '110022',
      shares: 100,
      cost: 1.5,
      purchase_date: '2025-06-02',
    });
    expect(added.body.data.result.saved).toMatchObject({
      fundCode: '110022',
      fundName: '测试基金',
      shares: 100,
      cost: 1.5,
      purchaseDate: '2025-06-02',
    });
    const id = added.body.data.result.saved.id as number;

    const updated = await callWithConfirm(app, 'update_position', { id, shares: 120 });
    expect(updated.body.data.result.positions[0]).toMatchObject({ id, shares: 120, cost: 1.5 });

    const removed = await callWithConfirm(app, 'delete_position', { id });
    expect(removed.body.data.result.deleted).toMatchObject({ id, fund_code: '110022' });
    expect(removed.body.data.result.positions).toEqual([]);
  });

  it('refuses an empty update and a missing id', async () => {
    const app = await createApp();
    const noFields = await callWithConfirm(app, 'update_position', { id: 1 });
    expect(noFields.body.data.result.error).toContain('字段');

    const added = await callWithConfirm(app, 'add_position', { fund_code: '110022', shares: 10, cost: 1 });
    expect(added.body.data.result.saved.id).toBeGreaterThan(0);

    const missing = await callWithConfirm(app, 'update_position', { id: 999, shares: 5 });
    expect(missing.body.data.result.error).toContain('不存在');
    const missingDelete = await callWithConfirm(app, 'delete_position', { id: 999 });
    expect(missingDelete.body.data.result.error).toContain('不存在');
  });
});
