import { ProxyAgent } from 'undici';
import { AppError } from './errors.js';

export type ProxyMode = 'auto' | 'always' | 'never';

export interface FetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  proxy?: ProxyMode;
  encoding?: 'utf8' | 'gbk';
  as?: 'text' | 'json';
}

let _proxyDispatcher: any | undefined;

export function setGlobalProxyUrl(url: string | null): void {
  if (_proxyDispatcher && typeof _proxyDispatcher.close === 'function') {
    _proxyDispatcher.close().catch(() => {});
  }
  _proxyDispatcher = url ? new ProxyAgent(url) : undefined;
  if (url) {
    process.env.HTTPS_PROXY = url;
    process.env.HTTP_PROXY = url;
  } else {
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
  }
}

function getDispatcher(proxy: ProxyMode): any | undefined {
  switch (proxy) {
    case 'never':
      return undefined;
    case 'always':
      if (_proxyDispatcher) return _proxyDispatcher;
      {
        const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
        if (proxyUrl) {
          _proxyDispatcher = new ProxyAgent(proxyUrl);
          return _proxyDispatcher;
        }
      }
      throw new AppError('INTERNAL_ERROR', 'Proxy mode is "always" but no proxy URL configured', 500);
    case 'auto':
    default:
      if (_proxyDispatcher) return _proxyDispatcher;
      {
        const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
        if (proxyUrl) {
          _proxyDispatcher = new ProxyAgent(proxyUrl);
          return _proxyDispatcher;
        }
      }
      return undefined;
  }
}

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  Accept: '*/*',
};

export async function fetchUrl<T = string>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 15000,
    proxy = 'auto',
    encoding = 'utf8',
    as = 'text',
  } = options;

  const dispatcher = getDispatcher(proxy);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: { ...DEFAULT_HEADERS, ...headers },
      body: body ?? undefined,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });

    if (!response.ok) {
      throw new AppError('PROVIDER_UNAVAILABLE', `HTTP ${response.status}`, 502, {
        url,
        status: response.status,
      });
    }

    if (as === 'json') {
      return (await response.json()) as T;
    }

    if (encoding === 'gbk') {
      const buffer = await response.arrayBuffer();
      return new TextDecoder('gbk').decode(buffer) as T;
    }

    return (await response.text()) as T;
  } finally {
    clearTimeout(timer);
  }
}
