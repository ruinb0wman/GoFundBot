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

describe('Portfolio Data Routes', () => {
  it('GET /api/user/portfolio/funds returns a list', async () => {
    const app = createApp();
    const res = await request(app).get('/api/user/portfolio/funds');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/user/portfolio/holdings returns a list', async () => {
    const app = createApp();
    const res = await request(app).get('/api/user/portfolio/holdings');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/user/portfolio/trades returns a list', async () => {
    const app = createApp();
    const res = await request(app).get('/api/user/portfolio/trades');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/user/portfolio/groups returns a list', async () => {
    const app = createApp();
    const res = await request(app).get('/api/user/portfolio/groups');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
