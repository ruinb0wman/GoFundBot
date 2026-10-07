import type { DatabaseSync } from 'node:sqlite';
import type { Migration } from './types.js';

/**
 * 用户数据表 —— 前端 Dexie 的对应物，现在唯一真源在 service。
 *
 * 字段与 `frontend/src/db/index.ts` 的接口一一对应（含 `createdAt`/`updatedAt` 毫秒时间戳）；
 * 数组/对象字段（`tags`、`last_summary`）存 JSON 文本。
 * 未在此建表的 Dexie 表（portfolio / tradeRecords / alertRules / chat* / analysisMemory）
 * 前端已无引用，属历史遗留。
 */
export const migration002: Migration = {
  version: 2,
  name: 'user_data',
  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE positions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        fund_code     TEXT NOT NULL,
        fund_name     TEXT,
        purchase_date TEXT,
        purchase_time TEXT,
        shares        REAL NOT NULL DEFAULT 0,
        cost          REAL NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL
      );

      CREATE TABLE strategies (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT NOT NULL,
        content    TEXT NOT NULL,
        tags       TEXT NOT NULL DEFAULT '[]',
        active     INTEGER NOT NULL DEFAULT 1,
        source     TEXT NOT NULL DEFAULT 'manual',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE strategy_scripts (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT NOT NULL,
        code         TEXT NOT NULL,
        source       TEXT NOT NULL DEFAULT 'manual',
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        last_run_at  INTEGER,
        last_summary TEXT
      );

      CREATE TABLE watchlist (
        fund_code  TEXT PRIMARY KEY,
        fund_name  TEXT,
        fund_type  TEXT,
        group_id   INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,
        added_at   INTEGER NOT NULL
      );

      CREATE TABLE watchlist_groups (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX idx_positions_fund ON positions (fund_code);
      CREATE INDEX idx_strategies_updated ON strategies (updated_at DESC);
      CREATE INDEX idx_scripts_updated ON strategy_scripts (updated_at DESC);
      CREATE INDEX idx_watchlist_group ON watchlist (group_id);
    `);
  },
};
