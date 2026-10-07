/**
 * 投研看板：`GET /api/research/dashboard?limit=&etf_limit=`
 *
 * 前端 `/research` 页面与 pi 的 `get_research_dashboard` 工具共用（同一份 core 聚合）。
 */
import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { getResearchDashboard } from '../services/researchService.js';

export const researchRouter = Router();

researchRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit ?? NaN);
    const etfLimit = Number(req.query.etf_limit ?? NaN);
    sendSuccess(
      res,
      await getResearchDashboard({
        ...(Number.isFinite(limit) ? { limit } : {}),
        ...(Number.isFinite(etfLimit) ? { etfLimit } : {}),
      })
    );
  })
);
