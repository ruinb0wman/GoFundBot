import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

const marketMocks = vi.hoisted(() => ({
  getNorthFlow: vi.fn(),
  runStrategyCodeSampled: vi.fn(),
}));
vi.mock('../../sandbox/runStrategyCode.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../sandbox/runStrategyCode.js');
  return { ...actual, runStrategyCodeSampled: marketMocks.runStrategyCodeSampled };
});
vi.mock('../../services/marketService.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../services/marketService.js');
  return { ...actual, ...marketMocks };
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
  getDb().exec('DELETE FROM strategies');
}

describe('GET /api/agent/tools', () => {
  it('lists every tool with a JSON Schema and flags the write tool', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/agent/tools');

    expect(res.status).toBe(200);
    const { tools, count, destructive } = res.body.data;
    expect(count).toBe(tools.length);
    expect(count).toBeGreaterThanOrEqual(20);

    const names = tools.map((tool: { name: string }) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('get_north_flow');
    expect(names).toContain('run_backtest');
    expect(names).toContain('screen_funds');
    expect(names).toContain('save_strategy');

    for (const tool of tools) {
      // JSON Schema 顶层必须是 object（pi / OpenAI tools 都这么要求）
      expect(tool.parameters).toMatchObject({ type: 'object' });
      expect(tool.parameters.$schema).toBeUndefined();
      expect(tool.description.length).toBeGreaterThan(10);
      expect(typeof tool.readOnly).toBe('boolean');
    }

    // 写/执行类都需要确认令牌（用 Set 比，不依赖顺序 —— 免得每次加工具都要手排一次）
    expect(new Set(destructive)).toEqual(
      new Set([
        // 自选
        'add_to_watchlist',
        'remove_from_watchlist',
        'save_watchlist_group',
        'delete_watchlist_group',
        'assign_watchlist_group',
        'reorder_watchlist',
        // 告警
        'save_alert',
        'delete_alert',
        'save_anomaly_config',
        // 实时组合与交易
        'add_portfolio_fund',
        'remove_portfolio_fund',
        'save_portfolio_group',
        'delete_portfolio_group',
        'assign_funds_to_group',
        'add_trade',
        'settle_trades',
        'delete_trade',
        // 持仓
        'add_position',
        'update_position',
        'delete_position',
        // 策略 / 方案 / 代码回测
        'save_strategy',
        'delete_strategy',
        'save_strategy_script',
        'delete_strategy_script',
        'run_strategy_code',
      ]),
    );
    const save = tools.find((tool: { name: string }) => tool.name === 'save_strategy');
    expect(save.readOnly).toBe(false);
    expect(save.parameters.required).toContain('title');
  });
});

