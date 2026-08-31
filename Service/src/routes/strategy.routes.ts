import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess, sendFailure } from '../core/response.js';
import { draftStrategy } from '../services/strategyService.js';

export const strategyRouter = Router();

const draftSchema = z.object({
  topic: z.string().trim().min(1).max(500),
  strategyContext: z.string().max(8000).optional(),
});

strategyRouter.post(
  '/draft',
  asyncHandler(async (req, res) => {
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) {
      sendFailure(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: 'topic is required (1-500 chars)',
        detail: parsed.error.flatten(),
      });
      return;
    }
    const result = await draftStrategy(parsed.data);
    sendSuccess(res, result);
  }),
);
