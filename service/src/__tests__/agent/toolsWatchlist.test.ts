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

describe('自选分组工具', () => {
  beforeEach(freshDb);

  it('creates a group, assigns a fund, reorders and deletes the group', async () => {
    const app = await createApp();
    await callWithConfirm(app, 'add_to_watchlist', { fund_code: '110022' });
    await callWithConfirm(app, 'add_to_watchlist', { fund_code: '161725' });

    const created = await callWithConfirm(app, 'save_watchlist_group', { name: '核心' });
    const groupId = created.body.data.result.groups[0].id as number;
    expect(created.body.data.result.groups[0]).toMatchObject({ name: '核心' });

    const assigned = await callWithConfirm(app, 'assign_watchlist_group', {
      fund_codes: ['110022'],
      group_id: groupId,
    });
    expect(assigned.body.data.result.items.find((item: { fundCode: string }) => item.fundCode === '110022')).toMatchObject(
      { groupId },
    );
    expect(assigned.body.data.result.items.find((item: { fundCode: string }) => item.fundCode === '161725')).toMatchObject(
      { groupId: null },
    );

    const renamed = await callWithConfirm(app, 'save_watchlist_group', { id: groupId, name: '核心仓' });
    expect(renamed.body.data.result.groups[0]).toMatchObject({ id: groupId, name: '核心仓' });

    const reordered = await callWithConfirm(app, 'reorder_watchlist', { fund_codes: ['161725', '110022'] });
    expect(reordered.body.data.result.items.map((item: { fundCode: string }) => item.fundCode)).toEqual([
      '161725',
      '110022',
    ]);

    const deleted = await callWithConfirm(app, 'delete_watchlist_group', { id: groupId });
    expect(deleted.body.data.result.groups).toEqual([]);
    expect(deleted.body.data.result.items).toHaveLength(2); // 基金还在，只是回到未分组
  });

  it('reports a clear error for a missing group', async () => {
    const app = await createApp();
    const assign = await callWithConfirm(app, 'assign_watchlist_group', { fund_codes: ['110022'], group_id: 42 });
    expect(assign.body.data.result.error).toContain('不存在');
    const rename = await callWithConfirm(app, 'save_watchlist_group', { id: 42, name: 'x' });
    expect(rename.body.data.result.error).toContain('不存在');
    const remove = await callWithConfirm(app, 'delete_watchlist_group', { id: 42 });
    expect(remove.body.data.result.error).toContain('不存在');
  });
});