describe('POST /api/agent/call', () => {
  beforeEach(async () => {
    marketMocks.getNorthFlow.mockReset();
    marketMocks.runStrategyCodeSampled.mockReset();
    await freshDb();
  });

  it('rejects an unknown tool with 400 and lists the known ones', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/agent/call').send({ tool: 'nope', args: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
    expect(res.body.error.detail.known_tools).toContain('get_north_flow');
  });

  it('rejects args that do not match the schema', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/agent/call')
      .send({ tool: 'get_fund_estimate', args: { code: 'abc' } });
    expect(res.status).toBe(400);
    expect(res.body.error.detail.issues).toBeDefined();
  });

  it('unwraps ServiceResult so the shape matches the HTTP route', async () => {
    marketMocks.getNorthFlow.mockResolvedValue({
      data: { date: '2026-09-30', totalNetInflow: null, shDealAmount: 101258, totalDealAmount: 207942 },
      provider: 'eastmoney',
      fallback: false,
      cached: false,
      stale: false,
      updatedAt: new Date(),
    });
    const app = await createApp();
    const res = await request(app).post('/api/agent/call').send({ tool: 'get_north_flow', args: {} });

    expect(res.status).toBe(200);
    const result = res.body.data.result;
    expect(result.data_status).toBe('unavailable');
    expect(result.total_net_inflow).toBeNull();
    expect(result.total_deal_amount_yi).toBe(2079.42);
    expect(result.note).toContain('2024-08-19');
  });

  it('turns a data failure into an inline error (200), not an HTTP error', async () => {
    marketMocks.getNorthFlow.mockRejectedValue(new Error('provider down'));
    const app = await createApp();
    const res = await request(app).post('/api/agent/call').send({ tool: 'get_north_flow', args: {} });
    expect(res.status).toBe(200);
    expect(res.body.data.error).toContain('provider down');
  });

  it('runs read-only user-data tools against the real store', async () => {
    const { addStrategy } = await import('../../services/userDataService.js');
    addStrategy({ title: '核心卫星', content: '70/30', source: 'manual' });

    const app = await createApp();
    const res = await request(app).post('/api/agent/call').send({ tool: 'list_strategies', args: {} });
    const strategies = res.body.data.result.strategies;
    expect(strategies).toHaveLength(1);
    expect(strategies[0].title).toBe('核心卫星');
  });

  it('gates save_strategy behind a confirm token and writes only after it', async () => {
    const { listStrategies } = await import('../../services/userDataService.js');
    const app = await createApp();
    const payload = { title: '新策略', content: '每月定投 1000', tags: ['定投'] };

    const first = await request(app).post('/api/agent/call').send({ tool: 'save_strategy', args: payload });
    expect(first.status).toBe(200);
    expect(first.body.data.confirm_required).toBe(true);
    expect(first.body.data.token).toBeTruthy();
    expect(listStrategies()).toHaveLength(0);

    const token = first.body.data.token;
    const second = await request(app)
      .post('/api/agent/call')
      .send({ tool: 'save_strategy', args: { ...payload, __confirm_token: token } });
    expect(second.status).toBe(200);
    const saved = second.body.data.result.saved;
    expect(saved.title).toBe('新策略');
    expect(saved.active).toBe(1);
    expect(saved.source).toBe('ai-draft');
    expect(listStrategies()).toHaveLength(1);

    // 令牌一次性
    const third = await request(app)
      .post('/api/agent/call')
      .send({ tool: 'save_strategy', args: { ...payload, __confirm_token: token } });
    expect(third.status).toBe(400);
    expect(third.body.error.detail.confirm_invalid).toBe(true);

    // 参数被改过 → 指纹不匹配
    const forged = await request(app).post('/api/agent/call').send({ tool: 'save_strategy', args: payload });
    const forgedToken = forged.body.data.token;
    const tampered = await request(app)
      .post('/api/agent/call')
      .send({
        tool: 'save_strategy',
        args: { ...payload, content: '偷偷改点别的', __confirm_token: forgedToken },
      });
    expect(tampered.status).toBe(400);
    expect(tampered.body.error.message).toContain('参数不匹配');
    expect(listStrategies()).toHaveLength(1);
  });

  it('runs a saved script by name and records the run', async () => {
    const { createStrategyScript, listStrategyScripts } = await import('../../services/userDataService.js');
    createStrategyScript({ name: 'screen-top5', code: 'function prepare() { return { assets: ["110022"] } }' });
    marketMocks.runStrategyCodeSampled.mockResolvedValue({ summary: { return_rate: 3.76 }, spec: 'screen-top5' });

    const app = await createApp();
    const first = await request(app)
      .post('/api/agent/call')
      .send({ tool: 'run_strategy_code', args: { script_name: 'screen-top5' } });
    expect(first.body.data.confirm_required).toBe(true);

    const run = await request(app)
      .post('/api/agent/call')
      .send({ tool: 'run_strategy_code', args: { script_name: 'screen-top5', __confirm_token: first.body.data.token } });

    expect(run.body.data.result).toMatchObject({ script: 'screen-top5', spec: 'screen-top5' });
    const script = listStrategyScripts()[0];
    expect(script.lastRunAt).toBeGreaterThan(0);
    expect((script.lastSummary as { return_rate: number }).return_rate).toBe(3.76);
  });

  it('reports an unknown script name with the available ones', async () => {
    const app = await createApp();
    const first = await request(app)
      .post('/api/agent/call')
      .send({ tool: 'run_strategy_code', args: { script_name: '不存在' } });
    const run = await request(app)
      .post('/api/agent/call')
      .send({ tool: 'run_strategy_code', args: { script_name: '不存在', __confirm_token: first.body.data.token } });
    expect(run.body.data.result.error).toContain('没有名为');
    expect(marketMocks.runStrategyCodeSampled).not.toHaveBeenCalled();
  });

  it('saves a script only after the confirm token', async () => {
    const app = await createApp();
    const payload = { name: '新方案', code: 'function prepare() { return { assets: ["110022"] } }' };

    const first = await request(app).post('/api/agent/call').send({ tool: 'save_strategy_script', args: payload });
    expect(first.body.data.confirm_required).toBe(true);

    const saved = await request(app)
      .post('/api/agent/call')
      .send({ tool: 'save_strategy_script', args: { ...payload, __confirm_token: first.body.data.token } });
    expect(saved.body.data.result.saved).toMatchObject({ name: '新方案', source: 'ai' });

    // 重名要报错，不静默覆盖
    const again = await request(app).post('/api/agent/call').send({ tool: 'save_strategy_script', args: payload });
    const dup = await request(app)
      .post('/api/agent/call')
      .send({ tool: 'save_strategy_script', args: { ...payload, __confirm_token: again.body.data.token } });
    expect(dup.body.data.result.error).toContain('已存在');
  });

  it('lists saved scripts', async () => {
    const { createStrategyScript } = await import('../../services/userDataService.js');
    createStrategyScript({ name: 'A', code: 'function prepare() {}' });
    const app = await createApp();
    const res = await request(app).post('/api/agent/call').send({ tool: 'list_strategy_scripts', args: {} });
    expect(res.body.data.result.scripts.map((s: { name: string }) => s.name)).toEqual(['A']);
  });

  it('updates an existing strategy by id (active=false → 0)', async () => {
    const { addStrategy, listStrategies } = await import('../../services/userDataService.js');
    const created = addStrategy({ title: '旧标题', content: '旧内容', source: 'manual' });

    const app = await createApp();
    const first = await request(app)
      .post('/api/agent/call')
      .send({ tool: 'save_strategy', args: { id: created.id, title: '新标题', content: '新内容', active: false } });
    const saved = await request(app)
      .post('/api/agent/call')
      .send({
        tool: 'save_strategy',
        args: { id: created.id, title: '新标题', content: '新内容', active: false, __confirm_token: first.body.data.token },
      });

    expect(saved.body.data.result.saved.id).toBe(created.id);
    const stored = listStrategies().find((row) => row.id === created.id);
    expect(stored?.title).toBe('新标题');
    expect(stored?.active).toBe(0);
  });
});
