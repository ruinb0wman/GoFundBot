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

/** 走一遍确认令牌流程：第一次拿令牌，第二次带令牌重调。 */
async function callWithConfirm(app: express.Express, tool: string, args: Record<string, unknown>) {
  const first = await request(app).post('/api/agent/call').send({ tool, args });
  expect(first.body.data.confirm_required).toBe(true);
  return request(app)
    .post('/api/agent/call')
    .send({ tool, args: { ...args, __confirm_token: first.body.data.token as string } });
}

describe('实时页组合工具', () => {
  beforeEach(freshDb);

  it('reads an empty portfolio without a token', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/agent/call').send({ tool: 'get_portfolio', args: {} });
    expect(res.status).toBe(200);
    expect(res.body.data.result).toEqual({ funds: [], groups: [], fund_group_map: {}, holdings: {} });
  });

  it('adds a fund, puts it in a group, and removes both', async () => {
    const app = await createApp();
    const group = await callWithConfirm(app, 'save_portfolio_group', { name: '核心' });
    const groupId = group.body.data.result.saved.id as number;
    expect(group.body.data.result.saved).toMatchObject({ name: '核心', rebalance_enabled: 0 });

    const added = await callWithConfirm(app, 'add_portfolio_fund', { fund_code: '110022', group_id: groupId });
    expect(added.body.data.result.saved).toMatchObject({ fund_code: '110022', fund_name: '测试基金' });
    expect(added.body.data.result.fund_group_map).toEqual({ '110022': groupId });

    const unassigned = await callWithConfirm(app, 'assign_funds_to_group', { fund_codes: ['110022'], group_id: null });
    expect(unassigned.body.data.result.fund_group_map).toEqual({});

    const removed = await callWithConfirm(app, 'remove_portfolio_fund', { fund_code: '110022' });
    expect(removed.body.data.result.funds).toEqual([]);
    const groups = await callWithConfirm(app, 'delete_portfolio_group', { id: groupId });
    expect(groups.body.data.result.groups).toEqual([]);
  });

  it('derives holdings from settled trades and only counts settled ones', async () => {
    const app = await createApp();
    const pending = await callWithConfirm(app, 'add_trade', {
      fund_code: '110022',
      type: 'buy',
      trade_date: '2025-06-02',
      amount: 1000,
      share: 0,
      nav: 10,
      status: 'pending',
      txn_id: 'txn-1',
    });
    expect(pending.body.data.result.holdings).toEqual({}); // 挂单不计入

    const settled = await callWithConfirm(app, 'settle_trades', { txn_ids: ['txn-1'] });
    expect(settled.body.data.result.holdings['110022']).toMatchObject({ share: 100, cost: 10 });

    const tradeId = settled.body.data.result.trades[0].id as number;
    const deleted = await callWithConfirm(app, 'delete_trade', { id: tradeId });
    expect(deleted.body.data.result.holdings).toEqual({});
  });

  it('keeps the weighted-average cost across two buys and drops the holding on a full sell', async () => {
    const app = await createApp();
    const buy = (amount: number, nav: number) =>
      callWithConfirm(app, 'add_trade', {
        fund_code: '110022',
        type: 'buy',
        trade_date: '2025-06-02',
        amount,
        share: 0,
        nav,
      });

    await buy(1000, 10); // 100 份 @10
    const second = await buy(1000, 20); // 50 份 @20 → 150 份，成本 (1000+1000)/150
    expect(second.body.data.result.holdings['110022'].share).toBeCloseTo(150);
    expect(second.body.data.result.holdings['110022'].cost).toBeCloseTo(2000 / 150);

    const sold = await callWithConfirm(app, 'add_trade', {
      fund_code: '110022',
      type: 'sell',
      trade_date: '2025-06-03',
      amount: 3000,
      share: 150,
      nav: 20,
    });
    expect(sold.body.data.result.holdings).toEqual({}); // 清零 → 整只消失
  });

  it('reports a clear error for a missing trade / group', async () => {
    const app = await createApp();
    const trade = await callWithConfirm(app, 'delete_trade', { id: 999 });
    expect(trade.body.data.result.error).toContain('不存在');
    const group = await callWithConfirm(app, 'delete_portfolio_group', { id: 999 });
    expect(group.body.data.result.error).toContain('不存在');
  });
});
