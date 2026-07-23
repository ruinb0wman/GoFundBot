import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess, sendFailure } from '../core/response.js';
import { dataSourceScorer, type SourceScores } from '../core/dataSourceScorer.js';

export const datasourceScoresRouter = Router();

datasourceScoresRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const scores = dataSourceScorer.getScores();
    const stats = dataSourceScorer.getStats();
    sendSuccess(res, { scores, stats });
  }),
);

datasourceScoresRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body as { scores?: SourceScores } | undefined;
    if (!body || typeof body !== 'object' || !body.scores || typeof body.scores !== 'object') {
      sendFailure(res, 400, { code: 'INVALID_ARGUMENT', message: 'body.scores (object) is required' });
      return;
    }
    dataSourceScorer.setScores(body.scores);
    sendSuccess(res, { ok: true });
  }),
);
