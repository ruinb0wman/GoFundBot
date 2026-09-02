import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess, sendFailure } from '../core/response.js';
import { getCacheStats } from '../core/cache.js';
import { getSettings, updateSettings } from '../services/settingsService.js';

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
    sendSuccess(res, {
      status: 'ok',
      service: 'gofund-data-service',
      cache: getCacheStats(),
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

systemRouter.get(
  '/proxy',
  asyncHandler(async (_req, res) => {
    const settings = getSettings();
    sendSuccess(res, { url: settings.proxy.url });
  }),
);

systemRouter.put(
  '/proxy',
  asyncHandler(async (req, res) => {
    const { url } = req.body;
    if (typeof url !== 'string') {
      sendFailure(res, 400, { code: 'INVALID_ARGUMENT', message: 'url must be a string' });
      return;
    }
    updateSettings({ proxy: { url } });
    const settings = getSettings();
    sendSuccess(res, { url: settings.proxy.url });
  }),
);
