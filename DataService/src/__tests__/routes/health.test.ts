import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { healthRouter } from '../../routes/health.routes.js';

function createApp() {
  const app = express();
  app.use('/api/health', healthRouter);
  return app;
}

describe('Health Routes', () => {
  it('GET /api/health returns 200 with status ok', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.service).toBe('gofund-data-service');
    expect(res.body.data.cache).toBeTypeOf('object');
    expect(res.body.data.cache.entries).toBeTypeOf('number');
  });
});
