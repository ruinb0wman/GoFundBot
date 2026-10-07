import { Router } from 'express';
import { AppError, asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import {
  addPosition,
  listPositions,
  removePosition,
  replaceAllPositions,
  updatePosition,
  type PositionInput,
} from '../services/userDataService.js';

/** 持仓（SQLite；`userData.routes.ts` 的桩曾被前端绕过）。 */
export const positionsRouter = Router();

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

function toInput(payload: Record<string, unknown>): PositionInput {
  const fundCode = String(payload.fundCode ?? '').trim();
  if (!fundCode) throw new AppError('INVALID_ARGUMENT', 'fundCode is required', 400);
  return {
    fundCode,
    fundName: payload.fundName === undefined ? null : (payload.fundName as string | null),
    purchaseDate: payload.purchaseDate === undefined ? null : (payload.purchaseDate as string | null),
    purchaseTime: payload.purchaseTime === undefined ? null : (payload.purchaseTime as string | null),
    shares: Number(payload.shares ?? 0) || 0,
    cost: Number(payload.cost ?? 0) || 0,
  };
}

positionsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { items: listPositions() });
  })
);

positionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    sendSuccess(res, addPosition(toInput(body(req.body))));
  })
);

/** 整表替换：UI 在内存里改多行后一次性回写。 */
positionsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const { items } = body(req.body);
    if (!Array.isArray(items)) throw new AppError('INVALID_ARGUMENT', 'items must be an array', 400);
    sendSuccess(res, { items: replaceAllPositions(items.map((row) => toInput(body(row)))) });
  })
);

positionsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    updatePosition(requireId(req.params.id), {
      ...(payload.fundCode !== undefined ? { fundCode: String(payload.fundCode) } : {}),
      ...(payload.fundName !== undefined ? { fundName: payload.fundName as string | null } : {}),
      ...(payload.purchaseDate !== undefined ? { purchaseDate: payload.purchaseDate as string | null } : {}),
      ...(payload.purchaseTime !== undefined ? { purchaseTime: payload.purchaseTime as string | null } : {}),
      ...(payload.shares !== undefined ? { shares: Number(payload.shares) || 0 } : {}),
      ...(payload.cost !== undefined ? { cost: Number(payload.cost) || 0 } : {}),
    });
    sendSuccess(res, { items: listPositions() });
  })
);

positionsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    removePosition(requireId(req.params.id));
    sendSuccess(res, { items: listPositions() });
  })
);
