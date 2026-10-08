/**
 * 实时页（`/portfolio` 的「实时」标签）的组合数据 —— 组合基金、分组、基金↔分组映射、
 * 交易记录；持仓（share/cost/total_fee）由**已结算交易**推导，不落表。
 *
 * 原来是前端 Dexie 的 `portfolio` / `tradeRecords` 表；桩路由时期「改了不保存」。
 * 前端契约见 `frontend/src/services/portfolioApi.ts` 与 `composables/useFundRealtime*.ts`。
 */
import { getDb, transaction } from '../db/index.js';

export interface PortfolioFund {
  fund_code: string;
  fund_name: string | null;
  fund_type: string | null;
}

export interface PortfolioGroup {
  id: number;
  name: string;
  rebalance_enabled: number;
  rebalance_target: number | null;
  rebalance_upper: number | null;
  rebalance_lower: number | null;
}

export interface PortfolioTrade {
  id: number;
  fund_code: string;
  fund_name: string | null;
  type: string;
  trade_date: string | null;
  amount: number;
  share: number;
  nav: number;
  status: string;
  txn_id: string | null;
  settled_at: string | null;
  note: string | null;
  created_at: string;
}

export interface PortfolioHolding {
  share: number;
  cost: number;
  total_fee: number;
  buy_date: string;
  profit_nav_date: string;
}

type Row = Record<string, unknown>;

const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const nowIso = () => new Date().toISOString();

// ── 组合基金 ────────────────────────────────────────────────────────────────

function toFund(row: Row): PortfolioFund {
  return { fund_code: String(row.fund_code), fund_name: str(row.fund_name), fund_type: str(row.fund_type) };
}

export function listPortfolioFunds(): PortfolioFund[] {
  return getDb()
    .prepare('SELECT * FROM portfolio_funds ORDER BY sort_order ASC, added_at ASC')
    .all()
    .map((row) => toFund(row as Row));
}

export function addPortfolioFund(input: PortfolioFund): PortfolioFund {
  const code = String(input.fund_code ?? '').trim();
  const max = getDb().prepare('SELECT MAX(sort_order) AS m FROM portfolio_funds').get() as { m: number | null };
  getDb()
    .prepare(
      `INSERT INTO portfolio_funds (fund_code, fund_name, fund_type, sort_order, added_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(fund_code) DO UPDATE SET fund_name = excluded.fund_name, fund_type = excluded.fund_type`
    )
    .run(code, input.fund_name ?? null, input.fund_type ?? null, num(max?.m) + 1, Date.now());
  return listPortfolioFunds().find((fund) => fund.fund_code === code)!;
}

export function addPortfolioFunds(items: PortfolioFund[]): PortfolioFund[] {
  transaction(() => {
    for (const item of items) addPortfolioFund(item);
  });
  return listPortfolioFunds();
}

export function removePortfolioFund(code: string): PortfolioFund[] {
  transaction((db) => {
    db.prepare('DELETE FROM portfolio_funds WHERE fund_code = ?').run(code);
    db.prepare('DELETE FROM portfolio_fund_groups WHERE fund_code = ?').run(code);
  });
  return listPortfolioFunds();
}

export function reorderPortfolioFunds(codes: string[]): PortfolioFund[] {
  const statement = getDb().prepare('UPDATE portfolio_funds SET sort_order = ? WHERE fund_code = ?');
  transaction(() => {
    codes.forEach((code, index) => statement.run(index, code));
  });
  return listPortfolioFunds();
}

export function replaceAllPortfolioFunds(items: PortfolioFund[]): PortfolioFund[] {
  transaction((db) => {
    db.exec('DELETE FROM portfolio_funds');
    items.forEach((item, index) => {
      db.prepare(
        `INSERT INTO portfolio_funds (fund_code, fund_name, fund_type, sort_order, added_at) VALUES (?, ?, ?, ?, ?)`
      ).run(String(item.fund_code), item.fund_name ?? null, item.fund_type ?? null, index, Date.now());
    });
  });
  return listPortfolioFunds();
}

// ── 分组 ────────────────────────────────────────────────────────────────────

