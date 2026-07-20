import { AppError } from '../../core/errors.js';
import { fetchUrl } from '../../core/fetch.js';

export async function fetchText(url: string, timeoutMs = 10000): Promise<string> {
  return fetchUrl<string>(url, { timeoutMs, proxy: 'never', headers: { 'Referer': 'https://fund.eastmoney.com/' } });
}

export async function fetchJson(url: string, timeoutMs = 10000): Promise<Record<string, unknown>> {
  const text = await fetchText(url, timeoutMs);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AppError('PROVIDER_UNAVAILABLE', 'Invalid JSON response', 502, { url });
  }
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
