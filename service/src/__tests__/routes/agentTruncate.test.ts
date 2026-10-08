import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { z } from 'zod';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

/** 用一个「返回超长结果」的假工具，专门验证 30k 字符截断分支。 */
vi.mock('../../agent/tools.js', () => ({
  agentToolManifest: () => ({ tools: [], count: 0, destructive: [] }),
  findAgentTool: (name: string) =>
    name === 'huge_result'
      ? {
          name: 'huge_result',
          label: '超长结果',
          description: '测试用工具：返回超过 30k 字符的结果',
          promptSnippet: 'huge_result()',
          readOnly: true,
          params: z.object({}),
          handler: () => ({ blob: 'x'.repeat(40_000) }),
        }
      : undefined,
}));

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

describe('POST /api/agent/call 结果截断', () => {
  it('turns a >30k result into a preview instead of blowing up the context', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/agent/call').send({ tool: 'huge_result', args: {} });

    expect(res.status).toBe(200);
    const result = res.body.data.result as { truncated: boolean; note: string; preview: string };
    expect(result.truncated).toBe(true);
    expect(result.note).toContain('30000');
    expect(result.preview.length).toBeLessThanOrEqual(30_000);
  });

  it('rejects an unknown tool', async () => {
    const app = await createApp();
    const res = await request(app).post('/api/agent/call').send({ tool: 'unknown_tool', args: {} });
    expect(res.status).toBe(400);
  });
});
