import { Router } from 'express';
import type { Response } from 'express';
import { asyncHandler } from '../core/errors.js';
import { AppError } from '../core/errors.js';
import { sendSuccess, sendFailure } from '../core/response.js';
import { composeFundDetailLegacy, toLegacyRealtimeEstimate, getFundDetail, getFundBasic, getFundNavHistory, getFundHoldings, searchFunds } from '../services/fundService.js';
import type { FundNavPointDto } from '../types/fund.js';
import { logger } from '../core/logger.js';

export const fundLegacyRouter = Router();

function firstStr(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && val.length > 0) return String(val[0]);
  return undefined;
}

fundLegacyRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = firstStr(req.query.q);
    if (!q) {
      sendSuccess(res, []);
      return;
    }
    const result = await searchFunds(q.trim());
    const rawItems = result.data?.items ?? [];
    sendSuccess(res, rawItems.map(item => ({
      CODE: item.code,
      NAME: item.name,
      TYPE: item.type,
      PINYIN: item.pinyin,
    })));
  }),
);

fundLegacyRouter.get(
  '/search/status',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { status: 'ready', total: 0 });
  }),
);

fundLegacyRouter.get(
  '/:code',
  asyncHandler(async (req, res) => {
    const code = String(req.params.code);
    try {
      // 拼装在 `fundService.composeFundDetailLegacy`（与 pi 的 get_fund_detail 工具共用）。
      sendSuccess(res, await composeFundDetailLegacy(code));
    } catch (err) {
      if (err instanceof AppError && err.code === 'NOT_FOUND') {
        sendFailure(res, 404, { code: 'NOT_FOUND', message: `Fund ${code} not found` });
        return;
      }
      logger.error('Error building fund detail response', { code, error: String(err) });
      sendSuccess(res, { fund_code: code, fund_name: '' });
    }
  }),
);

fundLegacyRouter.get(
  '/:code/basic',
  asyncHandler(async (req, res) => {
    const code = String(req.params.code);
    const basicResult = await getFundBasic(code);
    sendSuccess(res, basicResult.data ?? {});
  }),
);

fundLegacyRouter.get(
  '/:code/trend',
  asyncHandler(async (req, res) => {
    const code = String(req.params.code);
    const navResult = await getFundNavHistory(code, {});
    const items = navResult.data?.items ?? [];
    const trend = items.map((i: FundNavPointDto) => ({
      date: i.date,
      net_worth: i.nav,
    }));
    const accumulated = items.map((i: FundNavPointDto) => ({
      date: i.date,
      acc_net_worth: i.accNav,
    }));
    sendSuccess(res, { fund_code: code, net_worth_trend: trend, accumulated_net_worth: accumulated });
  }),
);

fundLegacyRouter.get(
  '/:code/compare-data',
  asyncHandler(async (req, res) => {
    const code = String(req.params.code);
    const detailResult = await getFundDetail(code);
    const detail = detailResult.data;
    if (!detail) {
      sendFailure(res, 404, { code: 'NOT_FOUND', message: `Fund ${code} not found` });
      return;
    }

    const navItems = detail.sections.navHistory.data?.items ?? [];
    const trend = navItems.map((i: FundNavPointDto) => ({
      date: i.date,
      net_worth: i.nav,
    }));
    const accumulated = navItems.map((i: FundNavPointDto) => ({
      date: i.date,
      acc_net_worth: i.accNav,
    }));

    const estimateData = detail.sections.estimate.data;

    sendSuccess(res, {
      fund_code: code,
      fund_name: detail.sections.basic.data?.name ?? '',
      fund_type: detail.sections.basic.data?.type ?? '',
      net_worth_trend: trend,
      accumulated_net_worth: accumulated,
      realtime_estimate: toLegacyRealtimeEstimate(estimateData),
      risk_metrics: {},
      ranking: {},
      industry_tag: '',
      industry_ratio: 0,
      fund_managers: detail.sections.managers.data?.items ?? [],
      stock_holdings: detail.sections.holdings.data?.items ?? [],
    });
  }),
);

fundLegacyRouter.get(
  '/:code/industry-exposure',
  asyncHandler(async (req, res) => {
    const code = String(req.params.code);
    const holdingsResult = await getFundHoldings(code);
    sendSuccess(res, {
      fund_code: code,
      industry_tag: '',
      industry_ratio: 0,
      stock_holdings: holdingsResult.data?.items ?? [],
    });
  }),
);

// AI 基金分析（analyze / analyze/stream）已迁移至前端（fundAnalyst.ts），Node 不再提供。
