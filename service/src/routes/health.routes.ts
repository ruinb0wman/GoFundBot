import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { cache } from '../core/cache.js';
import { navCacheStats } from '../services/navCacheService.js';

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
      /** SQLite 里的净值缓存（P3.4）：只报计数，别让 health 被 1.5 万条净值拖慢。 */
      nav_cache: navCacheStats(),
    });
  })
);
