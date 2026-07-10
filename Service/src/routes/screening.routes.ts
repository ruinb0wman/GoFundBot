import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { getFundScreeningSnapshot, searchFunds } from '../services/fundService.js';
import { cache } from '../core/cache.js';
import type { FundSearchItemDto, FundSearchResultDto, FundScreeningSnapshotItemDto } from '../types/fund.js';

export const screeningRouter = Router();

screeningRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {
      status: 'ready',
      sync_available: true,
      basic_count: 0,
      latest_update: null,
    });
  }),
);

screeningRouter.get(
  '/sync',
  asyncHandler(async (req, res) => {
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    const force = req.query.force === 'true' || req.query.force === '1';

    // 强制刷新：清除内存缓存
    if (force) {
      cache.clear();
    }

    const snapshot = await getFundScreeningSnapshot({ limitPerType: 500 });
    const updatedAt = snapshot.updatedAt?.toISOString?.() || null;

    // 前端传了 since 且缓存未刷新 → 返回 unchanged
    if (since && updatedAt && since >= updatedAt) {
      sendSuccess(res, {
        unchanged: true,
        sync_time: updatedAt,
      });
      return;
    }

    const allFunds = ((snapshot.data as { items?: FundScreeningSnapshotItemDto[] } | undefined)?.items ?? []);
    const funds = allFunds.map((f: FundScreeningSnapshotItemDto) => ({
      fund_code: f.code,
      fund_name: f.name,
      fund_type: f.type,
      return_1m: f.return1m,
      return_3m: f.return3m,
      return_6m: f.return6m,
      return_1y: f.return1y,
      return_2y: f.return2y,
      return_3y: f.return3y,
      ytd: f.ytd,
      since_inception: f.sinceInception,
      fee: f.fee,
      nav: f.nav,
      nav_date: f.navDate,
      source: f.source,
      updated_time: f.updatedAt,
    }));
    sendSuccess(res, {
      unchanged: false,
      funds,
      total: funds.length,
      sync_time: new Date().toISOString(),
    });
  }),
);

screeningRouter.get(
  '/progress',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {
      running: false,
      current: 0,
      total: 0,
      progress: 0,
      message: '',
    });
  }),
);

screeningRouter.post(
  '/update',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'Update requested', task_id: null });
  }),
);

screeningRouter.post(
  '/stop',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'Stopped' });
  }),
);

screeningRouter.post(
  '/query',
  asyncHandler(async (req, res) => {
    const { keyword, fund_types, sort_by, sort_order, page = 1, page_size = 20 } = req.body ?? {};

    if (keyword) {
      const searchResult = await searchFunds(keyword);
      const items = ((searchResult.data as FundSearchResultDto | undefined)?.items ?? []) as FundSearchItemDto[];
      sendSuccess(res, {
        funds: items.map((f: FundSearchItemDto) => ({
          fund_code: f.code,
          fund_name: f.name,
          fund_type: f.type,
        })),
        total: items.length,
        page,
        page_size,
      });
      return;
    }

    const snapshot = await getFundScreeningSnapshot({
      types: fund_types ? String(fund_types).split(',') : undefined,
      sort: sort_by,
      pageSize: page_size as number,
    });

    const allFunds = (snapshot.data as { items?: FundScreeningSnapshotItemDto[] } | undefined)?.items ?? [];
    const total = allFunds.length;
    const start = ((page as number) - 1) * (page_size as number);
    const pageItems = allFunds.slice(start, start + (page_size as number));

    sendSuccess(res, {
      funds: pageItems.map((f: FundScreeningSnapshotItemDto) => ({
        fund_code: f.code,
        fund_name: f.name,
        fund_type: f.type,
        return_1m: f.return1m,
        return_3m: f.return3m,
        return_6m: f.return6m,
        return_1y: f.return1y,
        return_2y: f.return2y,
        return_3y: f.return3y,
        ytd: f.ytd,
        since_inception: f.sinceInception,
        fee: f.fee,
        nav: f.nav,
        nav_date: f.navDate,
        source: f.source,
        updated_at: f.updatedAt,
      })),
      total,
      page,
      page_size,
    });
  }),
);

screeningRouter.get(
  '/strategies',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { strategies: [] });
  }),
);

screeningRouter.post(
  '/available-types',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { types: [] });
  }),
);

screeningRouter.get(
  '/industry-tags',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { tags: [] });
  }),
);

screeningRouter.get(
  '/stock-industry/status',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { status: 'not_built', progress: 0 });
  }),
);

screeningRouter.post(
  '/stock-industry/warmup',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'Warmup not available in legacy mode' });
  }),
);

screeningRouter.get(
  '/fund/:code',
  asyncHandler(async (req, res) => {
    sendSuccess(res, { fund_code: req.params.code });
  }),
);

screeningRouter.post(
  '/fill-risk',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'Not available' });
  }),
);

screeningRouter.post(
  '/recalculate-rankings',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'Not available' });
  }),
);
