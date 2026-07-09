import { ProxyAgent } from 'undici';
import { AppError } from '../../core/errors.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

const YAHOO_BASE = 'https://query1.finance.yahoo.com';

interface ChartPoint {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  timestamp: number | null;
}

export const YAHOO_SYMBOL_MAP: Record<string, string> = {
  gb_ixic: '^IXIC',
  gb_dji: '^DJI',
  gb_inx: '^GSPC',
  hkhsi: '^HSI',
  hkhscei: '^HSCE',
  b_nky: '^N225',
  b_ks11: '^KS11',
  b_ukx: '^FTSE',
  b_dax: '^GDAXI',
  b_cac: '^FCHI',
  b_sensex: '^BSESN',
};

const RANGE_MAP: Record<string, string> = {
  daily: '1y',
  weekly: '5y',
  monthly: 'max',
};

const INTERVAL_MAP: Record<string, string> = {
  daily: '1d',
  weekly: '1wk',
  monthly: '1mo',
};

let _dispatcher: ProxyAgent | undefined;

function getDispatcher(): ProxyAgent | undefined {
  if (_dispatcher !== undefined) return _dispatcher;
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  _dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  return _dispatcher;
}

function toYahooSymbol(symbol: string): string | null {
  const lower = symbol.replace(/^(sh|sz|bj)/i, '').toLowerCase();
  return YAHOO_SYMBOL_MAP[lower] ?? null;
}

export function isGlobalIndexSymbol(symbol: string): boolean {
  const lower = symbol.replace(/^(sh|sz|bj)/i, '').toLowerCase();
  return lower in YAHOO_SYMBOL_MAP;
}

function toNum(val: unknown): number | null {
  if (val == null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function parseDateNum(dateStr: string): number | null {
  const clean = dateStr.replace(/-/g, '');
  if (clean.length < 8) return null;
  const d = new Date(`${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`);
  return d.getTime();
}

export async function fetchYahooChart(
  symbol: string,
  period: string = 'daily',
  startDate?: string,
  endDate?: string,
): Promise<ChartPoint[]> {
  const yahooSymbol = toYahooSymbol(symbol);
  if (!yahooSymbol) {
    throw new AppError('INVALID_ARGUMENT', `Unsupported global index symbol: ${symbol}`, 400, { symbol });
  }

  const range = RANGE_MAP[period] || '1y';
  const interval = INTERVAL_MAP[period] || '1d';
  const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=${interval}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let text: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts: any = {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    };
    const d = getDispatcher();
    if (d) opts.dispatcher = d;
    const response = await fetch(url, opts);

    if (!response.ok) {
      throw new AppError('PROVIDER_UNAVAILABLE', `Yahoo Finance HTTP ${response.status}`, 502, {
        url,
        status: response.status,
      });
    }
    text = await response.text();
  } finally {
    clearTimeout(timer);
  }

  const payload = JSON.parse(text) as Record<string, unknown>;
  const chart = payload.chart as Record<string, unknown> | undefined;
  const resultArr = (chart?.result ?? []) as Record<string, unknown>[];
  if (!resultArr.length) {
    throw new AppError('PROVIDER_UNAVAILABLE', `Yahoo Finance returned empty result for ${symbol}`, 502, { symbol });
  }

  const result = resultArr[0];
  const timestamps: number[] = (result.timestamp ?? []) as number[];
  const indicators = result.indicators as Record<string, unknown> | undefined;
  const quoteArr = (indicators?.quote ?? []) as Record<string, unknown>[];
  const quote = quoteArr[0] ?? {};
  const opens = (quote.open ?? []) as (number | null)[];
  const highs = (quote.high ?? []) as (number | null)[];
  const lows = (quote.low ?? []) as (number | null)[];
  const closes = (quote.close ?? []) as (number | null)[];
  const volumes = (quote.volume ?? []) as (number | null)[];

  let points: ChartPoint[] = timestamps.map((ts, i) => ({
    timestamp: ts * 1000,
    open: opens[i] ?? null,
    high: highs[i] ?? null,
    low: lows[i] ?? null,
    close: closes[i] ?? null,
    volume: volumes[i] ?? null,
  }));

  if (startDate) {
    const start = parseDateNum(startDate);
    if (start) points = points.filter((p) => p.timestamp && p.timestamp >= start);
  }
  if (endDate) {
    const end = parseDateNum(endDate);
    if (end) points = points.filter((p) => p.timestamp && p.timestamp <= end);
  }

  return points;
}
