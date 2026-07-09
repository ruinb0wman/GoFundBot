import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { getFundScreeningSnapshot } from '../services/fundService.js';
import { getMarketSectors } from '../services/marketService.js';
import {
  buildDashboard,
  buildResearchMarketStats,
  buildResearchFundDashboard,
  buildResearchEtfTracking,
  buildResearchSectorSummary,
  buildResearchIndustryPerformance,
} from '../services/researchService.js';

export const researchRouter = Router();

researchRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 5, 20));
    const etfLimit = Math.max(10, Math.min(Number(req.query.etf_limit) || 80, 300));
    const [snapshotRes, sectorsRes] = await Promise.allSettled([
      getFundScreeningSnapshot({ pageSize: 2000 }),
      getMarketSectors(),
    ]);
    const items = snapshotRes.status === 'fulfilled' ? snapshotRes.value.data.items ?? [] : [];
    const sectorItems = sectorsRes.status === 'fulfilled' ? sectorsRes.value.data.items ?? [] : [];
    sendSuccess(res, buildDashboard(items, sectorItems, limit, etfLimit));
  }),
);

researchRouter.get(
  '/market-stats',
  asyncHandler(async (_req, res) => {
    const snapshot = await getFundScreeningSnapshot({ pageSize: 2000 });
    sendSuccess(res, buildResearchMarketStats(snapshot.data.items ?? []));
  }),
);

researchRouter.get(
  '/fund-dashboard',
  asyncHandler(async (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 5, 20));
    const snapshot = await getFundScreeningSnapshot({ pageSize: 2000 });
    sendSuccess(res, buildResearchFundDashboard(snapshot.data.items ?? [], limit));
  }),
);

researchRouter.get(
  '/etf-tracking',
  asyncHandler(async (req, res) => {
    const limit = Math.max(10, Math.min(Number(req.query.limit) || 80, 300));
    const snapshot = await getFundScreeningSnapshot({ pageSize: 2000 });
    sendSuccess(res, buildResearchEtfTracking(snapshot.data.items ?? [], limit));
  }),
);

researchRouter.get(
  '/industry-performance',
  asyncHandler(async (_req, res) => {
    const snapshot = await getFundScreeningSnapshot({ pageSize: 2000 });
    const data = buildResearchIndustryPerformance(snapshot.data.items ?? []);
    (data as Record<string, unknown>).task_status = {
      running: false,
      status: 'idle',
      message: '',
    };
    sendSuccess(res, data);
  }),
);

researchRouter.post(
  '/rebuild-industry-performance',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, {
      success: true,
      accepted: true,
      task_status: { running: false, status: 'idle', message: '当前以基金类型分组替代行业标签；后续通过 PythonRunner:classify_industry 支持重建。' },
      data: null,
    });
  }),
);

researchRouter.get(
  '/sector-summary',
  asyncHandler(async (req, res) => {
    const limit = Math.max(10, Math.min(Number(req.query.limit) || 50, 200));
    try {
      const sectors = await getMarketSectors();
      sendSuccess(res, buildResearchSectorSummary(sectors.data.items ?? [], limit));
    } catch {
      sendSuccess(res, { items: [], top_gainers: [], top_losers: [], inflow_leaders: [], summary: { total: 0, strong_count: 0, positive_count: 0, negative_count: 0 } });
    }
  }),
);
