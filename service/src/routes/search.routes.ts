import { Router } from 'express';
import { AppError, asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { searchWeb } from '../ai/search.js';

/**
 * 搜索网关（无 key）：Exa（免费）→ DuckDuckGo 降级链。
 *
 * 应用不再持有任何 LLM/搜索密钥 —— pi 是唯一 AI，它自带 web_search；
 * 这条路由留给需要 HTTP 搜索的服务端调用方。
 */
export const searchRouter = Router();

searchRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AppError('INVALID_ARGUMENT', 'body must be an object', 400);
    }
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) throw new AppError('INVALID_ARGUMENT', 'query is required', 400);
    const maxResults = typeof body.max_results === 'number' ? body.max_results : 5;

    sendSuccess(res, await searchWeb(query, maxResults));
  })
);
