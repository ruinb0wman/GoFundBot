import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { errorHandler, notFoundHandler } from './core/errors.js';
import { logger } from './core/logger.js';
import { alertRouter, portfolioRouter, watchlistRouter } from './routes/userData.routes.js';
import { backtestRouter } from './routes/backtest.routes.js';
import { fundLegacyRouter } from './routes/fundLegacy.routes.js';
import { fundRouter } from './routes/fund.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { marketRouter } from './routes/market.routes.js';
import { newsRouter } from './routes/news.routes.js';
import { researchRouter } from './routes/research.routes.js';
import { screeningRouter } from './routes/screening.routes.js';
import { stockRouter } from './routes/stock.routes.js';
import { settingsRouter } from './routes/settings.routes.js';
import { systemRouter } from './routes/system.routes.js';
import { chatRouter } from './routes/chat.routes.js';
import { analysisMemoryRouter } from './routes/analysisMemory.routes.js';
import { datasourceScoresRouter } from './routes/datasource-scores.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({ origin: parseCorsOrigin(process.env.CORS_ORIGINS) }));
  app.use(express.json({ limit: '256kb' }));
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' },
  }));
  app.use(requestLogger);

  app.use('/api/health', healthRouter);
  app.use('/api/fund', fundLegacyRouter);
  app.use('/api/funds', fundRouter);
  app.use('/api/market', marketRouter);
  app.use('/api/stocks', stockRouter);
  app.use('/api/news', newsRouter);
  app.use('/api/backtest', backtestRouter);
  app.use('/api/watchlist', watchlistRouter);
  app.use('/api/user/portfolio', portfolioRouter);
  app.use('/api/alerts', alertRouter);
  app.use('/api/screening', screeningRouter);
  app.use('/api/research', researchRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api', systemRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/analysis-memory', analysisMemoryRouter);
  app.use('/api/datasource-scores', datasourceScoresRouter);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const docsDist = path.resolve(__dirname, '../../docs/.vitepress/dist');
  if (process.env.NODE_ENV === 'production' || process.env.SERVE_DOCS === 'true') {
    app.use('/docs', express.static(docsDist));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = crypto.randomUUID().slice(0, 8);
  const reqLogger = logger.child({ requestId });
  (req as unknown as Record<string, unknown>).requestId = requestId;

  const startedAt = Date.now();
  reqLogger.info('request start', {
    method: req.method,
    path: req.path,
    query: Object.keys(req.query),
  });

  res.on('finish', () => {
    reqLogger.info('request end', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
}

function parseCorsOrigin(raw: string | undefined): boolean | string[] {
  if (!raw || raw.trim() === '*') {
    return true;
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
