import { Router } from 'express';
import { AppError, asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import {
  addPortfolioFund,
  addPortfolioFunds,
  addPortfolioTrade,
  clearPortfolioTrades,
  createPortfolioGroup,
  deletePortfolioGroup,
  deletePortfolioTrade,
  deletePortfolioTradeByTxn,
  getHoldings,
  getPortfolioGroupMap,
  listPortfolioFunds,
  listPortfolioGroups,
  listPortfolioTrades,
  migratePortfolio,
  removePortfolioFund,
  reorderPortfolioFunds,
  replaceAllPortfolioFunds,
  settlePortfolioTrades,
  syncPortfolioGroupMap,
  updatePortfolioGroup,
  updatePortfolioTrade,
  type PortfolioFund,
} from '../services/portfolioService.js';

/** 实时页的组合数据（SQLite，迁移 006）。契约见前端 `services/portfolioApi.ts`。 */
export const portfolioRouter = Router();

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

function requireId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('INVALID_ARGUMENT', 'invalid id', 400, { id: value });
  return id;
}

function toFund(raw: unknown): PortfolioFund {
  const row = body(raw);
  return {
    fund_code: requireCode(row.fund_code ?? row.code),
    fund_name: row.fund_name === undefined ? null : String(row.fund_name),
    fund_type: row.fund_type === undefined ? null : String(row.fund_type),
  };
}

// ── 组合基金 ────────────────────────────────────────────────────────────────

portfolioRouter.get(
  '/funds',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, listPortfolioFunds());
  })
);

portfolioRouter.post(
  '/funds/batch',
  asyncHandler(async (req, res) => {
    const { funds } = body(req.body);
    if (!Array.isArray(funds)) throw new AppError('INVALID_ARGUMENT', 'funds must be an array', 400);
    sendSuccess(res, addPortfolioFunds(funds.map(toFund)));
  })
);

portfolioRouter.put(
  '/funds/reorder',
  asyncHandler(async (req, res) => {
    const { fund_codes: codes } = body(req.body);
    if (!Array.isArray(codes)) throw new AppError('INVALID_ARGUMENT', 'fund_codes must be an array', 400);
    sendSuccess(res, reorderPortfolioFunds(codes.map((code) => String(code))));
  })
);

portfolioRouter.put(
  '/funds/all',
  asyncHandler(async (req, res) => {
    const { funds } = body(req.body);
    if (!Array.isArray(funds)) throw new AppError('INVALID_ARGUMENT', 'funds must be an array', 400);
    sendSuccess(res, replaceAllPortfolioFunds(funds.map(toFund)));
  })
);

portfolioRouter.post(
  '/funds',
  asyncHandler(async (req, res) => {
    sendSuccess(res, addPortfolioFund(toFund(req.body)));
  })
);

portfolioRouter.delete(
  '/funds/:code',
  asyncHandler(async (req, res) => {
    sendSuccess(res, removePortfolioFund(requireCode(req.params.code)));
  })
);

// ── 持仓（由交易推导）────────────────────────────────────────────────────────

portfolioRouter.get(
  '/holdings',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, getHoldings());
  })
);

// ── 交易记录 ────────────────────────────────────────────────────────────────

portfolioRouter.get(
  '/trades',
  asyncHandler(async (req, res) => {
    const code = typeof req.query.fund_code === 'string' && req.query.fund_code ? req.query.fund_code : undefined;
    sendSuccess(res, listPortfolioTrades(code));
  })
);

portfolioRouter.post(
  '/trades/batch-settle',
  asyncHandler(async (req, res) => {
    const { txn_ids: txnIds } = body(req.body);
    if (!Array.isArray(txnIds)) throw new AppError('INVALID_ARGUMENT', 'txn_ids must be an array', 400);
    settlePortfolioTrades(txnIds.map((id) => String(id)));
    sendSuccess(res, listPortfolioTrades());
  })
);

portfolioRouter.delete(
  '/trades/pending/:txnId',
  asyncHandler(async (req, res) => {
    deletePortfolioTradeByTxn(String(req.params.txnId));
    sendSuccess(res, listPortfolioTrades());
  })
);

portfolioRouter.delete(
  '/trades',
  asyncHandler(async (_req, res) => {
    clearPortfolioTrades();
    sendSuccess(res, listPortfolioTrades());
  })
);

