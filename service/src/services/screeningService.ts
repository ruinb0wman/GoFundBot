/**
 * 基金筛选的**服务端存储与富化**（原来是前端 IndexedDB 里的 `screeningFunds`）。
 *
 * 职责：
 * 1. `syncScreening` —— 拉 `/api/screening/sync` 的原始快照写入 SQLite，算行业标签，再算 4433 排名；
 * 2. `enrichScreening` —— 给还没有风险指标的基金取净值算指标（**分批**，每批上限默认 300，避免一次请求卡几分钟）；
 * 3. `queryScreening` —— 筛选/排序/分页（过滤语义与迁移前的前端实现逐条对齐）；
 * 4. `getScreeningStatus` —— 页面状态条用的计数。
 *
 * 净值取数复用 `getFundNavBatch`（provider 链 + 24h 缓存）。
 */
import type { DatabaseSync } from 'node:sqlite';
import { getDb, transaction } from '../db/index.js';
import { logger } from '../core/logger.js';
import { getFundNavBatch, getFundScreeningSnapshot } from './fundService.js';
import { classifyFundIndustry } from '../../../packages/core/src/industryClassifier.js';
import { computeScreeningRanks } from '../../../packages/core/src/screeningEnrich.js';
import { computeRiskMetricsLocal } from '../../../packages/core/src/number.js';

/** 每批富化的基金数（一次 HTTP 请求内取多少只基金的净值）。 */
export const DEFAULT_ENRICH_LIMIT = 300;

const META_SYNC_TIME = 'sync_time';
const META_RANKS_AT = 'ranks_computed_at';

/** 一行筛选结果（形状与迁移前前端 Dexie 的 `ScreeningFund` 完全一致）。 */
export interface ScreeningFundRow {
  fund_code: string;
  fund_name: string;
  fund_type: string | null;
  return_1m: number | null;
  return_3m: number | null;
  return_6m: number | null;
  return_1y: number | null;
  return_2y: number | null;
  return_3y: number | null;
  ytd: number | null;
  since_inception: number | null;
  fee: string | null;
  nav: number | null;
  nav_date: string | null;
  source: string | null;
  updated_time: string | null;
  max_drawdown_1y: number | null;
  sharpe_ratio_1y: number | null;
  sharpe_ratio_3y: number | null;
  volatility_1y: number | null;
  calmar_ratio_1y: number | null;
  industry_tag_name: string | null;
  rank_pct_1m: number | null;
  rank_pct_3m: number | null;
  rank_pct_6m: number | null;
  rank_pct_1y: number | null;
  rank_pct_2y: number | null;
  rank_pct_3y: number | null;
  pass_4433: number;
}

export interface ScreeningStatus {
  basic_count: number;
  complete_count: number;
  pass_4433_count: number;
  risk_metrics_count: number;
  risk_metrics_pending: number;
  type_counts: Record<string, number>;
  latest_update: string | null;
  sync_time: string | null;
  syncing: boolean;
  computed: boolean;
}

export interface ScreeningQueryFilters {
  fund_types?: string[];
  industry_tags?: string[];
  pass_4433?: boolean | string | number;
  keyword?: string;
  [key: string]: unknown;
}

export interface ScreeningQueryResult {
  funds: ScreeningFundRow[];
  total: number;
  page: number;
  page_size: number;
}

let syncing = false;

function meta(database: DatabaseSync, key: string): string | null {
  const row = database.prepare('SELECT value FROM screening_meta WHERE key = ?').get(key) as
    | { value: string | null }
    | undefined;
  return row?.value ?? null;
}

