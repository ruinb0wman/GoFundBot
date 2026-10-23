import { fetchUrl } from '../../core/fetch.js';

/**
 * 指数估值取数（蛋卷 / 雪球系 `djapi`）。
 *
 * 为什么只有这一个源（`.pi/plans/index-valuation-feasibility.md` §3–4）：
 * 乐咕是**月频 + 全历史 + 等权/加权两套口径**、中证官方只给最近 20 个交易日、
 * 韭圈儿要签名。换源会让「分位点」和「机会/中位/危险值」跨源不可比，
 * 所以宁可只支持它收录的指数，也不混两个源取平均。
 */

const HISTORY_URL = 'https://danjuanfunds.com/djapi/index_eva/pe_history';

export interface ValuationPoint {
  /** 北京时间 00:00 的毫秒时间戳 */
  ts: number;
  pe: number;
}

interface PeHistoryResponse {
  data?: Record<string, unknown>;
}

/** `sh000300` → `SH000300`；非 A 股 sh/sz 指数返回 null（海外/加密/北交所无估值数据）。 */
export function toDanjuanCode(symbol: string): string | null {
  const matched = /^(sh|sz)(\d{6})$/i.exec(symbol.trim());
  if (!matched) return null;
  return `${matched[1].toUpperCase()}${matched[2]}`;
}

/**
 * 直连优先，失败退一次代理（与 `binanceClient.ts` 同款）。
 * 国内站但 CDN 偶尔挑线路，单次 6s/8s 超时，失败由 service 层降级为 `unavailable`。
 */
async function danjuanGet<T>(url: string): Promise<T> {
  try {
    return await fetchUrl<T>(url, {
      timeoutMs: 6000,
      proxy: 'never',
      as: 'json',
      headers: { Accept: 'application/json' },
    });
  } catch (directError) {
    try {
      return await fetchUrl<T>(url, {
        timeoutMs: 8000,
        proxy: 'auto',
        as: 'json',
        headers: { Accept: 'application/json' },
      });
    } catch {
      throw directError;
    }
  }
}

/** 数字宽容解析：`Number(null)` 是 0，所以必须先挡掉 null/空串（否则脏行会变成 pe=0）。 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * 取周频 PE 历史，按时间升序。该指数未被收录时返回 `[]`（不是错误）。
 * 未收录的典型：`SH000001 上证指数`、`SH000510 中证A500`、`SH000698 科创100`。
 */
export async function fetchIndexPeHistory(symbol: string): Promise<ValuationPoint[]> {
  const sourceCode = toDanjuanCode(symbol);
  if (!sourceCode) return [];

  const body = await danjuanGet<PeHistoryResponse>(
    `${HISTORY_URL}/${sourceCode}?day=all`,
  );

  // 未收录时只有 `{"result_code":0}`（没有 data），也可能给一个空数组。
  const groups = (body?.data ?? {}) as Record<string, unknown>;
  const rows = Object.values(groups).find((value): value is unknown[] => Array.isArray(value));
  if (!rows) return [];

  const points: ValuationPoint[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { pe, ts } = row as { pe?: unknown; ts?: unknown };
    const value = toNumber(pe);
    const timestamp = toNumber(ts);
    if (value == null || timestamp == null) continue;
    points.push({ ts: timestamp, pe: value });
  }

  return points.sort((a, b) => a.ts - b.ts);
}
