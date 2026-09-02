import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess, sendFailure } from '../core/response.js';
import { getSettings, updateSettings } from '../services/settingsService.js';

/**
 * 设置接口已最小化：仅保留 proxy 子域（LLM/Search key 迁移至前端本地存储）。
 */
export const settingsRouter = Router();

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = getSettings();
    sendSuccess(res, {
      proxy: {
        url: settings.proxy.url,
      },
    });
  }),
);

settingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<{ proxy: { url?: string } }>;
    if (typeof body !== 'object' || body === null) {
      sendFailure(res, 400, { code: 'INVALID_ARGUMENT', message: 'body must be an object' });
      return;
    }
    updateSettings({ proxy: { url: body.proxy?.url ?? getSettings().proxy.url } });
    const settings = getSettings();
    sendSuccess(res, {
      proxy: {
        url: settings.proxy.url,
      },
    });
  }),
);