function setMeta(database: DatabaseSync, key: string, value: string | null): void {
  database
    .prepare('INSERT INTO screening_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function getAllScreeningFunds(): ScreeningFundRow[] {
  if (allFundsCache) return allFundsCache;
  allFundsCache = getDb()
    .prepare(
      `SELECT fund_code, fund_name, fund_type, return_1m, return_3m, return_6m, return_1y, return_2y, return_3y,
              ytd, since_inception, fee, nav, nav_date, source, updated_time,
              max_drawdown_1y, sharpe_ratio_1y, sharpe_ratio_3y, volatility_1y, calmar_ratio_1y,
              industry_tag_name, rank_pct_1m, rank_pct_3m, rank_pct_6m, rank_pct_1y, rank_pct_2y, rank_pct_3y,
              pass_4433
         FROM screening_funds`
    )
    .all() as unknown as ScreeningFundRow[];
  return allFundsCache;
}

/**
 * 进程内整表缓存：`/api/screening/query` 原来每次读全表 + 建 3300 个对象（~79ms），
 * 表只在同步/富化/排名时才变，所以缓存到下一次写库即可。
 * `screeningDataVersion()` 供上层（如投研看板）做缓存失效判断。
 */
let allFundsCache: ScreeningFundRow[] | null = null;
let dataVersion = 0;

export function screeningDataVersion(): number {
  return dataVersion;
}

function invalidateScreeningCache(): void {
  allFundsCache = null;
  dataVersion += 1;
}

/** 测试用（`:memory:` 库被重建时清掉进程内缓存）。 */
export function resetScreeningCacheForTests(): void {
  allFundsCache = null;
}

function count(database: DatabaseSync, where = ''): number {
  const row = database.prepare(`SELECT COUNT(*) AS n FROM screening_funds ${where}`).get() as {
    n: number;
  };
  return Number(row?.n ?? 0);
}

/** 拉快照 → 写库（保留已有富化列）→ 算 4433 排名 → 富化一批风险指标。 */
export async function syncScreening(
  options: { force?: boolean; since?: string; enrichLimit?: number } = {}
): Promise<Record<string, unknown>> {
  const database = getDb();
  syncing = true;
  try {
    const snapshot = await getFundScreeningSnapshot({ limitPerType: 500 });
    const updatedAt = snapshot.updatedAt instanceof Date ? snapshot.updatedAt.toISOString() : null;

    if (!options.force && options.since && updatedAt && options.since >= updatedAt) {
      return { unchanged: true, ...statusPayload() };
    }

    const items = snapshot.data?.items ?? [];
    if (items.length === 0) {
      // 快照为空（多半是数据源故障）：绝不覆盖已有缓存。
      logger.error('screening sync got an empty snapshot, keeping local cache');
      return { unchanged: false, total: 0, note: '快照为空，未改动本地缓存', ...statusPayload() };
    }

    transaction((db) => {
      const insert = db.prepare(
        `INSERT INTO screening_funds
           (fund_code, fund_name, fund_type, return_1m, return_3m, return_6m, return_1y, return_2y, return_3y,
            ytd, since_inception, fee, nav, nav_date, source, updated_time, industry_tag_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(fund_code) DO UPDATE SET
           fund_name = excluded.fund_name,
           fund_type = excluded.fund_type,
           return_1m = excluded.return_1m,
           return_3m = excluded.return_3m,
           return_6m = excluded.return_6m,
           return_1y = excluded.return_1y,
           return_2y = excluded.return_2y,
           return_3y = excluded.return_3y,
           ytd = excluded.ytd,
           since_inception = excluded.since_inception,
           fee = excluded.fee,
           nav = excluded.nav,
           nav_date = excluded.nav_date,
           source = excluded.source,
           updated_time = excluded.updated_time,
           industry_tag_name = COALESCE(screening_funds.industry_tag_name, excluded.industry_tag_name)`
      );

      const seen = new Set<string>();
      for (const item of items) {
        seen.add(item.code);
        insert.run(
          item.code,
          item.name ?? '',
          item.type ?? null,
          item.return1m ?? null,
          item.return3m ?? null,
          item.return6m ?? null,
          item.return1y ?? null,
          item.return2y ?? null,
          item.return3y ?? null,
          item.ytd ?? null,
          item.sinceInception ?? null,
          item.fee ?? null,
          item.nav ?? null,
          item.navDate ?? null,
          item.source ?? null,
          item.updatedAt ?? null,
          classifyFundIndustry(item.name ?? '') ?? null
        );
      }

      // 快照里消失的基金不再保留（与迁移前「clear + 重写」的语义一致）。
      const existing = db.prepare('SELECT fund_code FROM screening_funds').all() as unknown as {
        fund_code: string;
      }[];
      const remove = db.prepare('DELETE FROM screening_funds WHERE fund_code = ?');
      for (const row of existing) {
        if (!seen.has(row.fund_code)) remove.run(row.fund_code);
      }

      setMeta(db, META_SYNC_TIME, new Date().toISOString());
      setMeta(db, META_RANKS_AT, null);
    });

    invalidateScreeningCache();
    const ranked = recomputeRanks();
    // enrichLimit === 0 时不要谎报 remaining=0：真实待算数从库里数（`/sync` 不再阻塞首屏）。
    const enriched =
      options.enrichLimit === 0
        ? {
            enriched: 0,
            remaining: count(database, 'WHERE sharpe_ratio_1y IS NULL AND risk_attempted = 0'),
            risk_metrics_count: count(database, 'WHERE sharpe_ratio_1y IS NOT NULL'),
          }
        : await enrichScreening({ limit: options.enrichLimit });

    return {
      unchanged: false,
      total: items.length,
      ranked,
      ...enriched,
      ...statusPayload(),
    };
  } finally {
    syncing = false;
  }
}

/** 全量重算 4433 排名（分组百分位 + 通过标记），就地写库。 */
export function recomputeRanks(): number {
  const rows = getAllScreeningFunds();
  if (rows.length === 0) return 0;
  computeScreeningRanks(rows);

  transaction((db) => {
    const update = db.prepare(
      `UPDATE screening_funds
          SET rank_pct_1m = ?, rank_pct_3m = ?, rank_pct_6m = ?, rank_pct_1y = ?, rank_pct_2y = ?, rank_pct_3y = ?, pass_4433 = ?
        WHERE fund_code = ?`
    );
    for (const row of rows) {
      update.run(
        row.rank_pct_1m ?? null,
        row.rank_pct_3m ?? null,
        row.rank_pct_6m ?? null,
        row.rank_pct_1y ?? null,
        row.rank_pct_2y ?? null,
        row.rank_pct_3y ?? null,
        row.pass_4433 ?? 0,
        row.fund_code
      );
    }
    setMeta(db, META_RANKS_AT, new Date().toISOString());
  });
  invalidateScreeningCache();

  return rows.length;
}

/**
 * 富化一批还没有风险指标的基金（取净值 → `computeRiskMetricsLocal`）。
 *
 * `risk_attempted` 保证「取不到净值的基金」不会被反复重试：前端循环靠 `remaining` 收敛。
 * 需要重试时传 `{ retry: true }` 重置标记。
 */
export async function enrichScreening(
  options: { limit?: number; retry?: boolean } = {}
): Promise<{ enriched: number; remaining: number; risk_metrics_count: number }> {
  const database = getDb();
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_ENRICH_LIMIT, 2000));

  if (options.retry) {
    database.exec('UPDATE screening_funds SET risk_attempted = 0 WHERE sharpe_ratio_1y IS NULL');
  }

  const pending = database
    .prepare('SELECT fund_code FROM screening_funds WHERE sharpe_ratio_1y IS NULL AND risk_attempted = 0 LIMIT ?')
    .all(limit) as unknown as { fund_code: string }[];

  if (pending.length === 0) {
    return { enriched: 0, remaining: 0, risk_metrics_count: count(database, 'WHERE sharpe_ratio_1y IS NOT NULL') };
  }

  const nav = await getFundNavBatch(pending.map((row) => row.fund_code));
  const navByCode = nav.data ?? {};

  let enriched = 0;
  transaction((db) => {
    const update = db.prepare(
      `UPDATE screening_funds
          SET max_drawdown_1y = ?, sharpe_ratio_1y = ?, sharpe_ratio_3y = ?, volatility_1y = ?, calmar_ratio_1y = ?,
              risk_attempted = 1
        WHERE fund_code = ?`
    );
    for (const { fund_code } of pending) {
      const points = navByCode[fund_code];
      const metrics = points && points.length >= 10 ? computeRiskMetricsLocal(points) : null;
      update.run(
        metrics?.max_drawdown_1y ?? null,
        metrics?.sharpe_ratio_1y ?? null,
        metrics?.sharpe_ratio_3y ?? null,
        metrics?.volatility_1y ?? null,
        metrics?.calmar_ratio_1y ?? null,
        fund_code
      );
      if (metrics?.sharpe_ratio_1y != null) enriched++;
    }
  });
  invalidateScreeningCache();

  return {
    enriched,
    remaining: count(database, 'WHERE sharpe_ratio_1y IS NULL AND risk_attempted = 0'),
    risk_metrics_count: count(database, 'WHERE sharpe_ratio_1y IS NOT NULL'),
  };
}

