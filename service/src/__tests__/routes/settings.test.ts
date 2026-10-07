import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

async function createApp() {
  const db = await import('../../db/index.js');
  const settings = await import('../../services/settingsService.js');
  db.resetDbForTests();
  settings.resetSettingsCacheForTests();

  const { settingsRouter } = await import('../../routes/settings.routes.js');
  const { errorHandler, notFoundHandler } = await import('../../core/errors.js');
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('/api/settings (proxy only, SQLite-backed)', () => {
  beforeEach(() => {
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
  });

  it('falls back to the env proxy when nothing is stored', async () => {
    process.env.HTTPS_PROXY = 'http://env-proxy:1080';
    const app = await createApp();
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.data.proxy.url).toBe('http://env-proxy:1080');
  });

  it('persists a proxy update', async () => {
    const app = await createApp();
    const put = await request(app).put('/api/settings').send({ proxy: { url: 'http://127.0.0.1:7890' } });
    expect(put.status).toBe(200);

    const res = await request(app).get('/api/settings');
    expect(res.body.data.proxy.url).toBe('http://127.0.0.1:7890');
  });

  it('keeps the current url when proxy.url is omitted', async () => {
    const app = await createApp();
    await request(app).put('/api/settings').send({ proxy: { url: 'http://127.0.0.1:7890' } });
    const res = await request(app).put('/api/settings').send({ proxy: {} });
    expect(res.body.data.proxy.url).toBe('http://127.0.0.1:7890');
  });

  it('rejects a non-object proxy with 400', async () => {
    const app = await createApp();
    const res = await request(app).put('/api/settings').send({ proxy: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
  });

  it('exposes no LLM/search key surface', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/settings');
    expect(res.body.data).not.toHaveProperty('llm');
    expect(res.body.data).not.toHaveProperty('search');
  });
});
