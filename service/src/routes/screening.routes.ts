import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { cache } from '../core/cache.js';
import {
  getFundScreeningSnapshot,
  getFundDetail,
} from '../services/fundService.js';
import { fetchFundCodeSearchList } from '../providers/eastmoney/eastmoneyFundProvider.js';
import type { FundScreeningSnapshotItemDto } from '../types/fund.js';

export const screeningRouter = Router();

// ---------------------------------------------------------------------------
// 风险指标 / 行业标签丰富化已迁移至前端（frontend services/industryClassifier
// + riskMetrics），Node 侧的 /screening/* 仅返回原始基金清单与 NAV。
// ---------------------------------------------------------------------------

function toRawFund(
  code: string,
  name: string,
  snapshotItem?: FundScreeningSnapshotItemDto,
): Record<string, unknown> {
  return {
    fund_code: code,
    fund_name: name,
    fund_type: snapshotItem?.type ?? null,
    return_1m: snapshotItem?.return1m ?? null,
    return_3m: snapshotItem?.return3m ?? null,
    return_6m: snapshotItem?.return6m ?? null,
    return_1y: snapshotItem?.return1y ?? null,
    return_2y: snapshotItem?.return2y ?? null,
    return_3y: snapshotItem?.return3y ?? null,
    ytd: snapshotItem?.ytd ?? null,
    since_inception: snapshotItem?.sinceInception ?? null,
    fee: snapshotItem?.fee ?? null,
    nav: snapshotItem?.nav ?? null,
    nav_date: snapshotItem?.navDate ?? null,
    source: snapshotItem?.source ?? null,
    updated_time: snapshotItem?.updatedAt ?? null,
  };
}

screeningRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {
      status: 'ready',
      sync_available: true,
      basic_count: 0,
      risk_metrics_count: 0,
      latest_update: null,
    });
  }),
);

screeningRouter.get(
  '/sync',
  asyncHandler(async (req, res) => {
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    const force = req.query.force === 'true' || req.query.force === '1';
    if (force) cache.clear();

    const snapshot = await getFundScreeningSnapshot({ limitPerType: 500 });
    const updatedAt = snapshot.updatedAt?.toISOString?.() || null;

    if (since && updatedAt && since >= updatedAt) {
      sendSuccess(res, { unchanged: true, sync_time: updatedAt });
      return;
    }

    const allFunds = ((snapshot.data as { items?: FundScreeningSnapshotItemDto[] })?.items ?? []);
    const funds = allFunds.map(f => toRawFund(f.code, f.name, f));
    sendSuccess(res, { unchanged: false, funds, total: funds.length, sync_time: new Date().toISOString() });
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
    // 前端丰富化已本地化；此处仅刷新基金清单快照缓存。
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
  '/strategies',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { strategies: [] });
  }),
);

screeningRouter.post(
  '/available-types',
  asyncHandler(async (_req, res) => {
    const list = await fetchFundCodeSearchList();
    const types = [...new Set(list.map(f => f.type).filter(Boolean))].sort();
    sendSuccess(res, { types });
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
    sendSuccess(res, { message: 'Not available in Node.js screening service' });
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
