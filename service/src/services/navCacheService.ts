/**
 * 净值缓存（SQLite）—— 读/写/覆盖度判断，**不取数**（取数在 `fundService` 的 provider 链里，
 * 避免循环依赖）。
 *
 * 迁移前这套逻辑在前端（`frontend/src/db/navCache.ts` + `services/backtest/dataBroker.ts`，
 * Dexie + 覆盖度判断）。搬到 service 的好处：service 重启不丢、pi 的回测与页面共用同一份、
 * 前端不用再自己判断「要不要重新拉」。
 *
 * 只存 `date`/`nav`/`acc_nav` —— `timestamp`/`dailyReturn`/`unitMoney` 没有任何消费方。
 */
import type { DatabaseSync } from 'node:sqlite';
import { getDb, transaction } from '../db/index.js';
import type { FundNavPointDto } from '../types/fund.js';

export const NAV_TTL_MS = 24 * 60 * 60 * 1000;

/** 保留窗口（天）：写入时裁掉更老的点位。回测默认窗口 3 年，10 年足够覆盖。 */
export const NAV_RETENTION_DAYS = 3650;
/** 全局上限（行数）：超出时按 `fetched_at` 淘汰**整只**基金（LRU）。 */
export const NAV_MAX_POINTS = 3_000_000;

