import { logger } from '../core/logger.js';
import { setGlobalProxyUrl } from '../core/fetch.js';
import { getDb } from '../db/index.js';

/**
 * 应用设置，落 SQLite `settings` 表的单行 JSON（key = 'app'）。
 *
 * 当前只有 proxy 子域：service 不做 LLM 调用（pi 是唯一 AI），
 * 因此不存任何 API 密钥。
 */

export interface ProxySettings {
  url: string;
}

export interface AppSettings {
  proxy: ProxySettings;
}

const SETTINGS_KEY = 'app';

/** 无持久化记录时的默认值：沿用环境变量里的代理。 */
function envProxyUrl(): string {
  return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
}

let _cache: AppSettings | null = null;

function load(): AppSettings {
  if (_cache) return _cache;

  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY) as
    | { value: string }
    | undefined;

  if (row) {
    try {
      const parsed = JSON.parse(row.value) as Partial<AppSettings>;
      _cache = { proxy: { url: parsed.proxy?.url ?? '' } };
    } catch (error) {
      logger.warn('settings row is not valid JSON; falling back to env default', {
        error: String(error),
      });
      _cache = { proxy: { url: envProxyUrl() } };
    }
  } else {
    _cache = { proxy: { url: envProxyUrl() } };
  }

  _applyProxy(_cache.proxy.url);
  return _cache;
}

function save(settings: AppSettings): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(SETTINGS_KEY, JSON.stringify(settings), Date.now());
}

export function getSettings(): AppSettings {
  const settings = load();
  return { proxy: { ...settings.proxy } };
}

export function getProxySettings(): ProxySettings {
  return { ...load().proxy };
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = load();
  if (partial.proxy !== undefined) {
    current.proxy = { ...current.proxy, ...partial.proxy };
  }
  save(current);
  _applyProxy(current.proxy.url);
  logger.info('Settings updated', { proxy: current.proxy.url ? 'configured' : 'not configured' });
  return getSettings();
}

function _applyProxy(url: string): void {
  setGlobalProxyUrl(url || null);
}

/** 测试用：丢弃内存缓存，下一次读取回到数据库。 */
export function resetSettingsCacheForTests(): void {
  _cache = null;
}