export function getScreeningStatus(): ScreeningStatus {
  const database = getDb();
  const typeCounts: Record<string, number> = {};
  const grouped = database
    .prepare(`SELECT COALESCE(fund_type, '(untyped)') AS type, COUNT(*) AS n FROM screening_funds GROUP BY 1`)
    .all() as unknown as { type: string; n: number }[];
  for (const row of grouped) typeCounts[row.type] = Number(row.n);

  const latest = database.prepare('SELECT MAX(updated_time) AS latest FROM screening_funds').get() as
    | { latest: string | null }
    | undefined;

  const complete = database
    .prepare(
      `SELECT COUNT(*) AS n FROM screening_funds
        WHERE fund_type IS NOT NULL AND fund_type <> '' AND industry_tag_name IS NOT NULL AND sharpe_ratio_1y IS NOT NULL`
    )
    .get() as { n: number };

  return {
    basic_count: count(database),
    complete_count: Number(complete?.n ?? 0),
    pass_4433_count: count(database, 'WHERE pass_4433 = 1'),
    risk_metrics_count: count(database, 'WHERE sharpe_ratio_1y IS NOT NULL'),
    risk_metrics_pending: count(database, 'WHERE sharpe_ratio_1y IS NULL AND risk_attempted = 0'),
    type_counts: typeCounts,
    latest_update: latest?.latest ?? null,
    sync_time: meta(database, META_SYNC_TIME),
    syncing,
    computed: meta(database, META_RANKS_AT) !== null,
  };
}

