import { AppError } from '../../core/errors.js';
import { fetchUrl } from '../../core/fetch.js';
import { logger } from '../../core/logger.js';

/**
 * 东财全系域名（`fund.eastmoney.com`、`push2*`、`datacenter-web`、`newsapi` …）都是**国内接口**，
 * 一律 `proxy: 'never'` 真直连。
 *
 * 这里曾经写的是 `proxy: 'auto'`（走代理），后果很贵：本机代理出口下 `push2/push2his/91.push2`
 * 全部被 RST，板块因此长期靠 akshare 降级（一天 142 次 Python spawn），`breadth` 直接空数据。
 * 实测直连这些域名全部可达（见 `.pi/plans/push2-resilience.md` §1.3）。
 */
export async function fetchText(
  url: string,
  timeoutMs = 10000,
  referer = 'https://fund.eastmoney.com/'
): Promise<string> {
  return fetchUrlWithBreaker(url, timeoutMs, referer);
}

// ---------------------------------------------------------------------------
// 端点级熔断
//
// push2 是限流式的：一旦进入被拒窗口，每个请求都要等满超时才降级。熔断把「反复撞死路」
// 变成「3 次之后 60s 内直接快速失败」，让上层立刻落到 akshare / tencent。
// ---------------------------------------------------------------------------

const BREAKER_FAILURE_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

interface BreakerState {
  failures: number;
  openUntil: number;
}

const breakers = new Map<string, BreakerState>();

/** 熔断粒度 = `host + pathname`：`push2/.../ulist.np/get` 挂了不能连累同 host 的 `clist/get`。 */
function breakerKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function fetchUrlWithBreaker(url: string, timeoutMs: number, referer: string): Promise<string> {
  const key = breakerKey(url);
  const state = breakers.get(key);
  if (state && state.openUntil > Date.now()) {
    throw new AppError('PROVIDER_UNAVAILABLE', `eastmoney endpoint is cooling down: ${key}`, 503, {
      endpoint: key,
      openUntil: new Date(state.openUntil).toISOString(),
    });
  }

  try {
    const text = await fetchUrl<string>(url, { timeoutMs, proxy: 'never', headers: { Referer: referer } });
    if (state && (state.failures > 0 || state.openUntil > 0)) {
      breakers.delete(key);
    }
    return text;
  } catch (error) {
    const next: BreakerState = { failures: (state?.failures ?? 0) + 1, openUntil: state?.openUntil ?? 0 };
    if (next.failures >= BREAKER_FAILURE_THRESHOLD && next.openUntil <= Date.now()) {
      next.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
      logger.warn('eastmoney breaker open', {
        endpoint: key,
        failures: next.failures,
        cooldownMs: BREAKER_COOLDOWN_MS,
      });
    }
    breakers.set(key, next);
    throw error;
  }
}

/** 测试用：清空熔断状态。 */
export function resetEastmoneyBreakers(): void {
  breakers.clear();
}

export async function fetchJson(
  url: string,
  timeoutMs = 10000,
  referer?: string
): Promise<Record<string, unknown>> {
  const text = await fetchText(url, timeoutMs, referer);
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
