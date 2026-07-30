import { Router } from 'express';
import { AppError, asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import {
  getFundAssetAllocation,
  getFundDetail,
  getFundDividends,
  getFundEstimate,
  getFundEstimates,
  getFundBasic,
  getFundHoldings,
  getFundManagers,
  getFundNavBatch,
  getFundNavHistory,
  getFundRankHistory,
  getFundScreeningSnapshot,
  searchFunds,
} from '../services/fundService.js';

export const fundRouter = Router();

fundRouter.get(
  '/screening-snapshot',
  asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await getFundScreeningSnapshot({
        types: parseCsvQuery(req.query.types),
        sort: firstQueryValue(req.query.sort),
        pageSize: parseIntQuery(req.query.pageSize),
      })
    );
  })
);

fundRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await searchFunds(firstQueryValue(req.query.q)));
  })
);

fundRouter.get(
  '/estimates',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getFundEstimates(firstQueryValue(req.query.codes)));
  })
);

fundRouter.post(
  '/nav-batch',
  asyncHandler(async (req, res) => {
    const codes = (req.body?.codes ?? []) as string[];
    if (!Array.isArray(codes) || codes.length === 0) {
      throw new AppError('INVALID_ARGUMENT', 'codes (array of 6-digit fund codes) is required in request body', 400);
    }
    if (codes.length > 5000) {
      throw new AppError('INVALID_ARGUMENT', 'max 5000 codes allowed', 400);
    }
    sendSuccess(res, await getFundNavBatch(codes));
  })
);

fundRouter.get(
  '/:code/detail',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getFundDetail(routeParam(req.params.code)));
  })
);

fundRouter.get(
  '/:code/estimate',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getFundEstimate(routeParam(req.params.code)));
  })
);

fundRouter.get(
  '/:code/basic',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getFundBasic(routeParam(req.params.code)));
  })
);

fundRouter.get(
  '/:code/nav-history',
  asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await getFundNavHistory(routeParam(req.params.code), {
        startDate: firstQueryValue(req.query.startDate),
        endDate: firstQueryValue(req.query.endDate),
      })
    );
  })
);

fundRouter.get(
  '/:code/rank-history',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getFundRankHistory(routeParam(req.params.code)));
  })
);

fundRouter.get(
  '/:code/dividends',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getFundDividends(routeParam(req.params.code)));
  })
);

fundRouter.get(
  '/:code/holdings',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getFundHoldings(routeParam(req.params.code)));
  })
);

fundRouter.get(
  '/:code/managers',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getFundManagers(routeParam(req.params.code)));
  })
);

fundRouter.get(
  '/:code/asset-allocation',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getFundAssetAllocation(routeParam(req.params.code)));
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

function parseCsvQuery(value: unknown): string[] | undefined {
  const raw = firstQueryValue(value);
  if (!raw) {
    return undefined;
  }
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseIntQuery(value: unknown): number | undefined {
  const raw = firstQueryValue(value);
  if (!raw) {
    return undefined;
  }
  const num = Number(raw);
  return Number.isFinite(num) ? Math.floor(num) : undefined;
}
