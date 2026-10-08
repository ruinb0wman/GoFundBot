import { Router } from 'express';
import { AppError, asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import {
  DEFAULT_ANOMALY_CONFIG,
  checkAlerts,
  createAlert,
  detectMarketAnomalies,
  getAnomalyConfig,
  listAlerts,
  removeAlert,
  saveAnomalyConfig,
  updateAlert,
  type AnomalyConfig,
} from '../services/alertService.js';

/** 告警规则与市场异动（SQLite，迁移 005；原来是「写入不落库」的桩）。 */
export const alertRouter = Router();

function body(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AppError('INVALID_ARGUMENT', 'body must be an object', 400);
  }
  return raw as Record<string, unknown>;
}

function requireId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('INVALID_ARGUMENT', 'invalid id', 400, { id: value });
  return id;
}

alertRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, listAlerts());
  })
);

alertRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    const fundCode = String(payload.fund_code ?? '').trim();
    if (!fundCode) throw new AppError('INVALID_ARGUMENT', 'fund_code is required', 400);
    sendSuccess(
      res,
      createAlert({
        fund_code: fundCode,
        fund_name: payload.fund_name === undefined ? null : String(payload.fund_name),
        alert_type: String(payload.alert_type ?? ''),
        threshold: Number(payload.threshold ?? 0),
      })
    );
  })
);

alertRouter.get(
  '/check',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, await checkAlerts());
  })
);

alertRouter.get(
  '/market-anomaly',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, await detectMarketAnomalies());
  })
);

alertRouter.get(
  '/anomaly-config',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, getAnomalyConfig());
  })
);

alertRouter.get(
  '/anomaly-config/defaults',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, DEFAULT_ANOMALY_CONFIG);
  })
);

alertRouter.put(
  '/anomaly-config',
  asyncHandler(async (req, res) => {
    sendSuccess(res, saveAnomalyConfig(body(req.body) as Partial<AnomalyConfig>));
  })
);

alertRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const patch = body(req.body);
    const updated = updateAlert(requireId(req.params.id), {
      threshold: patch.threshold === undefined ? undefined : Number(patch.threshold),
      enabled: patch.enabled === undefined ? undefined : Number(patch.enabled) ? 1 : 0,
    });
    if (!updated) throw new AppError('NOT_FOUND', 'alert not found', 404, { id: req.params.id });
    sendSuccess(res, updated);
  })
);

alertRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    removeAlert(requireId(req.params.id));
    sendSuccess(res, listAlerts());
  })
);