portfolioRouter.post(
  '/trades',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    sendSuccess(
      res,
      addPortfolioTrade({
        fund_code: requireCode(payload.fund_code),
        fund_name: payload.fund_name === undefined ? null : String(payload.fund_name),
        type: String(payload.type ?? 'buy'),
        trade_date: payload.trade_date === undefined ? null : String(payload.trade_date),
        amount: Number(payload.amount ?? 0),
        share: Number(payload.share ?? 0),
        nav: Number(payload.nav ?? 0),
        status: payload.status === undefined ? 'settled' : String(payload.status),
        txn_id: payload.txn_id === undefined ? null : String(payload.txn_id),
        settled_at: payload.settled_at === undefined ? null : String(payload.settled_at),
        note: payload.note === undefined ? null : String(payload.note),
      })
    );
  })
);

portfolioRouter.put(
  '/trades/:id',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    updatePortfolioTrade(requireId(req.params.id), {
      status: payload.status === undefined ? undefined : String(payload.status),
      settled_at: payload.settled_at === undefined ? undefined : String(payload.settled_at),
      note: payload.note === undefined ? undefined : String(payload.note),
    });
    sendSuccess(res, listPortfolioTrades());
  })
);

portfolioRouter.delete(
  '/trades/:id',
  asyncHandler(async (req, res) => {
    deletePortfolioTrade(requireId(req.params.id));
    sendSuccess(res, listPortfolioTrades());
  })
);

// ── 分组 ────────────────────────────────────────────────────────────────────

portfolioRouter.get(
  '/groups',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, listPortfolioGroups());
  })
);

portfolioRouter.post(
  '/groups',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    sendSuccess(
      res,
      createPortfolioGroup({
        name: String(payload.name ?? ''),
        rebalance_enabled: payload.rebalance_enabled === undefined ? 0 : Number(payload.rebalance_enabled),
        rebalance_target: payload.rebalance_target === undefined ? null : Number(payload.rebalance_target),
        rebalance_upper: payload.rebalance_upper === undefined ? null : Number(payload.rebalance_upper),
        rebalance_lower: payload.rebalance_lower === undefined ? null : Number(payload.rebalance_lower),
      })
    );
  })
);

portfolioRouter.put(
  '/groups/:id',
  asyncHandler(async (req, res) => {
    const payload = body(req.body);
    const updated = updatePortfolioGroup(requireId(req.params.id), {
      name: payload.name === undefined ? undefined : String(payload.name),
      rebalance_enabled: payload.rebalance_enabled === undefined ? undefined : Number(payload.rebalance_enabled),
      rebalance_target: payload.rebalance_target === undefined ? undefined : Number(payload.rebalance_target),
      rebalance_upper: payload.rebalance_upper === undefined ? undefined : Number(payload.rebalance_upper),
      rebalance_lower: payload.rebalance_lower === undefined ? undefined : Number(payload.rebalance_lower),
    });
    if (!updated) throw new AppError('NOT_FOUND', 'group not found', 404, { id: req.params.id });
    sendSuccess(res, updated);
  })
);

portfolioRouter.delete(
  '/groups/:id',
  asyncHandler(async (req, res) => {
    sendSuccess(res, deletePortfolioGroup(requireId(req.params.id)));
  })
);

// ── 基金 ↔ 分组 ─────────────────────────────────────────────────────────────

portfolioRouter.get(
  '/fund-group-map',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, getPortfolioGroupMap());
  })
);

portfolioRouter.put(
  '/fund-group-map',
  asyncHandler(async (req, res) => {
    const { mappings } = body(req.body);
    if (!Array.isArray(mappings)) throw new AppError('INVALID_ARGUMENT', 'mappings must be an array', 400);
    sendSuccess(
      res,
      syncPortfolioGroupMap(
        mappings.map((raw) => {
          const row = body(raw);
          return { fund_code: requireCode(row.fund_code), group_id: row.group_id as number | string | null };
        })
      )
    );
  })
);

// ── 导入恢复 ────────────────────────────────────────────────────────────────

portfolioRouter.post(
  '/migrate',
  asyncHandler(async (req, res) => {
    sendSuccess(res, migratePortfolio(body(req.body)));
  })
);
