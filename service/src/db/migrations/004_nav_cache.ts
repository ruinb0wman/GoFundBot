import type { DatabaseSync } from 'node:sqlite';
import type { Migration } from './types.js';

/**
 * 净值缓存（原来是前端 Dexie 的 `navHistory` 表）。
 *
 * 净值序列是**只追加**的（历史点位不会被改写），所以按日期合并是安全的：
 * `INSERT ... ON CONFLICT DO UPDATE` 就是「新的覆盖旧的」。
 *
 * `nav_history_meta.fetched_through` 记的是「**取到哪天**」（不是最后一个有净值的日期）——
 * 净值只在交易日存在，节假日之后缓存里最后一天仍是节前那天，这不代表缓存过期。
 */
export const migration004: Migration = {
  version: 4,
  name: 'nav_cache',
  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE nav_history (
        fund_code TEXT NOT NULL,
        date      TEXT NOT NULL,
        nav       REAL NOT NULL,
        acc_nav   REAL,
        PRIMARY KEY (fund_code, date)
      );

      CREATE TABLE nav_history_meta (
        fund_code       TEXT PRIMARY KEY,
        name            TEXT,
        first_date      TEXT,
        last_date       TEXT,
        fetched_through TEXT,
        fetched_at      INTEGER NOT NULL
      );
    `);
  },
};
