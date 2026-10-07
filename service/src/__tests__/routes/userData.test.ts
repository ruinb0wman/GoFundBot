import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

async function createApp() {
  const db = await import('../../db/index.js');
  db.resetDbForTests();

  const { watchlistRouter } = await import('../../routes/watchlist.routes.js');
  const { positionsRouter } = await import('../../routes/positions.routes.js');
  const { backtestScriptsRouter, strategiesRouter } = await import('../../routes/strategies.routes.js');
  const { userImportRouter } = await import('../../routes/userImport.routes.js');
  const { errorHandler, notFoundHandler } = await import('../../core/errors.js');

  const app = express();
  app.use(express.json());
  app.use('/api/watchlist', watchlistRouter);
  app.use('/api/positions', positionsRouter);
  app.use('/api/strategies', strategiesRouter);
  app.use('/api/backtest-scripts', backtestScriptsRouter);
  app.use('/api/user', userImportRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('positions', () => {
  beforeEach(async () => {
    await createApp();
  });

  it('creates, lists, updates and deletes', async () => {
    const app = await createApp();

    const created = await request(app)
      .post('/api/positions')
      .send({ fundCode: '110022', fundName: '易方达消费', shares: 100, cost: 2.5 });
    expect(created.status).toBe(200);
    expect(created.body.data.id).toBeGreaterThan(0);
    expect(created.body.data.fundCode).toBe('110022');

    const id = created.body.data.id;
    const listed = await request(app).get('/api/positions');
    expect(listed.body.data.items).toHaveLength(1);

    await request(app).put(`/api/positions/${id}`).send({ shares: 200 });
    const after = await request(app).get('/api/positions');
    expect(after.body.data.items[0].shares).toBe(200);

    await request(app).delete(`/api/positions/${id}`);
    expect((await request(app).get('/api/positions')).body.data.items).toHaveLength(0);
  });

  it('replaces the whole table', async () => {
    const app = await createApp();
    await request(app).post('/api/positions').send({ fundCode: 'A', shares: 1, cost: 1 });

    const res = await request(app)
      .put('/api/positions')
      .send({ items: [{ fundCode: 'B', shares: 2, cost: 3 }, { fundCode: 'C', shares: 4, cost: 5 }] });

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((i: { fundCode: string }) => i.fundCode)).toEqual(['B', 'C']);
  });

  it('rejects a missing fundCode', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/positions').send({ shares: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
  });
});