// 可用环境变量覆盖（运维/测试）；默认值即上面两个常量。
function retentionDays(): number {
  const raw = Number(process.env.GOFUND_NAV_RETENTION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : NAV_RETENTION_DAYS;
}

function maxPoints(): number {
  const raw = Number(process.env.GOFUND_NAV_MAX_POINTS);
  return Number.isFinite(raw) && raw > 0 ? raw : NAV_MAX_POINTS;
}

// 进程内计数（`/api/health` 可观测）。
let trimmedPoints = 0;
let evictedFunds = 0;

function retentionCutoff(now = Date.now()): string {
  return new Date(now - retentionDays() * 86_400_000).toISOString().slice(0, 10);
}

function countNavPoints(database: DatabaseSync): number {
  const row = database.prepare('SELECT COUNT(*) AS n FROM nav_history').get() as { n: number };
  return Number(row?.n ?? 0);
}

/**
 * 全局上限：超过 `NAV_MAX_POINTS` 时从最久未使用的基金开始整只删（`fetched_at` 升序）。
 * `protectCode` 是刚写入的那只，不会被自己淘汰掉。
 */
function enforceNavCap(database: DatabaseSync, protectCode: string): void {
  let total = countNavPoints(database);
  if (total <= maxPoints()) return;
  const funds = database
    .prepare(
      `SELECT m.fund_code AS code, COALESCE(c.n, 0) AS n
         FROM nav_history_meta m
         LEFT JOIN (SELECT fund_code, COUNT(*) AS n FROM nav_history GROUP BY fund_code) c
           ON c.fund_code = m.fund_code
        ORDER BY m.fetched_at ASC, m.fund_code ASC`
    )
    .all() as unknown as { code: string; n: number }[];
  for (const fund of funds) {
    if (total <= maxPoints()) break;
    if (fund.code === protectCode && funds.length > 1) continue;
    database.prepare('DELETE FROM nav_history WHERE fund_code = ?').run(fund.code);
    database.prepare('DELETE FROM nav_history_meta WHERE fund_code = ?').run(fund.code);
    total -= Number(fund.n ?? 0);
    evictedFunds += 1;
  }
}

export interface NavCacheMeta {
  code: string;
  name: string | null;
  firstDate: string;
  lastDate: string;
  fetchedThrough: string;
  updatedAt: number;
}

export interface NavWindow {
  startDate?: string;
  endDate?: string;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getNavMeta(code: string): NavCacheMeta | null {
  const row = getDb()
    .prepare(
      `SELECT fund_code, name, first_date, last_date, fetched_through, fetched_at FROM nav_history_meta WHERE fund_code = ?`
    )
    .get(code) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    code: String(row.fund_code),
    name: (row.name as string | null) ?? null,
    firstDate: (row.first_date as string) ?? '',
    lastDate: (row.last_date as string) ?? '',
    fetchedThrough: (row.fetched_through as string) ?? '',
    updatedAt: Number(row.fetched_at ?? 0),
  };
}

/** 缓存能否回答这个窗口（语义与前端 `dataBroker.isFresh` 一致）。 */
export function isCovered(meta: NavCacheMeta, range: NavWindow = {}, today = todayStr()): boolean {
  const end = range.endDate && range.endDate < today ? range.endDate : today;
  // 没有 fetchedThrough（老记录）当过期处理。
  if (!meta.fetchedThrough || meta.fetchedThrough < end) return false;
  // 窗口整体在过去 → 数据永远不会再变。
  if (range.endDate && range.endDate < meta.fetchedThrough) return true;
  return Date.now() - meta.updatedAt < NAV_TTL_MS;
}

export function readNavItems(code: string, range: NavWindow = {}): FundNavPointDto[] {
  const rows = getDb()
    .prepare(
      `SELECT date, nav, acc_nav FROM nav_history
        WHERE fund_code = ? AND date >= ? AND date <= ?
        ORDER BY date`
    )
    .all(code, range.startDate ?? '', range.endDate ?? '9999-12-31') as unknown as {
    date: string;
    nav: number;
    acc_nav: number | null;
  }[];

  return rows.map((row) => ({
    date: row.date,
    timestamp: null,
    nav: row.nav,
    accNav: row.acc_nav ?? null,
    dailyReturn: null,
    unitMoney: '元',
  }));
}

/**
 * 合并写入（按日期 upsert），并更新覆盖度。
 * `fetchedThrough` 取「这次取到哪天」，只前进不后退。
 */
export function saveNav(
  code: string,
  items: FundNavPointDto[],
  options: { fetchedThrough?: string; name?: string | null } = {}
): NavCacheMeta {
  const fetchedThrough = options.fetchedThrough ?? todayStr();
  const points = items
    .filter((item) => item.date && Number.isFinite(item.nav))
    // provider 的 date 可能带时间（`2026-10-06T00:00:00`），统一截成 YYYY-MM-DD。
    .map((item) => ({ date: item.date.slice(0, 10), nav: item.nav, accNav: item.accNav ?? null }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const database = getDb();
  transaction((db) => {
    if (points.length > 0) {
      const upsert = db.prepare(
        `INSERT INTO nav_history (fund_code, date, nav, acc_nav) VALUES (?, ?, ?, ?)
         ON CONFLICT(fund_code, date) DO UPDATE SET nav = excluded.nav, acc_nav = excluded.acc_nav`
      );
      for (const point of points) upsert.run(code, point.date, point.nav, point.accNav);
    }

    // 保留窗口：裁掉太老的点位，避免全市场缓存无界增长。
    const deleted = db
      .prepare('DELETE FROM nav_history WHERE fund_code = ? AND date < ?')
      .run(code, retentionCutoff());
    trimmedPoints += Number(deleted.changes ?? 0);

    // 边界从表里重算：保证 meta 与裁掉之后的数据一致（不能只取本次写入的首尾）。
    const bounds = db
      .prepare('SELECT MIN(date) AS first_date, MAX(date) AS last_date FROM nav_history WHERE fund_code = ?')
      .get(code) as { first_date: string | null; last_date: string | null };
    const previous = getNavMeta(code);
    const through = [previous?.fetchedThrough ?? '', fetchedThrough].sort().pop() ?? fetchedThrough;

    db.prepare(
      `INSERT INTO nav_history_meta (fund_code, name, first_date, last_date, fetched_through, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(fund_code) DO UPDATE SET
         name = COALESCE(excluded.name, nav_history_meta.name),
         first_date = excluded.first_date,
         last_date = excluded.last_date,
         fetched_through = excluded.fetched_through,
         fetched_at = excluded.fetched_at`
    ).run(code, options.name ?? previous?.name ?? null, bounds?.first_date ?? null, bounds?.last_date ?? null, through, Date.now());

    enforceNavCap(db, code);
  });

  return getNavMeta(code)!;
}

/** 测试/维护用：清掉某只或全部缓存。 */
export function clearNavCache(code?: string): void {
  const database = getDb();
  if (code) {
    database.prepare('DELETE FROM nav_history WHERE fund_code = ?').run(code);
    database.prepare('DELETE FROM nav_history_meta WHERE fund_code = ?').run(code);
    return;
  }
  database.exec('DELETE FROM nav_history; DELETE FROM nav_history_meta');
}

/** 缓存统计（health / 状态展示用）。 */
export function navCacheStats(): {
  funds: number;
  points: number;
  maxPoints: number;
  retentionDays: number;
  trimmed: number;
  evicted: number;
} {
  const database: DatabaseSync = getDb();
  const funds = database.prepare('SELECT COUNT(*) AS n FROM nav_history_meta').get() as { n: number };
  return {
    funds: Number(funds?.n ?? 0),
    points: countNavPoints(database),
    maxPoints: maxPoints(),
    retentionDays: retentionDays(),
    trimmed: trimmedPoints,
    evicted: evictedFunds,
  };
}