function toGroup(row: Row): PortfolioGroup {
  return {
    id: num(row.id),
    name: String(row.name ?? ''),
    rebalance_enabled: num(row.rebalance_enabled),
    rebalance_target: row.rebalance_target === null ? null : num(row.rebalance_target),
    rebalance_upper: row.rebalance_upper === null ? null : num(row.rebalance_upper),
    rebalance_lower: row.rebalance_lower === null ? null : num(row.rebalance_lower),
  };
}

export function listPortfolioGroups(): PortfolioGroup[] {
  return getDb()
    .prepare('SELECT * FROM portfolio_groups ORDER BY sort_order ASC, id ASC')
    .all()
    .map((row) => toGroup(row as Row));
}

export interface GroupInput {
  name: string;
  rebalance_enabled?: number | boolean | null;
  rebalance_target?: number | null;
  rebalance_upper?: number | null;
  rebalance_lower?: number | null;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createPortfolioGroup(input: GroupInput): PortfolioGroup {
  const max = getDb().prepare('SELECT MAX(sort_order) AS m FROM portfolio_groups').get() as { m: number | null };
  const info = getDb()
    .prepare(
      `INSERT INTO portfolio_groups (name, rebalance_enabled, rebalance_target, rebalance_upper, rebalance_lower, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(input.name ?? '').trim(),
      input.rebalance_enabled ? 1 : 0,
      nullableNum(input.rebalance_target),
      nullableNum(input.rebalance_upper),
      nullableNum(input.rebalance_lower),
      num(max?.m) + 1,
      Date.now()
    );
  const id = Number(info.lastInsertRowid);
  return listPortfolioGroups().find((group) => group.id === id)!;
}

export function updatePortfolioGroup(id: number, patch: Partial<GroupInput>): PortfolioGroup | null {
  const current = listPortfolioGroups().find((group) => group.id === id);
  if (!current) return null;
  getDb()
    .prepare(
      `UPDATE portfolio_groups
          SET name = ?, rebalance_enabled = ?, rebalance_target = ?, rebalance_upper = ?, rebalance_lower = ?
        WHERE id = ?`
    )
    .run(
      patch.name === undefined ? current.name : String(patch.name).trim(),
      (patch.rebalance_enabled === undefined ? current.rebalance_enabled : patch.rebalance_enabled ? 1 : 0),
      patch.rebalance_target === undefined ? current.rebalance_target : nullableNum(patch.rebalance_target),
      patch.rebalance_upper === undefined ? current.rebalance_upper : nullableNum(patch.rebalance_upper),
      patch.rebalance_lower === undefined ? current.rebalance_lower : nullableNum(patch.rebalance_lower),
      id
    );
  return listPortfolioGroups().find((group) => group.id === id)!;
}

/** 删分组时映射随外键级联删除（前端语义：组内基金回到默认状态）。 */
export function deletePortfolioGroup(id: number): PortfolioGroup[] {
  getDb().prepare('DELETE FROM portfolio_groups WHERE id = ?').run(id);
  return listPortfolioGroups();
}

// ── 基金 ↔ 分组 ─────────────────────────────────────────────────────────────

export function getPortfolioGroupMap(): Record<string, number> {
  const rows = getDb().prepare('SELECT fund_code, group_id FROM portfolio_fund_groups').all() as unknown as Row[];
  const map: Record<string, number> = {};
  for (const row of rows) map[String(row.fund_code)] = num(row.group_id);
  return map;
}

export function syncPortfolioGroupMap(mappings: { fund_code: string; group_id: number | string | null }[]): Record<string, number> {
  const database = getDb();
  transaction((db) => {
    db.exec('DELETE FROM portfolio_fund_groups');
    const insert = db.prepare('INSERT OR REPLACE INTO portfolio_fund_groups (fund_code, group_id) VALUES (?, ?)');
    for (const item of mappings) {
      const groupId = nullableNum(item.group_id);
      if (groupId === null || !item.fund_code) continue;
      insert.run(String(item.fund_code), groupId);
    }
  });
  return getPortfolioGroupMap();
}

// ── 交易记录 ────────────────────────────────────────────────────────────────

function toTrade(row: Row): PortfolioTrade {
  return {
    id: num(row.id),
    fund_code: String(row.fund_code),
    fund_name: str(row.fund_name),
    type: String(row.type),
    trade_date: str(row.trade_date),
    amount: num(row.amount),
    share: num(row.share),
    nav: num(row.nav),
    status: String(row.status ?? 'settled'),
    txn_id: str(row.txn_id),
    settled_at: str(row.settled_at),
    note: str(row.note),
    created_at: String(row.created_at ?? ''),
  };
}

export function listPortfolioTrades(fundCode?: string): PortfolioTrade[] {
  const database = getDb();
  const rows = fundCode
    ? database.prepare('SELECT * FROM portfolio_trades WHERE fund_code = ? ORDER BY id DESC').all(fundCode)
    : database.prepare('SELECT * FROM portfolio_trades ORDER BY id DESC').all();
  return (rows as unknown as Row[]).map(toTrade);
}

export interface TradeInput {
  fund_code: string;
  fund_name?: string | null;
  type: string;
  trade_date?: string | null;
  amount?: number;
  share?: number;
  nav?: number;
  status?: string;
  txn_id?: string | null;
  settled_at?: string | null;
  note?: string | null;
}

export function addPortfolioTrade(input: TradeInput): PortfolioTrade {
  const info = getDb()
    .prepare(
      `INSERT INTO portfolio_trades
         (fund_code, fund_name, type, trade_date, amount, share, nav, status, txn_id, settled_at, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(input.fund_code ?? '').trim(),
      input.fund_name ?? null,
      String(input.type ?? 'buy'),
      input.trade_date ?? null,
      num(input.amount),
      num(input.share),
      num(input.nav),
      input.status ?? 'settled',
      input.txn_id ?? null,
      input.settled_at ?? null,
      input.note ?? null,
      nowIso()
    );
  const id = Number(info.lastInsertRowid);
  return listPortfolioTrades().find((trade) => trade.id === id)!;
}

export function updatePortfolioTrade(id: number, patch: Partial<TradeInput>): void {
  const current = listPortfolioTrades().find((trade) => trade.id === id);
  if (!current) return;
  getDb()
    .prepare(
      `UPDATE portfolio_trades SET status = ?, settled_at = ?, note = ?, trade_date = ?, amount = ?, share = ?, nav = ? WHERE id = ?`
    )
    .run(
      patch.status === undefined ? current.status : String(patch.status),
      patch.settled_at === undefined ? current.settled_at : str(patch.settled_at),
      patch.note === undefined ? current.note : str(patch.note),
      patch.trade_date === undefined ? current.trade_date : str(patch.trade_date),
      patch.amount === undefined ? current.amount : num(patch.amount),
      patch.share === undefined ? current.share : num(patch.share),
      patch.nav === undefined ? current.nav : num(patch.nav),
      id
    );
}

export function deletePortfolioTrade(id: number): void {
  getDb().prepare('DELETE FROM portfolio_trades WHERE id = ?').run(id);
}

export function deletePortfolioTradeByTxn(txnId: string): void {
  getDb().prepare('DELETE FROM portfolio_trades WHERE txn_id = ?').run(txnId);
}

export function settlePortfolioTrades(txnIds: string[]): void {
  const statement = getDb().prepare(`UPDATE portfolio_trades SET status = 'settled', settled_at = ? WHERE txn_id = ?`);
  const at = nowIso();
  transaction(() => {
    for (const txnId of txnIds) statement.run(at, txnId);
  });
}

export function clearPortfolioTrades(): void {
  getDb().exec('DELETE FROM portfolio_trades');
}

// ── 持仓（由已结算交易推导）──────────────────────────────────────────────────

/**
 * 与前端 `useFundRealtimeTrade.settleTrade` 同款口径：
 * 买入按金额加权平均成本；卖出减份额，清零即整只消失；分红再投加份额；手续费累计 `total_fee`。
 * 显式持仓（`portfolio_holdings`，只有导入恢复才会写）只在该基金**没有**已结算交易时兜底。
 */
export function getHoldings(): Record<string, PortfolioHolding> {
  const rows = getDb()
    .prepare(`SELECT * FROM portfolio_trades WHERE status = 'settled' ORDER BY trade_date ASC, id ASC`)
    .all() as unknown as Row[];
  const out: Record<string, PortfolioHolding> = {};
  for (const row of rows) {
    const code = String(row.fund_code);
    const type = String(row.type);
    const share = num(row.share);
    const amount = num(row.amount);
    const tradeDate = str(row.trade_date) ?? '';
    const holding: PortfolioHolding = out[code] ?? {
      share: 0,
      cost: 0,
      total_fee: 0,
      buy_date: '',
      profit_nav_date: '',
    };
    if (type === 'buy') {
      const totalShares = holding.share + share;
      holding.cost = holding.share > 0 && totalShares > 0 ? (holding.share * holding.cost + amount) / totalShares : num(row.nav);
      holding.share = totalShares;
      if (!holding.buy_date) holding.buy_date = tradeDate;
    } else if (type === 'sell') {
      holding.share -= share;
      if (holding.share <= 0.01) {
        delete out[code];
        continue;
      }
    } else if (type === 'dividend') {
      holding.share += share;
    } else if (type === 'fee') {
      holding.total_fee += amount;
    }
    if (!holding.profit_nav_date) holding.profit_nav_date = tradeDate;
    out[code] = holding;
  }

  const explicit = getDb().prepare('SELECT * FROM portfolio_holdings').all() as unknown as Row[];
  for (const row of explicit) {
    const code = String(row.fund_code);
    if (out[code]) continue;
    out[code] = {
      share: num(row.share),
      cost: num(row.cost),
      total_fee: num(row.total_fee),
      buy_date: str(row.buy_date) ?? '',
      profit_nav_date: str(row.profit_nav_date) ?? '',
    };
  }
  return out;
}

// ── 导入恢复 ────────────────────────────────────────────────────────────────

/** 前端「导入数据」的 JSON（funds / fundOrder / portfolioGroups / fundGroupMap / holdings）。 */
export function migratePortfolio(payload: Record<string, unknown>): Record<string, unknown> {
  const fundsRaw = Array.isArray(payload.funds) ? (payload.funds as Row[]) : [];
  const order = Array.isArray(payload.fundOrder) ? (payload.fundOrder as unknown[]).map(String) : [];
  const groups = Array.isArray(payload.portfolioGroups) ? (payload.portfolioGroups as Row[]) : [];
  const map = payload.fundGroupMap && typeof payload.fundGroupMap === 'object' ? (payload.fundGroupMap as Row) : {};
  const holdings = payload.holdings && typeof payload.holdings === 'object' ? (payload.holdings as Row) : {};

  const funds: PortfolioFund[] = fundsRaw
    .map((row) => ({
      fund_code: String(row.fund_code ?? row.code ?? ''),
      fund_name: str(row.fund_name ?? row.name),
      fund_type: str(row.fund_type ?? row.type),
    }))
    .filter((fund) => fund.fund_code);
  const ordered = [...funds].sort((a, b) => {
    const ai = order.indexOf(a.fund_code);
    const bi = order.indexOf(b.fund_code);
    return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
  });
  replaceAllPortfolioFunds(ordered);

  const idMap = new Map<string, number>();
  transaction((db) => {
    db.exec('DELETE FROM portfolio_groups; DELETE FROM portfolio_fund_groups');
  });
  for (const row of groups) {
    const created = createPortfolioGroup({
      name: String(row.name ?? ''),
      rebalance_enabled: num(row.rebalance_enabled),
      rebalance_target: nullableNum(row.rebalance_target),
      rebalance_upper: nullableNum(row.rebalance_upper),
      rebalance_lower: nullableNum(row.rebalance_lower),
    });
    if (row.id !== null && row.id !== undefined) idMap.set(String(row.id), created.id);
  }
  syncPortfolioGroupMap(
    Object.entries(map).map(([code, groupId]) => ({
      fund_code: code,
      group_id: groupId === null || groupId === undefined ? null : idMap.get(String(groupId)) ?? null,
    }))
  );

  let holdingCount = 0;
  transaction((db) => {
    db.exec('DELETE FROM portfolio_holdings');
    const insert = db.prepare(
      `INSERT OR REPLACE INTO portfolio_holdings (fund_code, share, cost, total_fee, buy_date, profit_nav_date)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const [code, raw] of Object.entries(holdings)) {
      const value = (raw ?? {}) as Row;
      if (!num(value.share)) continue;
      insert.run(
        code,
        num(value.share),
        num(value.cost),
        num(value.total_fee),
        str(value.buy_date),
        str(value.profit_nav_date)
      );
      holdingCount += 1;
    }
  });

  return {
    restored: {
      funds: ordered.length,
      groups: groups.length,
      mappings: Object.keys(getPortfolioGroupMap()).length,
      holdings: holdingCount,
    },
  };
}
