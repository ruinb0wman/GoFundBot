import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess, sendFailure } from '../core/response.js';
import { getCacheStats } from '../core/cache.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setProxyUrl } from '../providers/eastmoney/eastmoneyRequest.js';

export const systemRouter = Router();

interface ProxyConfig {
  url: string;
}

let currentProxyConfig: ProxyConfig = {
  url: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '',
};

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

systemRouter.get(
  '/proxy',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { ...currentProxyConfig });
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
    currentProxyConfig = { url };
    setProxyUrl(url || null);
    sendSuccess(res, { ...currentProxyConfig });
  }),
);
