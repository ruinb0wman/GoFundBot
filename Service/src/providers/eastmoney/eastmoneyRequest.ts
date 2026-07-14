import { request as httpsRequest } from 'node:https';
import { ProxyAgent } from 'undici';
import { AppError } from '../../core/errors.js';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  Referer: 'https://fund.eastmoney.com/',
  Accept: '*/*',
};

let _proxyDispatcher: any | undefined;

function readProxyUrl(): string | undefined {
  return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || undefined;
}

export function setProxyUrl(url: string | null): void {
  if (_proxyDispatcher && typeof _proxyDispatcher.close === 'function') {
    _proxyDispatcher.close().catch(() => {});
  }
  _proxyDispatcher = url ? new ProxyAgent(url) : undefined;
}

const BYPASS_HOST_PATTERNS = [
  /\.eastmoney\.com$/i,
  /\.eastmoneysec\.com$/i,
  /^localhost$/i,
  /^127\./,
];

function shouldBypassProxy(requestUrl: string): boolean {
  try {
    const hostname = new URL(requestUrl).hostname;
    if (BYPASS_HOST_PATTERNS.some(p => p.test(hostname))) return true;
    const noProxy = process.env.NO_PROXY || process.env.no_proxy || '';
    if (!noProxy) return false;
    for (const pattern of noProxy.split(',').map(p => p.trim())) {
      if (!pattern) continue;
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\./g, '\\.') + '$',
        'i'
      );
      if (regex.test(hostname)) return true;
    }
  } catch {}
  return false;
}

function getDispatcher(requestUrl?: string): any | undefined {
  if (requestUrl && shouldBypassProxy(requestUrl)) return undefined;
  if (_proxyDispatcher) return _proxyDispatcher;
  const proxyUrl = readProxyUrl();
  if (proxyUrl) {
    _proxyDispatcher = new ProxyAgent(proxyUrl);
    return _proxyDispatcher;
  }
  return undefined;
}

function fetchViaHttps(url: string, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: DEFAULT_HEADERS,
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            reject(new AppError('PROVIDER_UNAVAILABLE', `EastMoney HTTP ${res.statusCode}`, 502, { url, status: res.statusCode }));
            return;
          }
          resolve(data);
        });
      },
    );
    req.on('error', (err: Error) => reject(new AppError('PROVIDER_UNAVAILABLE', `EastMoney request failed: ${err.message}`, 502, { url })));
    req.on('timeout', () => { req.destroy(); reject(new AppError('PROVIDER_TIMEOUT', 'EastMoney request timed out', 504, { url })); });
    req.end();
  });
}

export async function fetchText(url: string, timeoutMs = 10000): Promise<string> {
  if (shouldBypassProxy(url)) {
    return fetchViaHttps(url, timeoutMs);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const dispatcher = getDispatcher(url);

  try {
    const response = await fetch(url, {
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });

    if (!response.ok) {
      throw new AppError('PROVIDER_UNAVAILABLE', `EastMoney HTTP ${response.status}`, 502, {
        url,
        status: response.status,
      });
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url: string, timeoutMs = 10000): Promise<Record<string, unknown>> {
  const text = await fetchText(url, timeoutMs);
  return JSON.parse(text) as Record<string, unknown>;
}

export function parseJsonpObject(text: string): Record<string, unknown> {
  const match = text.match(/^[^(]*\((.*)\)\s*;?\s*$/s);
  if (!match) {
    throw new Error('Invalid JSONP payload');
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

export function extractJsAssignment(script: string, variableName: string): string {
  const marker = `var ${variableName} =`;
  const start = script.indexOf(marker);
  if (start < 0) {
    throw new Error(`Missing EastMoney variable ${variableName}`);
  }

  const valueStart = start + marker.length;
  const end = script.indexOf(';', valueStart);
  if (end < 0) {
    throw new Error(`Missing semicolon for EastMoney variable ${variableName}`);
  }

  return script.slice(valueStart, end).trim();
}

export function parseJsJson<T>(script: string, variableName: string): T {
  return JSON.parse(extractJsAssignment(script, variableName)) as T;
}

export function parseJsString(script: string, variableName: string): string | null {
  const raw = extractJsAssignment(script, variableName);
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw.replace(/^['"]|['"]$/g, '') || null;
  }
}
