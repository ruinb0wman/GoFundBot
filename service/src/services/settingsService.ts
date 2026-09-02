import { logger } from '../core/logger.js';
import { setGlobalProxyUrl } from '../core/fetch.js';

/**
 * 最小后端设置：仅保留 Proxy URL（供前端下发后 Node 抓取使用）。
 * LLM/Search key 已迁移至前端本地存储（Dexie/localStorage）。
 */

export interface ProxySettings {
  url: string;
}

export interface AppSettings {
  proxy: ProxySettings;
}

const defaultSettings: AppSettings = {
  proxy: {
    url: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '',
  },
};

let _cache: AppSettings = { ...defaultSettings, proxy: { ...defaultSettings.proxy } };
_applyProxy(_cache.proxy.url);

export function getSettings(): AppSettings {
  return { proxy: { ..._cache.proxy } };
}

export function getProxySettings(): ProxySettings {
  return { ..._cache.proxy };
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  if (partial.proxy !== undefined) {
    _cache.proxy = { ..._cache.proxy, ...partial.proxy };
    _applyProxy(_cache.proxy.url);
  }
  logger.info('Settings updated', { proxy: _cache.proxy.url ? 'configured' : 'not configured' });
  return { proxy: { ..._cache.proxy } };
}

function _applyProxy(url: string): void {
  setGlobalProxyUrl(url || null);
}
