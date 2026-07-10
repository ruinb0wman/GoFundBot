import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess, sendFailure } from '../core/response.js';
import { getSettings, updateSettings, type AppSettings } from '../services/settingsService.js';

export const settingsRouter = Router();

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = getSettings();
    sendSuccess(res, {
      llm: {
        apiBase: settings.llm.apiBase,
        model: settings.llm.model,
        configured: !!settings.llm.apiKey,
      },
      proxy: {
        url: settings.proxy.url,
      },
      search: {
        bocha: !!settings.search.bochaKey,
        tavily: !!settings.search.tavilyKey,
      },
    });
  }),
);

settingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<AppSettings>;
    if (typeof body !== 'object' || body === null) {
      sendFailure(res, 400, { code: 'INVALID_ARGUMENT', message: 'body must be an object' });
      return;
    }
    updateSettings(body);
    const settings = getSettings();
    sendSuccess(res, {
      llm: {
        apiBase: settings.llm.apiBase,
        model: settings.llm.model,
        configured: !!settings.llm.apiKey,
      },
      proxy: {
        url: settings.proxy.url,
      },
      search: {
        bocha: !!settings.search.bochaKey,
        tavily: !!settings.search.tavilyKey,
      },
    });
  }),
);
