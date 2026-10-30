import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.hoisted(() => {
  process.env.GOFUND_DB_PATH = ':memory:';
  process.env.LOG_DIR = '/tmp/gofund-test-logs';
});

const root = mkdtempSync(join(tmpdir(), 'gofund-strategy-store-'));

async function freshModules(dir = join(root, 'strategies')) {
  const db = await import('../../db/index.js');
  const settings = await import('../../services/settingsService.js');
  db.resetDbForTests();
  settings.resetSettingsCacheForTests();
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.GOFUND_STRATEGY_DIR = dir;
  return { db, store: await import('../../services/strategyStore.js'), settings, dir };
}

describe('strategyStore (markdown folder)', () => {
  beforeEach(() => {
    delete process.env.GOFUND_STRATEGY_DIR;
  });

  it('creates a file per strategy and updates it in place', async () => {
    const { store, dir } = await freshModules();

    const created = store.addStrategy({ title: '稳健定投', content: '每月 15 号投 2000', tags: ['定投'] });
    expect(created.id).toBe(1);
    expect(readdirSync(dir)).toEqual(['稳健定投.md']);

    const raw = readFileSync(join(dir, '稳健定投.md'), 'utf8');
    expect(raw.startsWith('---\n')).toBe(true);
    expect(raw).toContain('id: 1');
    expect(raw).toContain('tags: [定投]');
    expect(raw).toContain('每月 15 号投 2000');

    const renamed = store.updateStrategy(1, { title: '稳健定投 v2', tags: ['定投', '长期'] });
    expect(renamed?.title).toBe('稳健定投 v2');
    // 文件名不跟着标题改（文件名随意，id 才是标识）
    expect(readdirSync(dir)).toEqual(['稳健定投.md']);

    const listed = store.listStrategies();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: 1, title: '稳健定投 v2', tags: ['定投', '长期'], active: 1 });
  });

  it('sorts active first, then newest', async () => {
    const { store } = await freshModules();
    store.addStrategy({ title: 'B', content: 'b', active: 0 });
    store.addStrategy({ title: 'A', content: 'a', active: 1 });
    expect(store.listStrategies().map((s) => s.title)).toEqual(['A', 'B']);
  });

  it('reads a plain markdown file and fills in its id', async () => {
    const { store, dir } = await freshModules();
    writeFileSync(join(dir, '随手记.md'), '# 网格交易\n\n跌 5% 买一份\n', 'utf8');

    const listed = store.listStrategies();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ title: '网格交易', active: 1, source: 'manual' });
    expect(listed[0].content).toContain('跌 5% 买一份');
    expect(listed[0].id).toBeGreaterThan(0);
    // 读时自愈：id 写回了文件，下次读到的还是同一个
    expect(readFileSync(join(dir, '随手记.md'), 'utf8')).toContain(`id: ${listed[0].id}`);
    expect(store.listStrategies()[0].id).toBe(listed[0].id);
  });

  it('keeps unknown frontmatter keys on write', async () => {
    const { store, dir } = await freshModules();
    writeFileSync(
      join(dir, 'a.md'),
      '---\nid: 7\ntitle: 旧标题\nactive: 1\ncssclasses: [wide]\n---\n\n正文\n',
      'utf8'
    );

    store.updateStrategy(7, { content: '新正文' });
    const raw = readFileSync(join(dir, 'a.md'), 'utf8');
    expect(raw).toContain('cssclasses: [wide]');
    expect(raw).toContain('新正文');
  });

  it('reassigns duplicate ids instead of shadowing a file', async () => {
    const { store, dir } = await freshModules();
    writeFileSync(join(dir, 'a.md'), '---\nid: 3\ntitle: A\n---\n\n甲\n', 'utf8');
    writeFileSync(join(dir, 'b.md'), '---\nid: 3\ntitle: B\n---\n\n乙\n', 'utf8');

    const ids = store.listStrategies().map((s) => s.id).sort();
    expect(new Set(ids).size).toBe(2);
  });

  it('finds a strategy by id even after the file is renamed', async () => {
    const { store, dir } = await freshModules();
    const created = store.addStrategy({ title: 'X', content: 'x' });
    renameSync(join(dir, 'X.md'), join(dir, '随便什么名字.md'));

    expect(store.updateStrategy(created.id, { content: 'y' })?.content).toBe('y');
    expect(readFileSync(join(dir, '随便什么名字.md'), 'utf8')).toContain('y');
  });

  it('moves deleted files to .trash instead of unlinking', async () => {
    const { store, dir } = await freshModules();
    const created = store.addStrategy({ title: '删我', content: 'x' });

    store.removeStrategy(created.id);

    expect(store.listStrategies()).toHaveLength(0);
    expect(existsSync(join(dir, '删我.md'))).toBe(false);
    expect(readdirSync(join(dir, '.trash')).some((name) => name.startsWith('删我.'))).toBe(true);
  });

  it('is inert until a folder is configured', async () => {
    const { store } = await freshModules();
    delete process.env.GOFUND_STRATEGY_DIR;
    const settings = await import('../../services/settingsService.js');
    settings.resetSettingsCacheForTests();

    expect(store.isStrategyDirConfigured()).toBe(false);
    expect(store.listStrategies()).toEqual([]);
    expect(() => store.addStrategy({ title: 'x', content: 'y' })).toThrow(/策略文件夹未配置/);
  });

  it('exports legacy sqlite rows once when a folder is configured', async () => {
    const { db, store, dir } = await freshModules();
    const settings = await import('../../services/settingsService.js');
    db.getDb()
      .prepare(
        `INSERT INTO strategies (title, content, tags, active, source, created_at, updated_at)
         VALUES ('旧策略', '旧正文', '["旧标签"]', 1, 'manual', 1700000000000, 1700000000000)`
      )
      .run();

    const first = store.configureStrategyDir(dir);
    expect(first.imported).toBe(1);
    const exported = store.listStrategies();
    expect(exported[0]).toMatchObject({ title: '旧策略', content: '旧正文', tags: ['旧标签'] });

    // 再次配置（哪怕换了一个空目录）不会重复导出
    settings.updateSettings({ strategy: { dir, importedAt: Date.now() } });
    const other = join(root, 'other');
    expect(store.configureStrategyDir(other).imported).toBe(0);
    expect(existsSync(join(other, '旧策略.md'))).toBe(false);
  });
});
