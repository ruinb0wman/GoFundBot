import { Router } from 'express';
import { AppError, asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { getSettings, updateSettings } from '../services/settingsService.js';

/**
 * 设置接口（仅 proxy 子域）。
 *
 * service 不做 LLM 调用，也不持有任何 API 密钥，所以没有打码/子域路由；
 * 设置落 SQLite（见 `db/`）。
 */
export const settingsRouter = Router();

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = getSettings();
    sendSuccess(res, { proxy: { url: settings.proxy.url } });
  })
);

settingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body as { proxy?: { url?: unknown } } | undefined;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AppError('INVALID_ARGUMENT', 'body must be an object', 400);
    }
    if (body.proxy !== undefined && (typeof body.proxy !== 'object' || body.proxy === null)) {
      throw new AppError('INVALID_ARGUMENT', 'proxy must be an object', 400);
    }
    const url = body.proxy?.url === undefined ? getSettings().proxy.url : String(body.proxy.url);
    updateSettings({ proxy: { url } });
    sendSuccess(res, { proxy: { url: getSettings().proxy.url } });
  })
);
