import { Router } from 'express';
import { asyncHandler, assertDate, assertNumberRange } from '../core/errors.js';
import { sendSuccess, sendFailure } from '../core/response.js';
import { logger } from '../core/logger.js';
import {
  analyzeLogs,
  appendEntry,
  existsLogFile,
  readLogs,
} from '../services/logService.js';

const VALID_SOURCES = ['dataservice', 'frontend'];
const VALID_LEVELS = ['info', 'warn', 'error'];
const MAX_LIMIT = 2000;

export const logsRouter = Router();

logsRouter.get(
  '/read',
  asyncHandler(async (req, res) => {
    const source = String(req.query.source ?? 'dataservice');
    if (!VALID_SOURCES.includes(source)) {
      sendFailure(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: `source must be one of: ${VALID_SOURCES.join(', ')}`,
        detail: { source },
      });
      return;
    }

    const date = assertDate(String(req.query.date ?? ''), 'date');
    const level = String(req.query.level ?? '').toLowerCase();
    if (level && !VALID_LEVELS.includes(level)) {
      sendFailure(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: `level must be one of: ${VALID_LEVELS.join(', ')}`,
        detail: { level },
      });
      return;
    }

    const limit = assertNumberRange(String(req.query.limit ?? '200'), 1, MAX_LIMIT, 'limit');
    const offset = assertNumberRange(String(req.query.offset ?? '0'), 0, 1_000_000, 'offset');
    const keyword = String(req.query.q ?? '').trim();

    const result = readLogs(source, date, { level, keyword, limit, offset });
    sendSuccess(res, result);
  }),
);

logsRouter.post(
  '/ingest',
  asyncHandler(async (req, res) => {
    const body = req.body as { entries?: unknown };
    if (!body || typeof body !== 'object' || !Array.isArray(body.entries)) {
      sendFailure(res, 400, { code: 'INVALID_ARGUMENT', message: 'entries must be a list' });
      return;
    }

    const entries = body.entries.slice(0, 200);
    let count = 0;
    const now = new Date().toISOString();
    for (const raw of entries) {
      if (typeof raw !== 'object' || raw === null) continue;
      const entry = raw as Record<string, unknown>;
      if (typeof entry.level !== 'string' || typeof entry.message !== 'string') continue;
      const level = entry.level.toLowerCase();
      if (!VALID_LEVELS.includes(level)) continue;

      appendEntry('frontend', {
        level,
        message: entry.message,
        time: typeof entry.time === 'string' ? entry.time : now,
        ...(entry.context !== undefined && typeof entry.context === 'object'
          ? { context: entry.context as Record<string, unknown> }
          : {}),
      });
      count += 1;
    }

    if (count > 0) {
      logger.info(`ingested ${count} frontend log entries`);
    }
    sendSuccess(res, { count });
  }),
);

logsRouter.post(
  '/analyze',
  asyncHandler(async (req, res) => {
    const body = req.body as { source?: string; date?: string } | null;
    const source = String(body?.source ?? 'dataservice');
    if (!VALID_SOURCES.includes(source)) {
      sendFailure(res, 400, {
        code: 'INVALID_ARGUMENT',
        message: `source must be one of: ${VALID_SOURCES.join(', ')}`,
        detail: { source },
      });
      return;
    }

    const date = assertDate(String(body?.date ?? ''), 'date');
    if (!existsLogFile(source, date)) {
      sendFailure(res, 404, {
        code: 'INVALID_ARGUMENT',
        message: `日志文件不存在: ${source}/${date}`,
        detail: { source, date },
      });
      return;
    }

    sendSuccess(res, analyzeLogs(source, date));
  }),
);
