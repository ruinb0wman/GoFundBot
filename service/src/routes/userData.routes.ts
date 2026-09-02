import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess, sendFailure } from '../core/response.js';
import { getMarketIndices } from '../services/marketService.js';

export const watchlistRouter = Router();
export const portfolioRouter = Router();
export const alertRouter = Router();

watchlistRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { data: [], groups: [] });
  }),
);

watchlistRouter.get(
  '/:code',
  asyncHandler(async (req, res) => {
    sendSuccess(res, { watched: false });
  }),
);

watchlistRouter.post(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'ok' });
  }),
);

watchlistRouter.delete(
  '/:code',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'ok' });
  }),
);

watchlistRouter.post(
  '/batch-delete',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'ok' });
  }),
);

watchlistRouter.put(
  '/reorder',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'ok' });
  }),
);

watchlistRouter.put(
  '/move',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'ok' });
  }),
);

watchlistRouter.get(
  '/groups',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, []);
  }),
);

watchlistRouter.post(
  '/groups',
  asyncHandler(async (req, res) => {
    sendSuccess(res, { id: Date.now(), name: req.body?.name ?? '' });
  }),
);

watchlistRouter.put(
  '/groups/:id',
  asyncHandler(async (req, res) => {
    sendSuccess(res, { id: Number(req.params.id), name: req.body?.name ?? '' });
  }),
);

watchlistRouter.delete(
  '/groups/:id',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'ok' });
  }),
);

watchlistRouter.put(
  '/groups/reorder',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'ok' });
  }),
);

watchlistRouter.post(
  '/refresh-estimates',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'ok' });
  }),
);

portfolioRouter.get(
  '/funds',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, []);
  }),
);

portfolioRouter.get(
  '/holdings',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, []);
  }),
);

portfolioRouter.get(
  '/trades',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, []);
  }),
);

portfolioRouter.get(
  '/groups',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, []);
  }),
);

portfolioRouter.get(
  '/fund-group-map',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {});
  }),
);

alertRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, []);
  }),
);

alertRouter.post(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { id: Date.now() });
  }),
);

alertRouter.get(
  '/check',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { alerts: [], triggered: [] });
  }),
);

alertRouter.get(
  '/market-anomaly',
  asyncHandler(async (_req, res) => {
    const data = await getMarketIndices().catch(() => ({ data: { items: [] } }));
    sendSuccess(res, { anomalies: [], data: data.data });
  }),
);

alertRouter.get(
  '/anomaly-config',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { surge_threshold: 3, plunge_threshold: -3 });
  }),
);

alertRouter.put(
  '/anomaly-config',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'ok' });
  }),
);

alertRouter.get(
  '/anomaly-config/defaults',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { surge_threshold: 3, plunge_threshold: -3 });
  }),
);
