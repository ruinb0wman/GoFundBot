import { describe, it, expect, vi, beforeEach } from 'vitest';

// 必须在模块加载前设定（路径与日志目录）。
vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

async function freshModules() {
  const db = await import('../../db/index.js');
  const settings = await import('../../services/settingsService.js');
  db.resetDbForTests();
  settings.resetSettingsCacheForTests();
  return { db, settings };
}

describe('settingsService (SQLite-backed)', () => {
  beforeEach(() => {
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
  });

  it('falls back to the env proxy when no row exists', async () => {
    process.env.HTTPS_PROXY = 'http://env-proxy:1080';
    const { settings } = await freshModules();
    expect(settings.getSettings().proxy.url).toBe('http://env-proxy:1080');
  });

  it('persists updates to the settings table', async () => {
    const { db, settings } = await freshModules();

    settings.updateSettings({ proxy: { url: 'http://127.0.0.1:9999' } });

    const row = db.getDb().prepare('SELECT value FROM settings WHERE key = ?').get('app') as {
      value: string;
    };
    expect(JSON.parse(row.value).proxy.url).toBe('http://127.0.0.1:9999');

    // 内存缓存丢弃后，仍从库里读回。
    settings.resetSettingsCacheForTests();
    expect(settings.getSettings().proxy.url).toBe('http://127.0.0.1:9999');
  });

  it('tolerates a corrupt settings row', async () => {
    const { db, settings } = await freshModules();
    db.getDb()
      .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .run('app', 'not-json', Date.now());

    expect(settings.getSettings().proxy.url).toBe('');
  });
});
