import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

const mocks = vi.hoisted(() => ({ searchWeb: vi.fn() }));
vi.mock('../../ai/search.js', () => ({ searchWeb: mocks.searchWeb }));

async function createApp() {
  const db = await import('../../db/index.js');
  db.resetDbForTests();

  const { searchRouter } = await import('../../routes/search.routes.js');
  const { errorHandler, notFoundHandler } = await import('../../core/errors.js');
  const app = express();
  app.use(express.json());
  app.use('/api/search', searchRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('POST /api/search', () => {
  beforeEach(() => mocks.searchWeb.mockReset());

  it('returns the search chain result', async () => {
    mocks.searchWeb.mockResolvedValue({
      success: true,
      results: [{ title: 't', snippet: 's', url: 'https://x.test', source: 'Exa', date: null }],
      provider: 'Exa',
      search_time: 0.1,
    });
    const app = await createApp();

    const res = await request(app).post('/api/search').send({ query: '半导体', max_results: 3 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.provider).toBe('Exa');
    expect(mocks.searchWeb).toHaveBeenCalledWith('半导体', 3);
  });

  it('trims the query and defaults max_results to 5', async () => {
    mocks.searchWeb.mockResolvedValue({ success: true, results: [], provider: 'Exa', search_time: 0 });
    const app = await createApp();

    await request(app).post('/api/search').send({ query: '  上证指数  ' });

    expect(mocks.searchWeb).toHaveBeenCalledWith('上证指数', 5);
  });

  it('requires a query', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/search').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
    expect(mocks.searchWeb).not.toHaveBeenCalled();
  });
});
