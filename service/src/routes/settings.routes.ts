import { isAbsolute } from 'node:path';
import { Router } from 'express';
import { AppError, asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { getSettings, updateSettings, type StrategySettings } from '../services/settingsService.js';
import { configureStrategyDir } from '../services/strategyStore.js';

/**
 * 设置接口（proxy + 策略文件夹）。
 *
 * service 不做 LLM 调用，也不持有任何 API 密钥，所以没有打码/子域路由；
 * 设置落 SQLite（见 `db/`），策略记忆本身落在设置里那个 markdown 文件夹。
 */
export const settingsRouter = Router();

function payloadOf(get: () => ReturnType<typeof getSettings>) {
  const settings = get();
  return { proxy: { url: settings.proxy.url }, strategy: { dir: settings.strategy.dir } };
}

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, payloadOf(getSettings));
  })
);

settingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body as
      | { proxy?: { url?: unknown }; strategy?: { dir?: unknown } }
      | undefined;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AppError('INVALID_ARGUMENT', 'body must be an object', 400);
    }
    if (body.proxy !== undefined && (typeof body.proxy !== 'object' || body.proxy === null)) {
      throw new AppError('INVALID_ARGUMENT', 'proxy must be an object', 400);
    }
    if (body.strategy !== undefined && (typeof body.strategy !== 'object' || body.strategy === null)) {
      throw new AppError('INVALID_ARGUMENT', 'strategy must be an object', 400);
    }

    const url = body.proxy?.url === undefined ? getSettings().proxy.url : String(body.proxy.url);

    let strategy: StrategySettings | undefined;
    if (body.strategy?.dir !== undefined) {
      const dir = String(body.strategy.dir).trim();
      if (dir && !isAbsolute(dir)) {
        throw new AppError('INVALID_ARGUMENT', 'strategy.dir 必须是绝对路径', 400, { dir });
      }
      if (dir) {
        try {
          configureStrategyDir(dir);
        } catch (error) {
          throw new AppError('INVALID_ARGUMENT', `策略文件夹不可用：${String(error)}`, 400, { dir });
        }
      }
      strategy = { dir, importedAt: dir ? Date.now() : null };
    }

    updateSettings({ proxy: { url }, ...(strategy ? { strategy } : {}) });
    sendSuccess(res, payloadOf(getSettings));
  })
);
