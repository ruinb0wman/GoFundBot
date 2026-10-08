import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { cache } from '../core/cache.js';
import {
  getFundScreeningSnapshot,
  getFundDetail,
} from '../services/fundService.js';
import {
  enrichScreening,
  getIndustryTagCounts,
  getScreenRows,
  getScreeningStatus,
  queryScreening,
  recomputeRanks,
  syncScreening,
} from '../services/screeningService.js';
import { fetchFundCodeSearchList } from '../providers/eastmoney/eastmoneyFundProvider.js';

export const screeningRouter = Router();

// ---------------------------------------------------------------------------
// 富化（风险指标 / 行业标签 / 4433 排名）自 P3.3 起在 **service** 完成并落 SQLite
// （`services/screeningService.ts`）；前端只调 /sync /compute /query /status。
// ---------------------------------------------------------------------------

screeningRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { status: 'ready', sync_available: true, ...getScreeningStatus() });
  }),
);

screeningRouter.get(
  '/sync',
  asyncHandler(async (req, res) => {
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    const force = req.query.force === 'true' || req.query.force === '1';
    const enrichLimit = Number(req.query.enrich_limit ?? req.query.enrichLimit ?? NaN);
    if (force) cache.clear();

    sendSuccess(
      res,
      await syncScreening({
        since,
        force,
        // 首批富化已从 /sync 里挪出（冷启动不再阻塞首屏）：只同步快照 + 排名，
        // 指标由前端/pi 循环 /compute 补（默认每批 300）。显式传 enrich_limit 时按传入值。
        enrichLimit: Number.isFinite(enrichLimit) ? enrichLimit : 0,
      }),
    );
  }),
);

/** 重算 4433 排名（无副作用，不取净值）。 */
screeningRouter.post(
  '/ranks',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { ranked: recomputeRanks(), ...getScreeningStatus() });
  }),
);

/**
 * 分批富化（风险指标）：一次一批（默认 300），前端循环调到底。
 * `ranks: true` 时顺带重算 4433。
 */
screeningRouter.post(
  '/compute',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { limit?: number; retry?: boolean; ranks?: boolean };
    const ranks = body.ranks === false ? 0 : recomputeRanks();
    const enriched = await enrichScreening({ limit: body.limit, retry: body.retry === true });
    sendSuccess(res, { ...enriched, ranked: ranks, ...getScreeningStatus() });
  }),
);

/** 筛选 + 排序 + 分页（服务端唯一真源，pi 也走这里）。 */
screeningRouter.post(
  '/query',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as {
      filters?: Record<string, unknown>;
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
      page?: number;
      page_size?: number;
    };
    sendSuccess(
      res,
      queryScreening({
        filters: body.filters,
        sortByField: body.sort_by,
        sortOrder: body.sort_order,
        page: body.page,
        pageSize: body.page_size,
      }),
    );
  }),
);

screeningRouter.get(
  '/industry-tags',
  asyncHandler(async (_req, res) => {
    const tags = getIndustryTagCounts();
    sendSuccess(res, { tags, total: tags.reduce((sum, t) => sum + t.count, 0) });
  }),
);

/** 策略沙箱 `screen()` 的全量字段（7 列）。 */
screeningRouter.get(
  '/screen-rows',
  asyncHandler(async (_req, res) => {
    const items = getScreenRows();
    sendSuccess(res, { items, total: items.length });
  }),
);

screeningRouter.get(
  '/progress',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {
      running: false,
      progress: 0,
      total: 0,
      current_fund: '',
      success_count: 0,
      fail_count: 0,
      message: 'idle',
    });
  }),
);

screeningRouter.post(
  '/update',
  asyncHandler(async (_req, res) => {
    // 刷新基金清单缓存（下次 /sync 会重新拉快照并入选）。
    cache.clear();
    await getFundScreeningSnapshot({ limitPerType: 500 });
    sendSuccess(res, { message: '基金清单缓存已刷新', task_id: null });
  }),
);

screeningRouter.post(
  '/stop',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: '已发送停止信号' });
  }),
);

screeningRouter.get(
  '/fund/:code',
  asyncHandler(async (req, res) => {
    const code = String(req.params.code);
    const detail = await getFundDetail(code);
    sendSuccess(res, detail);
  }),
);
