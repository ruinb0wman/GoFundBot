import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { getFundScreeningSnapshot, searchFunds } from '../services/fundService.js';
import type { FundSearchItemDto, FundSearchResultDto, FundScreeningSnapshotItemDto } from '../types/fund.js';

export const screeningRouter = Router();

screeningRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {
      status: 'ready',
      db_update_status: 'idle',
      fund_count: 0,
      last_update_time: null,
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
        return_1y: f.return1y,
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
