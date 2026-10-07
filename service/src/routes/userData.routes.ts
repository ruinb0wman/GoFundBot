import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { getMarketIndices } from '../services/marketService.js';

/**
 * 遗留的用户数据桩路由（portfolio / alerts）—— **已知缺口**：前端实时页/持仓页仍在调用
 * （`useFundRealtimeGroups`、`useFundRealtimeTrade`、`useFundDetail` 经 `services/portfolioApi.ts`），
 * 但 service 侧不落库（读回空数组、写入只回一个 id），所以「分组 / 交易记录」改动不会保存。
 * 要修就把这几张表做进 SQLite，或删掉对应前端入口。
 *
 *
 * 前端已不再调用它们（用户数据改走 `/api/positions`、`/api/watchlist`、
 * `/api/strategies`、`/api/backtest-scripts`），保留只为不破坏既有 API 表面。
 * 自选（watchlist）已移出到 `watchlist.routes.ts` 并接了 SQLite。
 */
export const portfolioRouter = Router();
export const alertRouter = Router();

portfolioRouter.get(
  '/funds',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, []);
  })
);

portfolioRouter.get(
  '/holdings',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, []);
  })
);

portfolioRouter.get(
  '/trades',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, []);
  })
);

portfolioRouter.get(
  '/groups',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, []);
  })
);

portfolioRouter.get(
  '/fund-group-map',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {});
  })
);

alertRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, []);
  })
);

alertRouter.post(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { id: Date.now() });
  })
);

alertRouter.get(
  '/check',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { alerts: [], triggered: [] });
  })
);

alertRouter.get(
  '/market-anomaly',
  asyncHandler(async (_req, res) => {
    const data = await getMarketIndices().catch(() => ({ data: { items: [] } }));
    sendSuccess(res, { anomalies: [], data: data.data });
  })
);

alertRouter.get(
  '/anomaly-config',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { surge_threshold: 3, plunge_threshold: -3 });
  })
);

alertRouter.put(
  '/anomaly-config',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'ok' });
  })
);

alertRouter.get(
  '/anomaly-config/defaults',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { surge_threshold: 3, plunge_threshold: -3 });
  })
);
