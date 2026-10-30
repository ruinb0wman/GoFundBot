/**
 * 用户数据 CRUD（SQLite）。
 *
 * 表与字段对应 `frontend/src/db/index.ts` 的 Dexie 接口；HTTP 层返回 camelCase，
 * 前端 `db/*.ts` 模块只是加了薄封装，所以迁移后调用点无需改动。
 */
import { getDb, transaction } from '../db/index.js';
import { addStrategy, isStrategyDirConfigured, listStrategies, type StrategyInput } from './strategyStore.js';

export type { StrategyInput, StrategyRecord } from './strategyStore.js';

export interface PositionRecord {
  id: number;
  fundCode: string;
  fundName: string | null;
  purchaseDate: string | null;
  purchaseTime: string | null;
  shares: number;
  cost: number;
  createdAt: number;
}

export interface PositionInput {
  fundCode: string;
  fundName?: string | null;
  purchaseDate?: string | null;
  purchaseTime?: string | null;
  shares: number;
  cost: number;
}

export interface StrategyScriptRecord {
  id: number;
  name: string;
  code: string;
  source: 'manual' | 'ai';
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  lastSummary: unknown | null;
}

export interface StrategyScriptInput {
  name: string;
  code: string;
  source?: 'manual' | 'ai';
  /** 仅导入时使用：保留「上次运行」信息。 */
  lastRunAt?: number | null;
  lastSummary?: unknown;
}

export interface WatchlistItem {
  fundCode: string;
  fundName: string | null;
  fundType: string | null;
  groupId: number | null;
  sortOrder: number;
  addedAt: number;
}

export interface WatchlistGroup {
  id: number;
  name: string;
  sortOrder: number;
}

type Row = Record<string, unknown>;

const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' ? value : Number(value ?? fallback) || fallback);

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseJson(raw: unknown): unknown | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── positions ────────────────────────────────────────────────────────────────

function toPosition(row: Row): PositionRecord {
  return {
    id: num(row.id),
    fundCode: String(row.fund_code ?? ''),
    fundName: str(row.fund_name),
    purchaseDate: str(row.purchase_date),
    purchaseTime: str(row.purchase_time),
    shares: num(row.shares),
    cost: num(row.cost),
    createdAt: num(row.created_at),
  };
}

export function listPositions(): PositionRecord[] {
  return getDb().prepare('SELECT * FROM positions ORDER BY id ASC').all().map((row) => toPosition(row as Row));
}

export function addPosition(input: PositionInput): PositionRecord {
  const createdAt = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO positions (fund_code, fund_name, purchase_date, purchase_time, shares, cost, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(input.fundCode ?? '').trim(),
      input.fundName ?? null,
      input.purchaseDate ?? null,
      input.purchaseTime ?? null,
      num(input.shares),
      num(input.cost),
      createdAt
    );
  return { id: Number(info.lastInsertRowid), ...input, fundName: input.fundName ?? null, purchaseDate: input.purchaseDate ?? null, purchaseTime: input.purchaseTime ?? null, shares: num(input.shares), cost: num(input.cost), createdAt } as PositionRecord;
}

export function updatePosition(id: number, patch: Partial<PositionInput>): void {
  const current = getDb().prepare('SELECT * FROM positions WHERE id = ?').get(id) as Row | undefined;
  if (!current) return;
  const merged = { ...toPosition(current), ...patch };
  getDb()
    .prepare(
      `UPDATE positions SET fund_code = ?, fund_name = ?, purchase_date = ?, purchase_time = ?, shares = ?, cost = ?
       WHERE id = ?`
    )
    .run(
      String(merged.fundCode ?? ''),
      merged.fundName ?? null,
      merged.purchaseDate ?? null,
      merged.purchaseTime ?? null,
      num(merged.shares),
      num(merged.cost),
      id
    );
}

export function removePosition(id: number): void {
  getDb().prepare('DELETE FROM positions WHERE id = ?').run(id);
}

/** 整表替换（UI 在内存里改多行后回写）。 */
export function replaceAllPositions(rows: PositionInput[]): PositionRecord[] {
  return transaction((db) => {
    db.exec('DELETE FROM positions');
    for (const row of rows) addPosition(row);
    return db.prepare('SELECT * FROM positions ORDER BY id ASC').all().map((r) => toPosition(r as Row));
  });
}

// ── strategies ───────────────────────────────────────────────────────────────
//
// 策略记忆已从 SQLite `strategies` 表搬到「设置里那个 markdown 文件夹」
// （实现见 `strategyStore.ts`）。路由与 agent 工具仍然调这里的同名函数，签名不变。

