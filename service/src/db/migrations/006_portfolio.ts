import type { DatabaseSync } from 'node:sqlite';
import type { Migration } from './types.js';

/**
 * 实时页的组合数据（原来是前端 Dexie 的 `portfolio` / `tradeRecords` 表）：
 * 组合基金列表、分组、基金↔分组映射、交易记录。持仓（share/cost）**不落表**，
 * 由 `portfolioService.getHoldings()` 从已结算交易推导。
 */
export const migration006: Migration = {
  version: 6,
  name: 'portfolio',
  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE portfolio_funds (
        fund_code  TEXT PRIMARY KEY,
        fund_name  TEXT,
        fund_type  TEXT,
        sort_order INTEGER NOT NULL,
        added_at   INTEGER NOT NULL
      );

      CREATE TABLE portfolio_groups (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        name              TEXT NOT NULL,
        rebalance_enabled INTEGER NOT NULL DEFAULT 0,
        rebalance_target  REAL,
        rebalance_upper   REAL,
        rebalance_lower   REAL,
        sort_order        INTEGER NOT NULL,
        created_at        INTEGER NOT NULL
      );

      CREATE TABLE portfolio_fund_groups (
        fund_code TEXT PRIMARY KEY,
        group_id  INTEGER NOT NULL REFERENCES portfolio_groups (id) ON DELETE CASCADE
      );

      -- 显式持仓：仅在「导入 JSON 恢复」时写入。正常路径的持仓由已结算交易推导，
      -- 某只基金有交易时以推导为准（见 getHoldings）。
      CREATE TABLE portfolio_holdings (
        fund_code       TEXT PRIMARY KEY,
        share           REAL NOT NULL,
        cost            REAL NOT NULL,
        total_fee       REAL NOT NULL DEFAULT 0,
        buy_date        TEXT,
        profit_nav_date TEXT
      );

      CREATE TABLE portfolio_trades (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        fund_code  TEXT NOT NULL,
        fund_name  TEXT,
        type       TEXT NOT NULL,
        trade_date TEXT,
        amount     REAL NOT NULL DEFAULT 0,
        share      REAL NOT NULL DEFAULT 0,
        nav        REAL NOT NULL DEFAULT 0,
        status     TEXT NOT NULL DEFAULT 'settled',
        txn_id     TEXT,
        settled_at TEXT,
        note       TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_portfolio_trades_fund ON portfolio_trades (fund_code);
      CREATE INDEX idx_portfolio_trades_txn ON portfolio_trades (txn_id);
    `);
  },
};
