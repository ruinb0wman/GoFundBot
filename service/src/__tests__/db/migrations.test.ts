import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 必须在模块加载前设定：每次 getDb() 都按当前 env 解析路径。
vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

describe('db (node:sqlite)', () => {
  it('runs migrations and reports the schema version', async () => {
    const { getDb } = await import('../../db/index.js');
    const db = getDb();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String((row as { name: string }).name));
    expect(tables).toContain('settings');
    expect(tables).toContain('schema_version');

    const version = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as {
      version: number;
    };
    expect(version.version).toBeGreaterThanOrEqual(1);
  });

  it('returns the same connection on repeated calls', async () => {
    const { getDb } = await import('../../db/index.js');
    expect(getDb()).toBe(getDb());
  });

  it('commits and rolls back transactions', async () => {
    const { getDb, transaction, resetDbForTests } = await import('../../db/index.js');
    resetDbForTests();
    const db = getDb();

    transaction((d) => {
      d.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(
        'committed',
        '{"ok":true}',
        Date.now()
      );
    });
    expect(db.prepare('SELECT key FROM settings WHERE key = ?').get('committed')).toBeTruthy();

    expect(() =>
      transaction((d) => {
        d.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(
          'rolled-back',
          '{}',
          Date.now()
        );
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(db.prepare('SELECT key FROM settings WHERE key = ?').get('rolled-back')).toBeUndefined();
  });

  it('persists across connections and re-runs migrations idempotently', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gofund-db-'));
    process.env.GOFUND_DB_PATH = join(dir, 'test.db');

    const { getDb, closeDb, resetDbForTests } = await import('../../db/index.js');
    resetDbForTests();

    getDb()
      .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('persisted', '{"a":1}', Date.now());
    closeDb();

    // 第二次打开：迁移应跳过（版本已是最新），数据仍在。
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('persisted') as {
      value: string;
    };
    expect(row.value).toBe('{"a":1}');

    closeDb();
    rmSync(dir, { recursive: true, force: true });
    process.env.GOFUND_DB_PATH = ':memory:';
  });
});
