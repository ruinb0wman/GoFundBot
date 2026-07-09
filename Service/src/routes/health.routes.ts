import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { cache } from '../core/cache.js';

export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {
      status: 'ok',
      service: 'gofund-data-service',
      cache: {
        entries: cache.size,
        maxEntries: Number(process.env.CACHE_MAX_ENTRIES ?? 2000),
      },
    });
  })
);
