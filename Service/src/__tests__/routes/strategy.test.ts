import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { strategyRouter } from '../../routes/strategy.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/strategy', strategyRouter);
  return app;
}

describe('Strategy Routes', () => {
  it('POST /api/strategy/draft returns a template draft without LLM key', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/strategy/draft')
      .send({ topic: '每月3000元定投' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBeTruthy();
    expect(res.body.data.content).toContain('3000元定投');
    expect(Array.isArray(res.body.data.tags)).toBe(true);
  });

  it('POST /api/strategy/draft rejects an empty topic', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/strategy/draft')
      .send({ topic: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
  });

  it('POST /api/strategy/draft accepts optional strategyContext', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/strategy/draft')
      .send({ topic: '继续定投', strategyContext: '## 用户投资策略\n### 1. 现有策略' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBeTruthy();
  });
});
