import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import express from 'express';
import { logsRouter } from '../../routes/logs.routes.js';

let logDir = '';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/logs', logsRouter);
  return app;
}

beforeAll(() => {
  logDir = mkdtempSync(join(tmpdir(), 'logs-test-'));
  process.env.LOG_DIR = logDir;
});

afterAll(() => {
  delete process.env.LOG_DIR;
  rmSync(logDir, { recursive: true, force: true });
});

function writeLogFile(source: string, date: string, lines: string[]) {
  writeFileSync(join(logDir, `${source}-${date}.jsonl`), lines.join('\n') + '\n', 'utf-8');
}

describe('Logs Routes', () => {
  it('GET /api/logs/read returns empty result when file missing', async () => {
    const res = await request(createApp()).get('/api/logs/read').query({ date: '2026-01-01' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.entries).toEqual([]);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.counts).toEqual({});
  });

  it('GET /api/logs/read parses entries, filters and paginates', async () => {
    writeLogFile('dataservice', '2026-01-01', [
      JSON.stringify({ time: 't1', level: 'info', message: 'request start', context: { requestId: 'a' } }),
      JSON.stringify({ time: 't2', level: 'warn', message: 'slow response' }),
      JSON.stringify({ time: 't3', level: 'error', message: 'provider timeout' }),
      JSON.stringify({ time: 't4', level: 'error', message: 'rate limited' }),
      'not-json-line',
    ]);

    const res = await request(createApp()).get('/api/logs/read').query({
      source: 'dataservice',
      date: '2026-01-01',
      level: 'error',
      limit: '2',
      offset: '0',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.entries).toHaveLength(2);
    expect(res.body.data.counts).toEqual({ error: 2 });
  });

  it('GET /api/logs/read supports keyword search', async () => {
    writeLogFile('dataservice', '2026-01-02', [
      JSON.stringify({ time: 't1', level: 'error', message: 'provider timeout' }),
      JSON.stringify({ time: 't2', level: 'error', message: 'ssl eof' }),
    ]);

    const res = await request(createApp()).get('/api/logs/read').query({
      source: 'dataservice',
      date: '2026-01-02',
      q: 'ssl',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.entries[0].message).toBe('ssl eof');
  });

  it('GET /api/logs/read rejects invalid source', async () => {
    const res = await request(createApp()).get('/api/logs/read').query({ source: 'backend' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/logs/ingest writes frontend entries and read returns them', async () => {
    const res = await request(createApp()).post('/api/logs/ingest').send({
      entries: [
        { level: 'info', message: 'app started', context: { v: 1 } },
        { level: 'error', message: 'uncaught error' },
        { level: 'debug', message: 'ignored level' },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.count).toBe(2);

    const today = new Date().toISOString().slice(0, 10);
    const read = await request(createApp()).get('/api/logs/read').query({
      source: 'frontend',
      date: today,
    });
    expect(read.status).toBe(200);
    expect(read.body.data.total).toBe(2);
    const levels = read.body.data.entries.map((e: { level: string }) => e.level).sort();
    expect(levels).toEqual(['error', 'info']);
  });

  it('POST /api/logs/ingest rejects malformed body', async () => {
    const res = await request(createApp()).post('/api/logs/ingest').send({ entries: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/logs/analyze returns stats and patterns', async () => {
    writeLogFile('dataservice', '2026-01-03', [
      JSON.stringify({ time: 't1', level: 'error', message: 'provider timeout' }),
      JSON.stringify({ time: 't2', level: 'error', message: 'provider timeout' }),
      JSON.stringify({ time: 't3', level: 'warn', message: 'slow response' }),
      JSON.stringify({ time: 't4', level: 'info', message: 'request start' }),
    ]);

    const res = await request(createApp()).post('/api/logs/analyze').send({
      source: 'dataservice',
      date: '2026-01-03',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(4);
    expect(res.body.data.error_count).toBe(2);
    expect(res.body.data.warn_count).toBe(1);
    expect(res.body.data.patterns.length).toBeGreaterThan(0);
  });

  it('POST /api/logs/analyze returns 404 when file missing', async () => {
    const res = await request(createApp()).post('/api/logs/analyze').send({
      source: 'frontend',
      date: '2026-01-01',
    });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
