import { Router } from 'express';
import { AppError, asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import {
  addStrategy,
  createStrategyScript,
  deleteStrategyScript,
  getStrategyScript,
  listStrategies,
  listStrategyScripts,
  recordScriptRun,
  removeStrategy,
  updateStrategy,
  updateStrategyScript,
} from '../services/userDataService.js';

/** 策略记忆（`/strategy` 页）——pi 的 dev 桥写的就是这批数据。 */
export const strategiesRouter = Router();

/** 已保存的回测方案（`/backtest` 页）。 */
export const backtestScriptsRouter = Router();

function body(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AppError('INVALID_ARGUMENT', 'body must be an object', 400);
  }
  return raw as Record<string, unknown>;
}

function requireId(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError('INVALID_ARGUMENT', 'id must be a positive integer', 400, { id: value });
  }
  return parsed;
}

// ── strategies ───────────────────────────────────────────────────────────────

strategiesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { items: listStrategies() });
  })
);

strategiesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    const title = String(payload.title ?? '').trim();
    if (!title) throw new AppError('INVALID_ARGUMENT', 'title is required', 400);
    sendSuccess(
      res,
      addStrategy({
        title,
        content: String(payload.content ?? ''),
        tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
        active: payload.active === undefined ? 1 : Number(payload.active) ? 1 : 0,
        source: payload.source === 'ai-draft' ? 'ai-draft' : 'manual',
      })
    );
  })
);

strategiesRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    const updated = updateStrategy(requireId(req.params.id), {
      ...(payload.title !== undefined ? { title: String(payload.title) } : {}),
      ...(payload.content !== undefined ? { content: String(payload.content) } : {}),
      ...(payload.tags !== undefined
        ? { tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [] }
        : {}),
      ...(payload.active !== undefined ? { active: Number(payload.active) ? 1 : 0 } : {}),
      ...(payload.source !== undefined
        ? { source: payload.source === 'ai-draft' ? 'ai-draft' : 'manual' }
        : {}),
    });
    if (!updated) throw new AppError('INVALID_ARGUMENT', `strategy ${req.params.id} not found`, 404);
    sendSuccess(res, updated);
  })
);

strategiesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    removeStrategy(requireId(req.params.id));
    sendSuccess(res, { items: listStrategies() });
  })
);

// ── backtest scripts ─────────────────────────────────────────────────────────

backtestScriptsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { items: listStrategyScripts() });
  })
);

backtestScriptsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    const name = String(payload.name ?? '').trim();
    if (!name) throw new AppError('INVALID_ARGUMENT', 'name is required', 400);
    if (typeof payload.code !== 'string' || !payload.code.trim()) {
      throw new AppError('INVALID_ARGUMENT', 'code is required', 400);
    }
    sendSuccess(
      res,
      createStrategyScript({
        name,
        code: payload.code,
        source: payload.source === 'ai' ? 'ai' : 'manual',
        // 导入时保留「上次运行」信息（普通保存不带这两个字段）。
        ...(typeof payload.lastRunAt === 'number' ? { lastRunAt: payload.lastRunAt } : {}),
        ...(payload.lastSummary !== undefined ? { lastSummary: payload.lastSummary } : {}),
      })
    );
  })
);

backtestScriptsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const script = getStrategyScript(requireId(req.params.id));
    if (!script) throw new AppError('INVALID_ARGUMENT', `script ${req.params.id} not found`, 404);
    sendSuccess(res, script);
  })
);

backtestScriptsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    updateStrategyScript(requireId(req.params.id), {
      ...(payload.name !== undefined ? { name: String(payload.name) } : {}),
      ...(payload.code !== undefined ? { code: String(payload.code) } : {}),
    });
    sendSuccess(res, { items: listStrategyScripts() });
  })
);

/** 记录一次运行结果（页面显示「上次运行」）。 */
backtestScriptsRouter.post(
  '/:id/run',
  asyncHandler(async (req, res) => {
    recordScriptRun(requireId(req.params.id), body(req.body));
    sendSuccess(res, { items: listStrategyScripts() });
  })
);

backtestScriptsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    deleteStrategyScript(requireId(req.params.id));
    sendSuccess(res, { items: listStrategyScripts() });
  })
);
