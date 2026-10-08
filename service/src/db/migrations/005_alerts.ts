import type { DatabaseSync } from 'node:sqlite';
import type { Migration } from './types.js';

/**
 * 告警规则（原来是前端 Dexie 的 `alertRules` 表；桩路由时期写不落库）。
 *
 * `alert_type`：price_up / price_down（按实时估算涨跌幅）· return_above / return_below（按持仓收益率）。
 * `threshold` 是百分数（5 = 5%）。
 */
export const migration005: Migration = {
  version: 5,
  name: 'alerts',
  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE alerts (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        fund_code      TEXT NOT NULL,
        fund_name      TEXT,
        alert_type     TEXT NOT NULL,
        threshold      REAL NOT NULL,
        enabled        INTEGER NOT NULL DEFAULT 1,
        last_triggered TEXT,
        created_time   TEXT NOT NULL
      );

      CREATE INDEX idx_alerts_fund ON alerts (fund_code);
    `);
  },
};
