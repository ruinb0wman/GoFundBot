import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess, sendFailure } from '../core/response.js';
import { getFundNavHistory } from '../services/fundService.js';
import { runBacktest } from '../services/pythonRunner.js';

export const backtestRouter = Router();

const fixedInvestmentSchema = z.object({
  fundCode: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  investmentType: z.enum(['monthly', 'weekly', 'lump_sum']).default('monthly'),
  amount: z.number().positive().default(1000),
  initialAmount: z.number().min(0).default(0),
  feeRate: z.number().min(0).max(1).default(0.0015),
  takeProfitRate: z.number().min(0).max(1).nullable().optional(),
  stopLossRate: z.number().min(0).max(1).nullable().optional(),
});

backtestRouter.post(
  '/fixed-investment',
  asyncHandler(async (req, res) => {
    const parsed = fixedInvestmentSchema.safeParse(req.body);
    if (!parsed.success) {
      sendFailure(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: 'Invalid request body',
        detail: parsed.error.flatten(),
      });
      return;
    }

    const { fundCode, startDate, endDate, investmentType, amount, initialAmount, feeRate, takeProfitRate, stopLossRate } = parsed.data;

    const navResult = await getFundNavHistory(fundCode, { startDate, endDate });
    const items = navResult.data?.items ?? [];

    if (items.length < 2) {
      sendFailure(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: `Insufficient NAV data for ${fundCode} from ${startDate} to ${endDate}`,
      });
      return;
    }

    const navHistory = items.map((item) => ({
      date: item.date,
      nav: item.nav,
    }));

    const result = await runBacktest({
      fundCode,
      navHistory,
      investmentType,
      amount,
      initialAmount,
      feeRate,
      takeProfitRate: takeProfitRate ?? null,
      stopLossRate: stopLossRate ?? null,
    });

    sendSuccess(res, result);
  }),
);

backtestRouter.post(
  '/strategy-suggest',
  asyncHandler(async (req, res) => {
    const { fundCode } = req.body as { fundCode?: string };
    if (!fundCode) {
      sendFailure(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: 'Missing fundCode',
      });
      return;
    }

    const navResult = await getFundNavHistory(fundCode, {});
    const items = navResult.data?.items ?? [];

    if (items.length < 30) {
      sendFailure(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: `Insufficient NAV data for ${fundCode} (need at least 30 data points, got ${items.length})`,
      });
      return;
    }

    const navHistory = items.map((item) => ({
      date: item.date,
      nav: item.nav,
    }));

    const result = await runBacktest({
      fundCode,
      navHistory,
      investmentType: 'monthly',
      amount: 1000,
      initialAmount: 0,
      feeRate: 0.0015,
    });

    sendSuccess(res, result);
  }),
);
