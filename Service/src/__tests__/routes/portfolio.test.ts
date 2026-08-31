import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { portfolioRouter } from '../../routes/userData.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/user/portfolio', portfolioRouter);
  return app;
}

describe('Portfolio Analyze Routes', () => {
  it('POST /api/user/portfolio/analyze returns a fallback result without LLM key', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/user/portfolio/analyze')
      .send({ funds: [{ code: '000001', share: 100, cost: 1.2, weight_pct: 100 }] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sentiment_score).toBe(50);
    expect(res.body.data.summary).toContain('1 只基金');
  });

  it('POST /api/user/portfolio/analyze passes strategyContext without error', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/user/portfolio/analyze')
      .send({
        funds: [{ code: '000001', weight_pct: 60 }, { code: '000002', weight_pct: 40 }],
        strategyContext: '## 用户投资策略\n### 1. 稳健定投',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.summary).toContain('2 只基金');
  });

  it('POST /api/user/portfolio/analyze rejects empty funds', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/user/portfolio/analyze')
      .send({ funds: [] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_ARGUMENT');
  });

  it('POST /api/user/portfolio/analyze rejects funds without a code', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/user/portfolio/analyze')
      .send({ funds: [{ share: 100 }] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
