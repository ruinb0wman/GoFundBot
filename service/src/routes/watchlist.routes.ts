import { Router } from 'express';
import { AppError, asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import {
  assignWatchlistGroup,
  createWatchlistGroup,
  deleteWatchlistGroup,
  listWatchlist,
  listWatchlistGroups,
  removeWatchlistItems,
  renameWatchlistGroup,
  reorderWatchlist,
  reorderWatchlistGroups,
  upsertWatchlistItem,
  type WatchlistItem,
} from '../services/userDataService.js';

/** 自选列表与分组（SQLite）。 */
export const watchlistRouter = Router();

function body(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AppError('INVALID_ARGUMENT', 'body must be an object', 400);
  }
  return raw as Record<string, unknown>;
}

function requireCode(value: unknown): string {
  const code = String(value ?? '').trim();
  if (!code) throw new AppError('INVALID_ARGUMENT', 'fund code is required', 400);
  return code;
}

function requireCodes(value: unknown): string[] {
  if (!Array.isArray(value)) throw new AppError('INVALID_ARGUMENT', 'codes must be an array', 400);
  return value.map(requireCode);
}

function requireNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AppError('INVALID_ARGUMENT', `${field} must be a number`, 400, { [field]: value });
  }
  return parsed;
}

// ── 分组（先注册，避免被 /:code 吞掉）────────────────────────────────────────

watchlistRouter.get(
  '/groups',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, listWatchlistGroups());
  })
);

watchlistRouter.post(
  '/groups',
  asyncHandler(async (req, res) => {
    const { name } = body(req.body);
    sendSuccess(res, createWatchlistGroup(String(name ?? '')));
  })
);

watchlistRouter.put(
  '/groups/reorder',
  asyncHandler(async (req, res) => {
    const { ids } = body(req.body);
    if (!Array.isArray(ids)) throw new AppError('INVALID_ARGUMENT', 'ids must be an array', 400);
    reorderWatchlistGroups(ids.map((id) => requireNumber(id, 'id')));
    sendSuccess(res, listWatchlistGroups());
  })
);

watchlistRouter.put(
  '/groups/:id',
  asyncHandler(async (req, res) => {
    const { name } = body(req.body);
    renameWatchlistGroup(requireNumber(req.params.id, 'id'), String(name ?? ''));
    sendSuccess(res, listWatchlistGroups());
  })
);

watchlistRouter.delete(
  '/groups/:id',
  asyncHandler(async (req, res) => {
    deleteWatchlistGroup(requireNumber(req.params.id, 'id'));
    sendSuccess(res, { items: listWatchlist(), groups: listWatchlistGroups() });
  })
);

// ── 列表 ─────────────────────────────────────────────────────────────────────

watchlistRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { items: listWatchlist(), groups: listWatchlistGroups() });
  })
);

watchlistRouter.post(
  '/batch-delete',
  asyncHandler(async (req, res) => {
    const { codes } = body(req.body);
    removeWatchlistItems(requireCodes(codes));
    sendSuccess(res, { items: listWatchlist(), groups: listWatchlistGroups() });
  })
);

watchlistRouter.put(
  '/reorder',
  asyncHandler(async (req, res) => {
    const { codes } = body(req.body);
    reorderWatchlist(requireCodes(codes));
    sendSuccess(res, listWatchlist());
  })
);

watchlistRouter.put(
  '/:code/group',
  asyncHandler(async (req, res) => {
    const { groupId } = body(req.body);
    const resolved = groupId === null || groupId === undefined ? null : requireNumber(groupId, 'groupId');
    assignWatchlistGroup([requireCode(req.params.code)], resolved);
    sendSuccess(res, listWatchlist());
  })
);

watchlistRouter.put(
  '/:code',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    const item: WatchlistItem = {
      fundCode: requireCode(req.params.code),
      fundName: payload.fundName === undefined ? null : String(payload.fundName),
      fundType: payload.fundType === undefined ? null : String(payload.fundType),
      groupId: payload.groupId === null || payload.groupId === undefined ? null : requireNumber(payload.groupId, 'groupId'),
      sortOrder: payload.sortOrder === undefined ? Date.now() : requireNumber(payload.sortOrder, 'sortOrder'),
      addedAt: payload.addedAt === undefined ? Date.now() : requireNumber(payload.addedAt, 'addedAt'),
    };
    sendSuccess(res, upsertWatchlistItem(item));
  })
);

watchlistRouter.delete(
  '/:code',
  asyncHandler(async (req, res) => {
    removeWatchlistItems([requireCode(req.params.code)]);
    sendSuccess(res, { items: listWatchlist(), groups: listWatchlistGroups() });
  })
);
