import { fetchUrl } from '../../core/fetch.js';
import type { GlobalIndexDto, GlobalIndexListDto } from '../types.js';
import { CRYPTO_DEFS, findCryptoDef } from '../globalIndexDefs.js';

const BINANCE_BASE = 'https://api.binance.com';

/**
 * 加密货币取数（Binance 现货）。
 *
 * 为什么从 Yahoo 换成 Binance（`.pi/plans/global-market-sources.md` §1.2）：
 * 2026-10-09 实测 Yahoo 在这台机器上**直连与代理都不通**（15.8s 超时），而
 * `api.binance.com` **直连 0.75s 可用**。原实现 4 个代码 2 批 × 15s = 30.00s，
 * 与日志里 `/api/market/crypto` 的 30 次 30.00s 完全吻合。
 */

export interface CryptoCandle {
  timestamp: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

interface BinanceTicker {
  symbol?: string;
  lastPrice?: string;
  priceChange?: string;
  priceChangePercent?: string;
  prevClosePrice?: string;
  openPrice?: string;
  highPrice?: string;
  lowPrice?: string;
  closeTime?: number;
}

const INTERVAL_MAP: Record<string, string> = {
  daily: '1d',
  weekly: '1w',
  monthly: '1M',
};

/** 直连优先（实测可用）；被墙时退一次代理，仍失败则把原始错误抛给上层降级。 */
async function binanceGet<T>(path: string): Promise<T> {
  try {
    return await fetchUrl<T>(`${BINANCE_BASE}${path}`, {
      timeoutMs: 6000,
      proxy: 'never',
      as: 'json',
      headers: { Accept: 'application/json' },
    });
  } catch (directError) {
    try {
      return await fetchUrl<T>(`${BINANCE_BASE}${path}`, {
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

export async function fetchBinanceCryptoQuotes(): Promise<GlobalIndexListDto> {
  const symbols = JSON.stringify(CRYPTO_DEFS.map((def) => def.binanceSymbol));
  const tickers = await binanceGet<BinanceTicker[]>(
    `/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbols)}`,
  );

  const bySymbol = new Map((tickers ?? []).map((ticker) => [ticker.symbol ?? '', ticker]));
  const items: GlobalIndexDto[] = [];

  // 按 CRYPTO_DEFS 的顺序输出，保证卡片顺序稳定（Binance 返回顺序不保证）。
  for (const def of CRYPTO_DEFS) {
    const ticker = bySymbol.get(def.binanceSymbol);
    if (!ticker) continue;

    const price = num(ticker.lastPrice);
    if (price == null) continue;

    const closeTime = Number(ticker.closeTime);
    const iso = Number.isFinite(closeTime) && closeTime > 0 ? new Date(closeTime).toISOString() : '';

    items.push({
      code: def.code,
      name: def.name,
      price,
      changePercent: round2(num(ticker.priceChangePercent)),
      changeAmount: round2(num(ticker.priceChange)),
      open: num(ticker.openPrice),
      high: num(ticker.highPrice),
      low: num(ticker.lowPrice),
      prevClose: num(ticker.prevClosePrice),
      market: '加密货币',
      date: iso.slice(0, 10),
      updateTime: iso,
    });
  }

  return { items };
}

export async function fetchBinanceCryptoKline(
  code: string,
  options: { period: string; startDate?: string; endDate?: string },
): Promise<CryptoCandle[]> {
  const def = findCryptoDef(code);
  if (!def) return [];

  const interval = INTERVAL_MAP[options.period] ?? '1d';
  const params = new URLSearchParams({ symbol: def.binanceSymbol, interval });

  const start = toDayStartMs(options.startDate);
  const end = toDayEndMs(options.endDate);
  if (start != null) params.set('startTime', String(start));
  if (end != null) params.set('endTime', String(end));
  params.set('limit', String(klineLimit(options.period, start, end)));

  const rows = await binanceGet<unknown[][]>(`/api/v3/klines?${params.toString()}`);

  return (rows ?? [])
    .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 6)
    .map((row) => ({
      timestamp: num(row[0]),
      open: num(row[1]),
      high: num(row[2]),
      low: num(row[3]),
      close: num(row[4]),
      volume: num(row[5]),
    }));
}

function klineLimit(period: string, start: number | null, end: number | null): number {
  if (start != null && end != null) {
    const days = Math.ceil((end - start) / 86400000);
    return Math.min(1000, Math.max(10, days + 5));
  }
  return period === 'daily' ? 320 : 200;
}

function toDayStartMs(value?: string): number | null {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (digits.length !== 8) return null;
  const ms = new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T00:00:00Z`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toDayEndMs(value?: string): number | null {
  const start = toDayStartMs(value);
  return start == null ? null : start + 86399999;
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value: number | null): number | null {
  return value == null ? null : Math.round(value * 100) / 100;
}
