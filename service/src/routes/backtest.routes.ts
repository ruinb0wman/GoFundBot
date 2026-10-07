import { Router } from 'express';
import { AppError, asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import {
  compareBacktestStrategies,
  runFixedInvestmentBacktest,
  runPortfolioBacktestForArgs,
} from '../services/backtestService.js';

/**
 * 服务端回测（用 `@gofund/core` 的引擎，与前端同源同值）。
 *
 * 参数沿用**聊天时代的 snake_case 契约**（`packages/core/src/backtest/toolArgs.ts` 负责映射），
 * 这样 P4 的工具面可以直接把工具参数转过来，也便于人工用 curl 复现页面上的回测。
 *
 * 语义：**结构错误**（body 不是对象、缺 `fund_code`/`assets`）→ 400；
 * **取数/数据不足** → 200 + `data.error`（与原聊天工具一致，消息本身可直接展示给用户）。
 */
export const backtestRouter = Router();

function body(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AppError('INVALID_ARGUMENT', 'body must be an object', 400);
  }
  return raw as Record<string, unknown>;
}

function requireFundCode(payload: Record<string, unknown>): void {
  if (!String(payload.fund_code ?? '').trim()) {
    throw new AppError('INVALID_ARGUMENT', 'fund_code is required', 400);
  }
}

backtestRouter.post(
  '/fixed-investment',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    requireFundCode(payload);
    sendSuccess(res, await runFixedInvestmentBacktest(payload));
  })
);

backtestRouter.post(
  '/portfolio',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    if (!Array.isArray(payload.assets) || payload.assets.length === 0) {
      throw new AppError('INVALID_ARGUMENT', 'assets must be a non-empty array', 400);
    }
    sendSuccess(res, await runPortfolioBacktestForArgs(payload));
  })
);

backtestRouter.post(
  '/compare-strategies',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    requireFundCode(payload);
    sendSuccess(res, await compareBacktestStrategies(payload));
  })
);
