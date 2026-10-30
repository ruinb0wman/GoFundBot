/**
 * 策略记忆 —— 一个文件夹里的 markdown 文件（真源是磁盘，不是 SQLite）。
 *
 * 一个文件 = 一条策略：frontmatter 存元数据（`id`/`title`/`tags`/`active`/`source`/时间戳），
 * 正文就是 `content`。文件夹路径由 settings 配置（见 `settingsService.getStrategyDir()`），
 * 未配置时列表为空、写入报错（页面会引导去设置）。
 *
 * 关键约定：
 * - **`id` 在 frontmatter 里是真源，文件名随意**：外部改名不影响查找；标题改了也不改名。
 * - 用户丢进来的普通 md（无 frontmatter）也能读：`title` 取首个 `# 标题`，缺 `id` 时**读时补写**。
 * - 写入走「临时文件 + rename」原子替换，避免半截文件；未知的 frontmatter 键原样保留。
 * - 删除不 unlink，移到 `<目录>/.trash/`（读取忽略以 `.` 开头的文件）。
 */
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { getDb } from '../db/index.js';
import { getStrategyDir, getStrategySettings } from './settingsService.js';

export interface StrategyRecord {
  id: number;
  title: string;
  content: string;
  tags: string[];
  active: number;
  source: 'manual' | 'ai-draft';
  createdAt: number;
  updatedAt: number;
}

export interface StrategyInput {
  title: string;
  content: string;
  tags?: string[];
  active?: number;
  source?: 'manual' | 'ai-draft';
}

type Meta = Record<string, unknown>;

const KNOWN_KEYS = ['id', 'title', 'tags', 'active', 'source', 'createdAt', 'updatedAt'];
const MARKDOWN = /\.md$/i;

// ── frontmatter ──────────────────────────────────────────────────────────────

/** 极简 YAML 子集：`key: value`、`key: [a, b]`、`key:` + `- item`。够用就好，不引依赖。 */
function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (!value) return '';
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => String(parseScalar(item)))
      .filter((item) => item !== '');
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseMeta(text: string): Meta {
  const meta: Meta = {};
  let listKey: string | null = null;
  for (const line of text.split('\n')) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (meta[listKey] as unknown[]).push(parseScalar(item[1]));
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) {
      listKey = null;
      continue;
    }
    if (pair[2].trim() === '') {
      meta[pair[1]] = [];
      listKey = pair[1];
    } else {
      meta[pair[1]] = parseScalar(pair[2]);
      listKey = null;
    }
  }
  return meta;
}

function quote(value: string): string {
  return /[:#[\]{}",'\n]|^\s|\s$|^-/.test(value) ? JSON.stringify(value) : value;
}

function renderScalar(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => quote(String(item))).join(', ')}]`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return quote(String(value ?? ''));
}

function splitFrontmatter(raw: string): { text: string | null; body: string } {
  if (!raw.startsWith('---')) return { text: null, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { text: null, body: raw };
  return { text: raw.slice(4, end), body: raw.slice(end + 4).replace(/^\r?\n/, '') };
}

function renderFile(meta: Meta, body: string): string {
  const extraKeys = Object.keys(meta).filter((key) => !KNOWN_KEYS.includes(key));
  const keys = [...KNOWN_KEYS, ...extraKeys].filter((key) => meta[key] !== undefined);
  const lines = keys.map((key) => `${key}: ${renderScalar(meta[key])}`);
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`;
}

// ── 读写 ─────────────────────────────────────────────────────────────────────

interface Entry {
  name: string;
  meta: Meta;
  rec: StrategyRecord;
}

function requireDir(): string {
  const dir = getStrategyDir();
  if (!dir) {
    throw new AppError(
      'INVALID_ARGUMENT',
      '策略文件夹未配置：请在「策略研究」页右上角设置一个绝对路径',
      400,
      { strategyDirRequired: true }
    );
  }
  return dir;
}

