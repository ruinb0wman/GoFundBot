import { Router } from 'express';
import type { Response } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess, sendFailure } from '../core/response.js';
import { getFundDetail, getFundBasic, getFundNavHistory, getFundHoldings, searchFunds } from '../services/fundService.js';
import { analyzeFund, analyzeFundStream } from '../services/aiAnalyst.js';
import type { AnalystInput } from '../services/aiAnalyst.js';
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
    const detailResult = await getFundDetail(code);
    const detail = detailResult.data;
    if (!detail) {
      sendFailure(res, 404, { code: 'NOT_FOUND', message: `Fund ${code} not found` });
      return;
    }

    try {
      const navItems = detail.sections.navHistory.data?.items ?? [];
      const basicData = detail.sections.basic.data;
      const estimateData = detail.sections.estimate.data;
      const perfData = detail.sections.performance.data;
      const response: Record<string, unknown> = {
        fund_code: code,
        fund_name: basicData?.name ?? '',
        fund_type: basicData?.type ?? '',
        net_worth_trend: navItems.map((i: FundNavPointDto) => ({
          date: i.date,
          net_worth: i.nav,
        })),
        accumulated_net_worth: navItems.map((i: FundNavPointDto) => ({
          date: i.date,
          acc_net_worth: i.accNav,
        })),
        basic_info: {
          fund_name: basicData?.name ?? '',
          fund_type: basicData?.type ?? '',
          current_rate: basicData?.currentRate ?? null,
          min_subscription_amount: basicData?.minSubscriptionAmount ?? null,
        },
        realtime_estimate: {
          estimate_value: estimateData?.estimatedNav ?? null,
          estimate_change: estimateData?.estimatedChangePercent ?? null,
          estimate_time: estimateData?.estimateTime ?? null,
          net_worth: estimateData?.nav ?? null,
          net_worth_date: estimateData?.navDate ?? null,
          name: estimateData?.name ?? null,
        },
        performance: {
          '1_month_return': perfData?.return1m ?? null,
          '3_month_return': perfData?.return3m ?? null,
          '6_month_return': perfData?.return6m ?? null,
          '1_year_return': perfData?.return1y ?? null,
        },
        total_return_trend: detail.sections.totalReturnTrend.data?.series ?? [],
        rank_history: detail.sections.rankHistory.data?.items ?? [],
        ranking_trend: (detail.sections.rankHistory.data?.items ?? []).map(item => ({
          date: item.date,
          rank: item.rank,
          total_funds: item.total,
        })),
        ranking_percentage: (detail.sections.rankHistory.data?.items ?? []).map(item => ({
          date: item.date,
          position_percentage: item.percentile,
        })),
        fund_managers: (detail.sections.managers.data?.items ?? []).map(m => ({
          id: m.id,
          name: m.name,
          photo_url: m.photoUrl,
          star_rating: m.starRating,
          work_experience: m.workExperience,
          managed_fund_size: m.managedFundSize,
          start_date: m.startDate,
          end_date: m.endDate,
          tenure: m.tenure,
          description: m.description,
          ability_assessment: m.abilityAssessment,
          performance: m.performance,
        })),
        stock_holdings: detail.sections.holdings.data?.items ?? [],
        portfolio: {
          stock_codes_new: (detail.sections.holdings.data?.items ?? []).map(item => ({
            code: item.stockCode,
            name: item.stockName,
            ratio: item.ratio,
          })),
        },
        asset_allocation: detail.sections.assetAllocation.data ?? { categories: [], series: [] },
        holder_structure: detail.sections.holderStructure.data ?? null,
        scale_fluctuation: detail.sections.scaleFluctuation.data ?? null,
        subscription_redemption: detail.sections.subscriptionRedemption.data ?? null,
        performance_evaluation: detail.sections.performanceEvaluation.data ?? null,
        same_type_funds: detail.sections.sameTypeFunds.data ?? [],
        risk_metrics: {},
        industry_tag: '',
        industry_ratio: 0,
      };

      sendSuccess(res, response);
    } catch (err) {
      logger.error('Error building fund detail response', { code, error: String(err) });
      sendSuccess(res, { fund_code: code, fund_name: detail.sections.basic.data?.name ?? '' });
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

    sendSuccess(res, {
      fund_code: code,
      fund_name: detail.sections.basic.data?.name ?? '',
      fund_type: detail.sections.basic.data?.type ?? '',
      net_worth_trend: trend,
      accumulated_net_worth: accumulated,
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

fundLegacyRouter.get(
  '/:code/analyze',
  asyncHandler(async (req, res) => {
    const code = String(req.params.code);
    const llmConfig = req.body?.llmConfig;
    const detailResult = await getFundDetail(code);
    const detail = detailResult.data;
    if (!detail) {
      sendFailure(res, 404, { code: 'NOT_FOUND', message: `Fund ${code} not found` });
      return;
    }

    const holdings = detail.sections.holdings.data?.items
      ?.slice(0, 10)
      ?.map((h) => ({ name: h.stockName, code: h.stockCode, ratio: h.ratio ?? undefined }));

    const managers = detail.sections.managers.data?.items
      ?.map((m) => ({
        name: m.name ?? undefined,
        workExperience: m.workExperience ? parseInt(m.workExperience) || undefined : undefined,
        managedFundSize: m.managedFundSize ?? undefined,
      }));

    const input: AnalystInput = {
      fundCode: code,
      fundName: detail.sections.basic.data?.name ?? '',
      fundType: detail.sections.basic.data?.type ?? '',
      netWorthTrend: detail.sections.navHistory.data?.items?.map((i: FundNavPointDto) => ({
        date: i.date,
        netWorth: i.nav,
      })),
      riskMetrics: {},
      holdings,
      managers,
      industryTag: '',
      pastContext: req.body?.pastContext,
    };

    const result = await analyzeFund(input, llmConfig);
    sendSuccess(res, result);
  }),
);

fundLegacyRouter.post(
  '/:code/analyze/stream',
  asyncHandler(async (req, res) => {
    const code = String(req.params.code);
    const llmConfig = req.body?.llmConfig;
    const pastContext = req.body?.pastContext;
    const detailResult = await getFundDetail(code);
    const detail = detailResult.data;
    if (!detail) {
      sendFailure(res, 404, { code: 'NOT_FOUND', message: `Fund ${code} not found` });
      return;
    }

    const holdings = detail.sections.holdings.data?.items
      ?.slice(0, 10)
      ?.map((h) => ({ name: h.stockName, code: h.stockCode, ratio: h.ratio ?? undefined }));

    const managers = detail.sections.managers.data?.items
      ?.map((m) => ({
        name: m.name ?? undefined,
        workExperience: m.workExperience ? parseInt(m.workExperience) || undefined : undefined,
        managedFundSize: m.managedFundSize ?? undefined,
      }));

    const input: AnalystInput = {
      fundCode: code,
      fundName: detail.sections.basic.data?.name ?? '',
      fundType: detail.sections.basic.data?.type ?? '',
      netWorthTrend: detail.sections.navHistory.data?.items?.map((i: FundNavPointDto) => ({
        date: i.date,
        netWorth: i.nav,
      })),
      riskMetrics: {},
      holdings,
      managers,
      industryTag: '',
      pastContext,
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      for await (const event of analyzeFundStream(input, llmConfig)) {
        res.write(`event: ${event.stage}\ndata: ${event.content}\n\n`);
      }
    } catch (err) {
      logger.error('SSE stream error', { code, error: String(err) });
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
    } finally {
      res.end();
    }
  }),
);
