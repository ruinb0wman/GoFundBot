import { logger } from '../core/logger.js';
import { setGlobalProxyUrl } from '../core/fetch.js';
import { getDb } from '../db/index.js';

/**
 * 应用设置，落 SQLite `settings` 表的单行 JSON（key = 'app'）。
 *
 * 两个子域：`proxy`（网络代理）与 `strategy`（策略记忆的 markdown 文件夹）。
 * service 不做 LLM 调用（pi 是唯一 AI），因此不存任何 API 密钥。
 */

export interface ProxySettings {
  url: string;
}

export interface StrategySettings {
  /** 策略文件夹绝对路径；空串 = 未配置（策略记忆不可用）。 */
  dir: string;
  /** 旧 SQLite 策略导出成 md 的时间戳；非空表示已导出过，不再重复导出。 */
  importedAt: number | null;
}

export interface AppSettings {
  proxy: ProxySettings;
  strategy: StrategySettings;
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
      _cache = {
        proxy: { url: parsed.proxy?.url ?? '' },
        strategy: {
          dir: parsed.strategy?.dir ?? '',
          importedAt: parsed.strategy?.importedAt ?? null,
        },
      };
    } catch (error) {
      logger.warn('settings row is not valid JSON; falling back to env default', {
        error: String(error),
      });
      _cache = { proxy: { url: envProxyUrl() }, strategy: { dir: '', importedAt: null } };
    }
  } else {
    _cache = { proxy: { url: envProxyUrl() }, strategy: { dir: '', importedAt: null } };
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
  return { proxy: { ...settings.proxy }, strategy: { ...settings.strategy } };
}

export function getProxySettings(): ProxySettings {
  return { ...load().proxy };
}

export function getStrategySettings(): StrategySettings {
  return { ...load().strategy };
}

/** 策略文件夹：settings 优先，其次 `GOFUND_STRATEGY_DIR`（默认没有目录 = 空串）。 */
export function getStrategyDir(): string {
  return load().strategy.dir || process.env.GOFUND_STRATEGY_DIR || '';
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = load();
  if (partial.proxy !== undefined) {
    current.proxy = { ...current.proxy, ...partial.proxy };
  }
  if (partial.strategy !== undefined) {
    current.strategy = { ...current.strategy, ...partial.strategy };
  }
  save(current);
  _applyProxy(current.proxy.url);
  logger.info('Settings updated', {
    proxy: current.proxy.url ? 'configured' : 'not configured',
    strategyDir: current.strategy.dir || 'not configured',
  });
  return getSettings();
}

function _applyProxy(url: string): void {
  setGlobalProxyUrl(url || null);
}

/** 测试用：丢弃内存缓存，下一次读取回到数据库。 */
export function resetSettingsCacheForTests(): void {
  _cache = null;
}
