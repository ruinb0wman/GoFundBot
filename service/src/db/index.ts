/**
 * SQLite 连接与迁移（Node 内置 `node:sqlite`，零依赖，Node ≥ 22.5）。
 *
 * 单例：整个进程一个连接。SQLite 是单写者，WAL 模式下读不阻塞写。
 * 迁移在首次 `getDb()` 时执行，幂等；`schema_version` 记录当前版本。
 *
 * 所有用户数据、设置与缓存都落在这里，前端不再持有用户态 IndexedDB。
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveDbPath } from '../core/dbPaths.js';
import { logger } from '../core/logger.js';
import { MIGRATIONS } from './migrations/index.js';

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;

  const path = resolveDbPath();
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const instance = new DatabaseSync(path);
  // in-memory 库不支持 WAL，会退化为 memory 模式，不报错。
  instance.exec('PRAGMA journal_mode=WAL');
  instance.exec('PRAGMA foreign_keys=ON');
  migrate(instance);

  db = instance;
  logger.info('sqlite ready', { path, version: schemaVersion(instance) });
  return db;
}

/**
 * 事务包装（node:sqlite 没有内置 helper）。回调抛错即回滚。
 * 不支持嵌套事务：不要在事务里再调用 `transaction()`。
 */
export function transaction<T>(fn: (database: DatabaseSync) => T): T {
  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function closeDb(): void {
  if (!db) return;
  db.close();
  db = null;
}

/** 测试用：关闭连接，下一次 `getDb()` 会按当前 env 重新打开并跑迁移。 */
export function resetDbForTests(): void {
  closeDb();
}

function migrate(database: DatabaseSync): void {
  database.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = database.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined;
  let current = row?.version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      migration.up(database);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    current = migration.version;
    logger.info('sqlite migration applied', { version: migration.version, name: migration.name });
  }

  if (row) {
    database.prepare('UPDATE schema_version SET version = ?').run(current);
  } else {
    database.prepare('INSERT INTO schema_version (version) VALUES (?)').run(current);
  }
}

function schemaVersion(database: DatabaseSync): number {
  const row = database.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}
