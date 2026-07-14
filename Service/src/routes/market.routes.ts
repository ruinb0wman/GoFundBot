import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import {
  getGlobalIndexKline,
  getGlobalIndices,
  getGoldHistory,
  getIndexDetail,
  getMarketBreadth,
  getMarketIndices,
  getMarketKline,
  getMarketMoneyFlow,
  getMarketOverview,
  getMarketQuotes,
  getMarketSectorConstituents,
  getMarketSectorsFromAkshare,
  getSilverHistory,
  getNorthFlow,
  getStockMoneyFlow,
} from '../services/marketService.js';

export const marketRouter = Router();

marketRouter.get(
  '/quotes',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getMarketQuotes(firstQueryValue(req.query.symbols)));
  })
);

marketRouter.get(
  '/index/:code/detail',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getIndexDetail(routeParam(req.params.code)));
  })
);

marketRouter.get(
  '/kline/:symbol',
  asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await getMarketKline(routeParam(req.params.symbol), {
        period: firstQueryValue(req.query.period),
        adjust: firstQueryValue(req.query.adjust),
        startDate: firstQueryValue(req.query.startDate),
        endDate: firstQueryValue(req.query.endDate),
      })
    );
  })
);

marketRouter.get(
  '/kline/global/:symbol',
  asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await getGlobalIndexKline(routeParam(req.params.symbol), {
        period: firstQueryValue(req.query.period),
        startDate: firstQueryValue(req.query.startDate),
        endDate: firstQueryValue(req.query.endDate),
      })
    );
  })
);

marketRouter.get(
  '/indices',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getMarketIndices());
  })
);

marketRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    res.json(await getMarketOverview());
  })
);

marketRouter.get(
  '/sectors',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(firstQueryValue(req.query.limit) ?? '90', 10) || 90, 1), 120);
    const result = await getMarketSectorsFromAkshare(limit);
    if (result.error) {
      res.json({
        success: false,
        data: [],
        error: result.error,
        total_count: 0,
        update_time: new Date().toISOString(),
        data_date: '',
        source: result.source,
      });
      return;
    }
    res.json({
      success: true,
      data: result.items,
      total_count: result.items.length,
      update_time: new Date().toISOString(),
      data_date: '',
      source: result.source,
    });
  })
);

marketRouter.get(
  '/sectors/:code/constituents',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getMarketSectorConstituents(routeParam(req.params.code)));
  })
);

marketRouter.get(
  '/money-flow/:symbol',
  asyncHandler(async (req, res) => {
    const days = firstQueryValue(req.query.days);
    sendSuccess(res, await getStockMoneyFlow(routeParam(req.params.symbol), days ? parseInt(days, 10) : undefined));
  })
);

marketRouter.get(
  '/money-flow',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, await getMarketMoneyFlow());
  })
);

marketRouter.get(
  '/breadth',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, await getMarketBreadth());
  })
);

marketRouter.get(
  '/north-flow',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, await getNorthFlow());
  })
);

marketRouter.get(
  '/gold/history',
  asyncHandler(async (req, res) => {
    const days = parseInt(firstQueryValue(req.query.days) ?? '10', 10) || 10;
    res.json(await getGoldHistory(days));
  })
);

marketRouter.get(
  '/silver/history',
  asyncHandler(async (req, res) => {
    const days = parseInt(firstQueryValue(req.query.days) ?? '10', 10) || 10;
    res.json(await getSilverHistory(days));
  })
);

marketRouter.get(
  '/global-indices',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, await getGlobalIndices());
  })
);

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}