/** 行业标签计数（筛选页的标签面板用）。 */
export function getIndustryTagCounts(): { name: string; count: number }[] {
  return getDb()
    .prepare(
      `SELECT industry_tag_name AS name, COUNT(*) AS count
         FROM screening_funds
        WHERE industry_tag_name IS NOT NULL AND industry_tag_name <> ''
        GROUP BY 1 ORDER BY 2 DESC`
    )
    .all() as unknown as { name: string; count: number }[];
}

/**
 * 策略沙箱 `prepare(sdk).screen()` 看的字段（`ScreenRow`，7 列，与 core 的契约一致）。
 * 返回全量（约 3300 行 / ~250KB），前端在内存里筛。
 */
export function getScreenRows(): Record<string, unknown>[] {
  const rows = getDb()
    .prepare(
      `SELECT fund_code AS code, fund_name AS name, fund_type AS type,
              return_1y, sharpe_ratio_1y, max_drawdown_1y, nav_date
         FROM screening_funds ORDER BY fund_code`
    )
    .all() as unknown as Record<string, unknown>[];
  return rows.filter((row) => String(row.code ?? '').trim().length > 0);
}

function statusPayload(): Omit<ScreeningStatus, 'type_counts' | 'syncing' | 'computed'> {
  const status = getScreeningStatus();
  return {
    basic_count: status.basic_count,
    complete_count: status.complete_count,
    pass_4433_count: status.pass_4433_count,
    risk_metrics_count: status.risk_metrics_count,
    risk_metrics_pending: status.risk_metrics_pending,
    latest_update: status.latest_update,
    sync_time: status.sync_time,
  };
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * 筛选 + 排序 + 分页。
 * 过滤语义与迁移前的 `useScreeningDb.queryFunds` 逐条对齐（含 `max_drawdown_*_max` 都读 `max_drawdown_1y`
 * 这类历史口径 —— 不要"顺手修正"，否则页面数字会变）。
 */
export function queryScreening(options: {
  filters?: ScreeningQueryFilters;
  sortByField?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}): ScreeningQueryResult {
  const filters = options.filters ?? {};
  const sortByField = options.sortByField || 'return_1y';
  const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.max(1, Math.min(Math.floor(options.pageSize ?? 20), 5000));

  const fundTypes = filters.fund_types as string[] | undefined;
  const industryTags = filters.industry_tags as string[] | undefined;
  const pass4433 = filters.pass_4433 === true || filters.pass_4433 === 'true' || filters.pass_4433 === 1;
  const keyword = typeof filters.keyword === 'string' ? filters.keyword.trim().toLowerCase() : '';

  const results = getAllScreeningFunds().filter((fund) => {
    if (pass4433 && fund.pass_4433 !== 1) return false;
    if (fundTypes && fundTypes.length > 0 && !fundTypes.includes(fund.fund_type ?? '')) return false;
    if (industryTags && industryTags.length > 0) {
      if (!fund.industry_tag_name || !industryTags.includes(fund.industry_tag_name)) return false;
    }

    if (filters.return_1m_min != null && fund.return_1m != null && fund.return_1m < numeric(filters.return_1m_min)!) return false;
    if (filters.return_1m_max != null && fund.return_1m != null && fund.return_1m > numeric(filters.return_1m_max)!) return false;
    if (filters.return_3m_min != null && fund.return_3m != null && fund.return_3m < numeric(filters.return_3m_min)!) return false;
    if (filters.return_3m_max != null && fund.return_3m != null && fund.return_3m > numeric(filters.return_3m_max)!) return false;
    if (filters.return_6m_min != null && fund.return_6m != null && fund.return_6m < numeric(filters.return_6m_min)!) return false;
    if (filters.return_6m_max != null && fund.return_6m != null && fund.return_6m > numeric(filters.return_6m_max)!) return false;
    if (filters.return_1y_min != null && fund.return_1y != null && fund.return_1y < numeric(filters.return_1y_min)!) return false;
    if (filters.return_1y_max != null && fund.return_1y != null && fund.return_1y > numeric(filters.return_1y_max)!) return false;
    if (filters.return_3y_min != null && fund.return_3y != null && fund.return_3y < numeric(filters.return_3y_min)!) return false;
    if (filters.return_3y_max != null && fund.return_3y != null && fund.return_3y > numeric(filters.return_3y_max)!) return false;

    if (filters.rank_pct_1m_max != null && fund.rank_pct_1m != null && fund.rank_pct_1m > numeric(filters.rank_pct_1m_max)!) return false;
    if (filters.rank_pct_3m_max != null && fund.rank_pct_3m != null && fund.rank_pct_3m > numeric(filters.rank_pct_3m_max)!) return false;
    if (filters.rank_pct_6m_max != null && fund.rank_pct_6m != null && fund.rank_pct_6m > numeric(filters.rank_pct_6m_max)!) return false;
    if (filters.rank_pct_1y_max != null && fund.rank_pct_1y != null && fund.rank_pct_1y > numeric(filters.rank_pct_1y_max)!) return false;
    if (filters.rank_pct_2y_max != null && fund.rank_pct_2y != null && fund.rank_pct_2y > numeric(filters.rank_pct_2y_max)!) return false;
    if (filters.rank_pct_3y_max != null && fund.rank_pct_3y != null && fund.rank_pct_3y > numeric(filters.rank_pct_3y_max)!) return false;

    if (filters.sharpe_ratio_1y_min != null && fund.sharpe_ratio_1y != null && fund.sharpe_ratio_1y < numeric(filters.sharpe_ratio_1y_min)!) return false;
    if (filters.sharpe_ratio_3y_min != null && fund.sharpe_ratio_3y != null && fund.sharpe_ratio_3y < numeric(filters.sharpe_ratio_3y_min)!) return false;
    if (filters.calmar_ratio_1y_min != null && fund.calmar_ratio_1y != null && fund.calmar_ratio_1y < numeric(filters.calmar_ratio_1y_min)!) return false;
    if (filters.max_drawdown_3m_max != null && fund.max_drawdown_1y != null && fund.max_drawdown_1y > numeric(filters.max_drawdown_3m_max)!) return false;
    if (filters.max_drawdown_6m_max != null && fund.max_drawdown_1y != null && fund.max_drawdown_1y > numeric(filters.max_drawdown_6m_max)!) return false;
    if (filters.max_drawdown_1y_max != null && fund.max_drawdown_1y != null && fund.max_drawdown_1y > numeric(filters.max_drawdown_1y_max)!) return false;
    if (filters.max_drawdown_3y_max != null && fund.max_drawdown_1y != null && fund.max_drawdown_1y > numeric(filters.max_drawdown_3y_max)!) return false;
    if (filters.max_drawdown_all_max != null && fund.max_drawdown_1y != null && fund.max_drawdown_1y > numeric(filters.max_drawdown_all_max)!) return false;
    if (filters.volatility_1y_max != null && fund.volatility_1y != null && fund.volatility_1y > numeric(filters.volatility_1y_max)!) return false;
    if (filters.volatility_3y_max != null && fund.volatility_1y != null && fund.volatility_1y > numeric(filters.volatility_3y_max)!) return false;
    if (filters.annual_return_1y_min != null && fund.return_1y != null && fund.return_1y < numeric(filters.annual_return_1y_min)!) return false;
    if (filters.annual_return_1y_max != null && fund.return_1y != null && fund.return_1y > numeric(filters.annual_return_1y_max)!) return false;
    if (filters.annual_return_3y_min != null && fund.return_3y != null && fund.return_3y < numeric(filters.annual_return_3y_min)!) return false;
    if (filters.annual_return_3y_max != null && fund.return_3y != null && fund.return_3y > numeric(filters.annual_return_3y_max)!) return false;

    if (keyword) {
      if (!fund.fund_code.toLowerCase().includes(keyword) && !fund.fund_name.toLowerCase().includes(keyword)) return false;
    }

    return true;
  });

  results.sort((a, b) => {
    const aVal = (a as unknown as Record<string, number | null>)[sortByField] ?? null;
    const bVal = (b as unknown as Record<string, number | null>)[sortByField] ?? null;
    if (aVal === bVal) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
  });

  const start = (page - 1) * pageSize;
  return { funds: results.slice(start, start + pageSize), total: results.length, page, page_size: pageSize };
}