export { addStrategy, listStrategies, removeStrategy, updateStrategy } from './strategyStore.js';

// ── backtest scripts ─────────────────────────────────────────────────────────

function toScript(row: Row): StrategyScriptRecord {
  return {
    id: num(row.id),
    name: String(row.name ?? ''),
    code: String(row.code ?? ''),
    source: (row.source === 'ai' ? 'ai' : 'manual') as StrategyScriptRecord['source'],
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
    lastRunAt: row.last_run_at === null || row.last_run_at === undefined ? null : num(row.last_run_at),
    lastSummary: parseJson(row.last_summary),
  };
}

export function listStrategyScripts(): StrategyScriptRecord[] {
  return getDb()
    .prepare('SELECT * FROM strategy_scripts ORDER BY updated_at DESC')
    .all()
    .map((row) => toScript(row as Row));
}

export function getStrategyScript(id: number): StrategyScriptRecord | null {
  const row = getDb().prepare('SELECT * FROM strategy_scripts WHERE id = ?').get(id) as Row | undefined;
  return row ? toScript(row) : null;
}

export function createStrategyScript(input: StrategyScriptInput): StrategyScriptRecord {
  const now = Date.now();
  const name = String(input.name ?? '').trim() || '未命名方案';
  const info = getDb()
    .prepare(
      `INSERT INTO strategy_scripts (name, code, source, created_at, updated_at, last_run_at, last_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      String(input.code ?? ''),
      input.source ?? 'manual',
      now,
      now,
      typeof input.lastRunAt === 'number' ? input.lastRunAt : null,
      input.lastSummary === undefined || input.lastSummary === null ? null : JSON.stringify(input.lastSummary)
    );
  return {
    id: Number(info.lastInsertRowid),
    name,
    code: String(input.code ?? ''),
    source: input.source ?? 'manual',
    createdAt: now,
    updatedAt: now,
    lastRunAt: typeof input.lastRunAt === 'number' ? input.lastRunAt : null,
    lastSummary: input.lastSummary ?? null,
  };
}

export function updateStrategyScript(id: number, patch: { name?: string; code?: string }): void {
  const current = getDb().prepare('SELECT * FROM strategy_scripts WHERE id = ?').get(id) as Row | undefined;
  if (!current) return;
  const before = toScript(current);
  getDb()
    .prepare('UPDATE strategy_scripts SET name = ?, code = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.name !== undefined ? String(patch.name).trim() || '未命名方案' : before.name,
      patch.code !== undefined ? String(patch.code) : before.code,
      Date.now(),
      id
    );
}

export function deleteStrategyScript(id: number): void {
  getDb().prepare('DELETE FROM strategy_scripts WHERE id = ?').run(id);
}

export function recordScriptRun(id: number, summary: unknown): void {
  const now = Date.now();
  getDb()
    .prepare('UPDATE strategy_scripts SET last_run_at = ?, last_summary = ?, updated_at = ? WHERE id = ?')
    .run(now, JSON.stringify(summary ?? null), now, id);
}

// ── watchlist ────────────────────────────────────────────────────────────────

function toWatchlistItem(row: Row): WatchlistItem {
  return {
    fundCode: String(row.fund_code ?? ''),
    fundName: str(row.fund_name),
    fundType: str(row.fund_type),
    groupId: row.group_id === null || row.group_id === undefined ? null : num(row.group_id),
    sortOrder: num(row.sort_order),
    addedAt: num(row.added_at),
  };
}

function toGroup(row: Row): WatchlistGroup {
  return { id: num(row.id), name: String(row.name ?? ''), sortOrder: num(row.sort_order) };
}

export function listWatchlist(): WatchlistItem[] {
  return getDb()
    .prepare('SELECT * FROM watchlist ORDER BY sort_order ASC, added_at ASC')
    .all()
    .map((row) => toWatchlistItem(row as Row));
}

export function listWatchlistGroups(): WatchlistGroup[] {
  return getDb()
    .prepare('SELECT * FROM watchlist_groups ORDER BY sort_order ASC')
    .all()
    .map((row) => toGroup(row as Row));
}

export function upsertWatchlistItem(item: WatchlistItem): WatchlistItem {
  getDb()
    .prepare(
      `INSERT INTO watchlist (fund_code, fund_name, fund_type, group_id, sort_order, added_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(fund_code) DO UPDATE SET
         fund_name = excluded.fund_name,
         fund_type = excluded.fund_type,
         group_id  = excluded.group_id,
         sort_order = excluded.sort_order`
    )
    .run(
      String(item.fundCode ?? '').trim(),
      item.fundName ?? null,
      item.fundType ?? null,
      item.groupId ?? null,
      num(item.sortOrder),
      num(item.addedAt, Date.now())
    );
  const row = getDb().prepare('SELECT * FROM watchlist WHERE fund_code = ?').get(item.fundCode) as Row;
  return toWatchlistItem(row);
}

export function removeWatchlistItems(codes: string[]): void {
  const statement = getDb().prepare('DELETE FROM watchlist WHERE fund_code = ?');
  transaction(() => {
    for (const code of codes) statement.run(code);
  });
}

/** 按给定顺序重排（index 即新的 sortOrder 基准）。 */
export function reorderWatchlist(codes: string[]): void {
  const statement = getDb().prepare('UPDATE watchlist SET sort_order = ? WHERE fund_code = ?');
  const now = Date.now();
  transaction(() => {
    codes.forEach((code, index) => statement.run(now + index, code));
  });
}

export function assignWatchlistGroup(codes: string[], groupId: number | null): void {
  const statement = getDb().prepare('UPDATE watchlist SET group_id = ? WHERE fund_code = ?');
  transaction(() => {
    for (const code of codes) statement.run(groupId, code);
  });
}

export function createWatchlistGroup(name: string): WatchlistGroup {
  const sortOrder = Date.now();
  const clean = String(name ?? '').trim() || '新分组';
  const info = getDb()
    .prepare('INSERT INTO watchlist_groups (name, sort_order) VALUES (?, ?)')
    .run(clean, sortOrder);
  return { id: Number(info.lastInsertRowid), name: clean, sortOrder };
}

export function renameWatchlistGroup(id: number, name: string): void {
  getDb()
    .prepare('UPDATE watchlist_groups SET name = ? WHERE id = ?')
    .run(String(name ?? '').trim() || '新分组', id);
}

/** 删除分组并把组内基金改为未分组。 */
export function deleteWatchlistGroup(id: number): void {
  transaction((db) => {
    db.prepare('UPDATE watchlist SET group_id = NULL WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM watchlist_groups WHERE id = ?').run(id);
  });
}

export function reorderWatchlistGroups(ids: number[]): void {
  const statement = getDb().prepare('UPDATE watchlist_groups SET sort_order = ? WHERE id = ?');
  const now = Date.now();
  transaction(() => {
    ids.forEach((id, index) => statement.run(now + index, id));
  });
}

// ── 一次性导入（Dexie → SQLite）───────────────────────────────────────────────

export interface UserDataDump {
  positions?: PositionInput[];
  strategies?: StrategyInput[];
  strategyScripts?: StrategyScriptInput[];
  watchlist?: WatchlistItem[];
  watchlistGroups?: WatchlistGroup[];
}

export interface ImportSummary {
  positions: number;
  strategies: number;
  strategyScripts: number;
  watchlist: number;
  watchlistGroups: number;
}

/**
 * 幂等导入：**仅当目标表为空**时才写入该表，因此重复调用不会产生重复数据。
 * 整个导入在事务里，失败回滚。
 */
export function importUserData(dump: UserDataDump): ImportSummary {
  return transaction((db) => {
    const summary: ImportSummary = {
      positions: 0,
      strategies: 0,
      strategyScripts: 0,
      watchlist: 0,
      watchlistGroups: 0,
    };

    const count = (table: string): number =>
      Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

    if (count('positions') === 0 && dump.positions?.length) {
      for (const row of dump.positions) summary.positions += addPosition(row) ? 1 : 0;
    }
    if (dump.strategies?.length && isStrategyDirConfigured() && listStrategies().length === 0) {
      for (const row of dump.strategies) summary.strategies += addStrategy(row) ? 1 : 0;
    }
    if (count('strategy_scripts') === 0 && dump.strategyScripts?.length) {
      for (const row of dump.strategyScripts) summary.strategyScripts += createStrategyScript(row) ? 1 : 0;
    }
    if (count('watchlist') === 0 && dump.watchlist?.length) {
      for (const row of dump.watchlist) {
        upsertWatchlistItem({ ...row, addedAt: row.addedAt ?? Date.now() });
        summary.watchlist += 1;
      }
    }
    if (count('watchlist_groups') === 0 && dump.watchlistGroups?.length) {
      for (const group of dump.watchlistGroups) {
        const created = createWatchlistGroup(group.name);
        summary.watchlistGroups += 1;
        // 保留原 id 以便 watchlist.groupId 仍指向同一分组。
        if (group.id !== created.id) {
          db.prepare('UPDATE watchlist SET group_id = ? WHERE group_id = ?').run(created.id, group.id);
        }
      }
    }

    return summary;
  });
}
