import { logger } from '../core/logger.js';
import { setGlobalProxyUrl } from '../core/fetch.js';

export interface LlmSettings {
  apiKey: string;
  apiBase: string;
  model: string;
}

export interface ProxySettings {
  url: string;
}

export interface SearchSettings {
  bochaKey: string;
  tavilyKey: string;
}

export interface JoinquantSettings {
  apiKey: string;
}

export interface AppSettings {
  llm: LlmSettings;
  proxy: ProxySettings;
  search: SearchSettings;
  joinquant: JoinquantSettings;
}

const defaultSettings: AppSettings = {
  llm: {
    apiKey: '',
    apiBase: process.env.LLM_API_BASE || 'https://api.siliconflow.cn/v1',
    model: process.env.LLM_MODEL || 'Qwen/Qwen2.5-7B-Instruct',
  },
  proxy: {
    url: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '',
  },
  search: {
    bochaKey: process.env.BOCHA_API_KEY || '',
    tavilyKey: process.env.TAVILY_API_KEY || '',
  },
  joinquant: {
    apiKey: process.env.JOINQUANT_API_KEY || '',
  },
};

let _cache: AppSettings = { ...defaultSettings };
_applyProxy(_cache.proxy.url);

export function getSettings(): AppSettings {
  return { ..._cache };
}

export function getLlmSettings(): LlmSettings {
  return { ..._cache.llm };
}

export function getSearchSettings(): SearchSettings {
  return { ..._cache.search };
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  if (partial.llm !== undefined) {
    _cache.llm = { ..._cache.llm, ...partial.llm };
  }
  if (partial.proxy !== undefined) {
    _cache.proxy = { ..._cache.proxy, ...partial.proxy };
    _applyProxy(_cache.proxy.url);
  }
  if (partial.search !== undefined) {
    _cache.search = { ..._cache.search, ...partial.search };
  }
  if (partial.joinquant !== undefined) {
    _cache.joinquant = { ..._cache.joinquant, ...partial.joinquant };
  }
  logger.info('Settings updated', {
    llm: _cache.llm.apiKey ? 'configured' : 'not configured',
    proxy: _cache.proxy.url ? 'configured' : 'not configured',
    search: {
      bocha: _cache.search.bochaKey ? 'configured' : 'not configured',
      tavily: _cache.search.tavilyKey ? 'configured' : 'not configured',
    },
  });
  return { ..._cache };
}

function _applyProxy(url: string): void {
  setGlobalProxyUrl(url || null);
}
