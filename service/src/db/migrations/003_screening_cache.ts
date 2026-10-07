import type { DatabaseSync } from 'node:sqlite';
import type { Migration } from './types.js';

/**
 * 筛选缓存表 —— 原来是前端 Dexie 的 `screeningFunds`，现在唯一真源在 service。
 *
 * 原始字段来自 `/api/screening/sync` 的快照；`sharpe_ratio_*` / `industry_tag_name` /
 * `rank_pct_*` / `pass_4433` 是富化结果，跨进程持久化（以前放 IndexedDB，重启浏览器不丢、
 * 重启 service 会丢）。
 *
 * `screening_meta` 存 `sync_time`（快照时间）与 `ranks_computed_at`（4433 计算时间）。
 */
export const migration003: Migration = {
  version: 3,
  name: 'screening_cache',
  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE screening_funds (
        fund_code          TEXT PRIMARY KEY,
        fund_name          TEXT NOT NULL DEFAULT '',
        fund_type          TEXT,
        return_1m          REAL,
        return_3m          REAL,
        return_6m          REAL,
        return_1y          REAL,
        return_2y          REAL,
        return_3y          REAL,
        ytd                REAL,
        since_inception    REAL,
        fee                TEXT,
        nav                REAL,
        nav_date           TEXT,
        source             TEXT,
        updated_time       TEXT,
        max_drawdown_1y    REAL,
        sharpe_ratio_1y    REAL,
        sharpe_ratio_3y    REAL,
        volatility_1y      REAL,
        calmar_ratio_1y    REAL,
        industry_tag_name  TEXT,
        rank_pct_1m        REAL,
        rank_pct_3m        REAL,
        rank_pct_6m        REAL,
        rank_pct_1y        REAL,
        rank_pct_2y        REAL,
        rank_pct_3y        REAL,
        pass_4433          INTEGER NOT NULL DEFAULT -1,
        /** 取过净值但没算出指标（净值太短/取数失败）时置 1，避免反复重试。 */
        risk_attempted     INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX idx_screening_funds_type ON screening_funds(fund_type);
      CREATE INDEX idx_screening_funds_pass ON screening_funds(pass_4433);
      CREATE INDEX idx_screening_funds_sharpe ON screening_funds(sharpe_ratio_1y);

      CREATE TABLE screening_meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  },
};
