import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

  it('rejects a relative strategy folder', async () => {
    const app = await createApp();
    const res = await request(app).put('/api/settings').send({ strategy: { dir: 'notes/strategies' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
  });

  it('creates and persists an absolute strategy folder', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'gofund-settings-')), 'strategies');
    const app = await createApp();

    const put = await request(app).put('/api/settings').send({ strategy: { dir } });
    expect(put.status).toBe(200);
    expect(put.body.data.strategy.dir).toBe(dir);
    expect(existsSync(dir)).toBe(true);
    // proxy 不被顺手清掉
    expect(put.body.data.proxy.url).toBe('');

    expect((await request(app).get('/api/settings')).body.data.strategy.dir).toBe(dir);
  });
});
