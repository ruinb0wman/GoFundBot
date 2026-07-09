import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { getCacheStats } from '../core/cache.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const systemRouter = Router();

systemRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {
      service: 'gofund-data-service',
      version: '2.0.0',
      status: 'ok',
    });
  }),
);

systemRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const dbPath = join(import.meta.dirname, '../../../Scripts/Data/funds.db');
    sendSuccess(res, {
      status: 'ok',
      service: 'gofund-data-service',
      cache: getCacheStats(),
      sqlite: existsSync(dbPath) ? 'available' : 'unavailable',
    });
  }),
);

systemRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version,
    });
  }),
);