describe('strategies', () => {
  it('creates and lists active-first, then updates and deletes', async () => {
    const app = await createApp();

    await request(app).post('/api/strategies').send({ title: 'A', content: 'a', active: 1 });
    await request(app).post('/api/strategies').send({ title: 'B', content: 'b', active: 0 });

    const listed = await request(app).get('/api/strategies');
    expect(listed.body.data.items.map((s: { title: string }) => s.title)).toEqual(['A', 'B']);

    const id = listed.body.data.items[0].id;
    const updated = await request(app).put(`/api/strategies/${id}`).send({ title: 'A2', tags: ['x'] });
    expect(updated.body.data.title).toBe('A2');
    expect(updated.body.data.tags).toEqual(['x']);

    await request(app).delete(`/api/strategies/${id}`);
    expect((await request(app).get('/api/strategies')).body.data.items).toHaveLength(1);
  });

  it('marks ai-draft sources', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/strategies').send({ title: 'x', content: 'y', source: 'ai-draft' });
    expect(res.body.data.source).toBe('ai-draft');
  });

  it('404s an unknown id on update', async () => {
    const app = await createApp();
    const res = await request(app).put('/api/strategies/999').send({ title: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('backtest scripts', () => {
  it('keeps lastRunAt/lastSummary on create (used by the Dexie import)', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/backtest-scripts')
      .send({ name: 'x', code: 'c', lastRunAt: 1700000000000, lastSummary: { total_return: 0.2 } });
    expect(res.body.data.lastRunAt).toBe(1700000000000);
    expect(res.body.data.lastSummary).toEqual({ total_return: 0.2 });
  });

  it('defaults lastRunAt/lastSummary to null on a plain create', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/backtest-scripts').send({ name: 'y', code: 'c' });
    expect(res.body.data.lastRunAt).toBeNull();
    expect(res.body.data.lastSummary).toBeNull();
  });

  it('creates, reads, updates, records a run and deletes', async () => {
    const app = await createApp();

    const created = await request(app)
      .post('/api/backtest-scripts')
      .send({ name: 'perm-portfolio', code: 'function prepare(){}' });
    const id = created.body.data.id;

    expect((await request(app).get(`/api/backtest-scripts/${id}`)).body.data.name).toBe('perm-portfolio');

    await request(app).put(`/api/backtest-scripts/${id}`).send({ name: 'renamed' });
    expect((await request(app).get('/api/backtest-scripts')).body.data.items[0].name).toBe('renamed');

    const ran = await request(app).post(`/api/backtest-scripts/${id}/run`).send({ total_return: 0.1 });
    expect(ran.body.data.items[0].lastSummary).toEqual({ total_return: 0.1 });
    expect(ran.body.data.items[0].lastRunAt).toBeGreaterThan(0);

    await request(app).delete(`/api/backtest-scripts/${id}`);
    expect((await request(app).get('/api/backtest-scripts')).body.data.items).toHaveLength(0);
  });
});

describe('watchlist', () => {
  it('upserts items, reorders and batch-deletes', async () => {
    const app = await createApp();

    await request(app).put('/api/watchlist/A').send({ fundName: '甲', sortOrder: 1 });
    await request(app).put('/api/watchlist/B').send({ fundName: '乙', sortOrder: 2 });

    const listed = await request(app).get('/api/watchlist');
    expect(listed.body.data.items.map((i: { fundCode: string }) => i.fundCode)).toEqual(['A', 'B']);

    // upsert again must not duplicate
    await request(app).put('/api/watchlist/A').send({ fundName: '甲改', sortOrder: 9 });
    const afterUpsert = await request(app).get('/api/watchlist');
    expect(afterUpsert.body.data.items).toHaveLength(2);

    await request(app).put('/api/watchlist/reorder').send({ codes: ['B', 'A'] });
    const reordered = await request(app).get('/api/watchlist');
    expect(reordered.body.data.items.map((i: { fundCode: string }) => i.fundCode)).toEqual(['B', 'A']);

    await request(app).post('/api/watchlist/batch-delete').send({ codes: ['B'] });
    expect((await request(app).get('/api/watchlist')).body.data.items.map((i: { fundCode: string }) => i.fundCode)).toEqual(['A']);
  });

  it('manages groups and unassigns funds when deleting one', async () => {
    const app = await createApp();
    await request(app).put('/api/watchlist/A').send({ fundName: '甲' });

    const group = await request(app).post('/api/watchlist/groups').send({ name: '核心' });
    const groupId = group.body.data.id;

    await request(app).put(`/api/watchlist/A/group`).send({ groupId });
    expect((await request(app).get('/api/watchlist')).body.data.items[0].groupId).toBe(groupId);

    await request(app).put(`/api/watchlist/groups/${groupId}`).send({ name: '核心仓' });
    expect((await request(app).get('/api/watchlist/groups')).body.data[0].name).toBe('核心仓');

    const removed = await request(app).delete(`/api/watchlist/groups/${groupId}`);
    expect(removed.body.data.groups).toHaveLength(0);
    expect(removed.body.data.items[0].groupId).toBeNull();
  });

  it('rejects an empty code', async () => {
    const app = await createApp();
    const res = await request(app).put('/api/watchlist/%20').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/user/import', () => {
  it('imports a Dexie dump once and is idempotent', async () => {
    const app = await createApp();
    const dump = {
      positions: [{ fundCode: '110022', shares: 10, cost: 3 }],
      strategies: [{ title: 'S', content: 'c', tags: ['t'], active: 1 }],
      strategyScripts: [{ name: 'P', code: 'code' }],
      watchlist: [{ fundCode: 'A', fundName: '甲', groupId: 1, sortOrder: 1, addedAt: 1 }],
      watchlistGroups: [{ id: 1, name: '核心', sortOrder: 1 }],
    };

    const first = await request(app).post('/api/user/import').send(dump);
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({
      positions: 1,
      strategies: 1,
      strategyScripts: 1,
      watchlist: 1,
      watchlistGroups: 1,
    });

    // 第二次：表已非空 → 不再写入
    const second = await request(app).post('/api/user/import').send(dump);
    expect(second.body.data.positions).toBe(0);

    expect((await request(app).get('/api/positions')).body.data.items).toHaveLength(1);
    expect((await request(app).get('/api/strategies')).body.data.items).toHaveLength(1);
    expect((await request(app).get('/api/backtest-scripts')).body.data.items).toHaveLength(1);

    // 分组 id 被重映射，自选仍指向正确的组
    const watchlist = await request(app).get('/api/watchlist');
    const groupId = watchlist.body.data.groups[0].id;
    expect(watchlist.body.data.items[0].groupId).toBe(groupId);
  });
});