function listMarkdown(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MARKDOWN.test(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

function toMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function firstHeading(body: string): string | null {
  const match = /^#{1,6}\s+(.+)$/m.exec(body);
  return match ? match[1].trim() : null;
}

function writeRecord(dir: string, name: string, rec: StrategyRecord, extra: Meta): void {
  const meta: Meta = {
    ...extra,
    id: rec.id,
    title: rec.title,
    tags: rec.tags,
    active: rec.active,
    source: rec.source,
    createdAt: new Date(rec.createdAt).toISOString(),
    updatedAt: new Date(rec.updatedAt).toISOString(),
  };
  const target = join(dir, name);
  const temp = `${target}.tmp-${process.pid}`;
  writeFileSync(temp, renderFile(meta, rec.content), 'utf8');
  renameSync(temp, target);
}

function uniqueName(dir: string, title: string): string {
  const base =
    title
      .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || '策略';
  let name = `${base}.md`;
  for (let n = 2; existsSync(join(dir, name)); n += 1) name = `${base}-${n}.md`;
  return name;
}

/** 缺 id / id 重复的文件在读时补写（用户手写的 md 直接能用）。 */
function assignIds(dir: string, entries: Entry[]): void {
  const seen = new Set<number>();
  let max = 0;
  for (const entry of entries) max = Math.max(max, entry.rec.id);
  for (const entry of entries) {
    if (entry.rec.id > 0 && !seen.has(entry.rec.id)) {
      seen.add(entry.rec.id);
      continue;
    }
    max += 1;
    seen.add(max);
    const rec = { ...entry.rec, id: max };
    try {
      writeRecord(dir, entry.name, rec, entry.meta);
    } catch (error) {
      logger.warn('strategy file not writable; id will be reassigned next read', {
        file: entry.name,
        error: String(error),
      });
    }
    entry.rec = rec;
  }
}

function readEntries(dir: string): Entry[] {
  const entries: Entry[] = [];
  for (const name of listMarkdown(dir)) {
    const path = join(dir, name);
    let raw: string;
    let mtime = Date.now();
    try {
      raw = readFileSync(path, 'utf8');
      mtime = Math.round(statSync(path).mtimeMs);
    } catch (error) {
      logger.warn('strategy file unreadable; skipped', { file: name, error: String(error) });
      continue;
    }
    const { text, body } = splitFrontmatter(raw);
    const meta = text === null ? {} : parseMeta(text);
    const tags = Array.isArray(meta.tags)
      ? meta.tags.map(String)
      : typeof meta.tags === 'string' && meta.tags.trim()
        ? [meta.tags.trim()]
        : [];
    entries.push({
      name,
      meta,
      rec: {
        id: Number(meta.id) > 0 ? Math.floor(Number(meta.id)) : 0,
        title: String(meta.title ?? '').trim() || firstHeading(body) || name.replace(MARKDOWN, ''),
        content: body.trim(),
        tags,
        active: meta.active === 0 || meta.active === '0' || meta.active === false ? 0 : 1,
        source: meta.source === 'ai-draft' ? 'ai-draft' : 'manual',
        createdAt: toMs(meta.createdAt) ?? mtime,
        updatedAt: toMs(meta.updatedAt) ?? mtime,
      },
    });
  }
  assignIds(dir, entries);
  return entries;
}

// ── 对外 API（与旧 SQLite 版同签名）───────────────────────────────────────────

/** 未配置文件夹时返回空数组（页面据此提示去设置）。 */
export function isStrategyDirConfigured(): boolean {
  return getStrategyDir() !== '';
}

export function listStrategies(): StrategyRecord[] {
  const dir = getStrategyDir();
  if (!dir) return [];
  return readEntries(dir)
    .map((entry) => entry.rec)
    .sort((a, b) => b.active - a.active || b.updatedAt - a.updatedAt);
}

export function addStrategy(input: StrategyInput): StrategyRecord {
  const dir = requireDir();
  const now = Date.now();
  const rec: StrategyRecord = {
    id: Math.max(0, ...readEntries(dir).map((entry) => entry.rec.id)) + 1,
    title: String(input.title ?? '').trim() || '未命名策略',
    content: String(input.content ?? '').trim(),
    tags: (input.tags ?? []).filter(Boolean),
    active: input.active ?? 1,
    source: input.source ?? 'manual',
    createdAt: now,
    updatedAt: now,
  };
  writeRecord(dir, uniqueName(dir, rec.title), rec, {});
  return rec;
}

export function updateStrategy(id: number, patch: Partial<StrategyInput>): StrategyRecord | null {
  const dir = requireDir();
  const found = readEntries(dir).find((entry) => entry.rec.id === id);
  if (!found) return null;
  const before = found.rec;
  const next: StrategyRecord = {
    ...before,
    title: patch.title !== undefined ? String(patch.title).trim() || '未命名策略' : before.title,
    content: patch.content !== undefined ? String(patch.content).trim() : before.content,
    tags: patch.tags !== undefined ? patch.tags.filter(Boolean) : before.tags,
    active: patch.active !== undefined ? patch.active : before.active,
    source: patch.source ?? before.source,
    updatedAt: Date.now(),
  };
  writeRecord(dir, found.name, next, found.meta);
  return next;
}

export function removeStrategy(id: number): void {
  const dir = requireDir();
  const found = readEntries(dir).find((entry) => entry.rec.id === id);
  if (!found) return;
  const trash = join(dir, '.trash');
  mkdirSync(trash, { recursive: true });
  const target = join(trash, `${found.name.replace(MARKDOWN, '')}.${Date.now()}.md`);
  renameSync(join(dir, found.name), target);
}

/**
 * 配置文件夹时调用：建目录、校验可写、把旧 SQLite `strategies` 表一次性导成 md。
 * 导出只做一次（`settings.strategy.importedAt` 记标记），表本身保留当备份、之后不再读。
 */
export function configureStrategyDir(dir: string): { imported: number } {
  mkdirSync(dir, { recursive: true });
  accessSync(dir, constants.W_OK);
  if (getStrategySettings().importedAt || listMarkdown(dir).length > 0) return { imported: 0 };

  const rows = getDb()
    .prepare('SELECT * FROM strategies ORDER BY id ASC')
    .all() as Record<string, unknown>[];
  let imported = 0;
  let max = 0;
  for (const row of rows) {
    const createdAt = toMs(row.created_at) ?? Date.now();
    const rec: StrategyRecord = {
      id: Number(row.id) > 0 ? Number(row.id) : max + 1,
      title: String(row.title ?? '').trim() || '未命名策略',
      content: String(row.content ?? '').trim(),
      tags: (() => {
        try {
          const parsed = JSON.parse(String(row.tags ?? '[]')) as unknown;
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          return [];
        }
      })(),
      active: Number(row.active) ? 1 : 0,
      source: row.source === 'ai-draft' ? 'ai-draft' : 'manual',
      createdAt,
      updatedAt: toMs(row.updated_at) ?? createdAt,
    };
    writeRecord(dir, uniqueName(dir, rec.title), rec, {});
    max = Math.max(max, rec.id);
    imported += 1;
  }
  if (imported > 0) logger.info('strategies exported from sqlite to folder', { dir, imported });
  return { imported };
}
