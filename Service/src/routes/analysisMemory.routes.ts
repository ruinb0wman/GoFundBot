import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess, sendFailure } from '../core/response.js';
import { generateReflection } from '../services/memoryService.js';

export const analysisMemoryRouter = Router();

analysisMemoryRouter.post(
  '/reflect',
  asyncHandler(async (req, res) => {
    const { fundCode, rating, thesis, sentimentScore, actualReturn } = req.body as Record<string, unknown>;
    if (!fundCode || !rating || actualReturn == null) {
      sendFailure(res, 400, { code: 'INVALID_ARGUMENT', message: 'fundCode, rating, and actualReturn are required' });
      return;
    }
    const result = await generateReflection({
      fundCode: String(fundCode),
      rating: String(rating),
      thesis: String(thesis ?? ''),
      sentimentScore: Number(sentimentScore ?? 50),
      actualReturn: Number(actualReturn),
    });
    sendSuccess(res, result);
  }),
);
