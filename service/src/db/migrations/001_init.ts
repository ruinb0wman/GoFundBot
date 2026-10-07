import type { DatabaseSync } from 'node:sqlite';
import type { Migration } from './types.js';

/**
 * 设置表。
 *
 * value 统一存 JSON 文本，便于按子域（proxy / llm / search）扩展而不改表结构。
 * LLM/Search 密钥在后续阶段写入同一张表。
 */
export const migration001: Migration = {
  version: 1,
  name: 'init_settings',
  up(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  },
};
