import { ProxyAgent } from 'undici';
import { AppError } from '../../core/errors.js';
import type { GlobalIndexDto, GlobalIndexListDto } from '../types.js';

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

export const GLOBAL_INDEX_DEFS: Array<{ code: string; name: string; yahooSymbol: string }> = [
  { code: 'NDX', name: '纳斯达克100', yahooSymbol: '^NDX' },
  { code: 'DJI', name: '道琼斯指数', yahooSymbol: '^DJI' },
  { code: 'SPX', name: '标普500', yahooSymbol: '^GSPC' },
  { code: 'HSI', name: '恒生指数', yahooSymbol: '^HSI' },
  { code: 'HSCEI', name: '国企指数', yahooSymbol: '^HSCE' },
  { code: 'N225', name: '日经225', yahooSymbol: '^N225' },
  { code: 'KS11', name: '韩国综合指数', yahooSymbol: '^KS11' },
  { code: 'FTSE', name: '英国富时100', yahooSymbol: '^FTSE' },
  { code: 'GDAXI', name: '德国DAX', yahooSymbol: '^GDAXI' },
  { code: 'FCHI', name: '法国CAC40', yahooSymbol: '^FCHI' },
  { code: 'SENSEX', name: '印度SENSEX', yahooSymbol: '^BSESN' },
];

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

async function fetchSingleGlobalQuote(def: { code: string; name: string; yahooSymbol: string }): Promise<GlobalIndexDto | null> {
  const maxRetries = 3;
  const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(def.yahooSymbol)}?range=1d&interval=1d`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);

      let text: string;
      try {
        const opts: any = {
          headers: { 'User-Agent': USER_AGENT },
          signal: controller.signal,
        };
        const d = getDispatcher();
        if (d) opts.dispatcher = d;
        const response = await fetch(url, opts);
        if (response.status === 429) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        if (!response.ok) return null;
        text = await response.text();
      } finally {
        clearTimeout(timer);
      }

      const payload = JSON.parse(text) as Record<string, unknown>;
      const chart = payload.chart as Record<string, unknown> | undefined;
      const resultArr = (chart?.result ?? []) as Record<string, unknown>[];
      if (!resultArr.length) return null;

      const meta = resultArr[0]?.meta as Record<string, unknown> | undefined;
      if (!meta) return null;

      const indicators = resultArr[0]?.indicators as Record<string, unknown> | undefined;
      const quoteArr = (indicators?.quote ?? []) as Record<string, unknown>[];
      const quote0 = quoteArr[0] ?? {};
      const opens = (quote0.open ?? []) as (number | null)[];

      const price = toNum(meta.regularMarketPrice);
      const prevClose = toNum(meta.chartPreviousClose);
      const open = opens[0] != null ? toNum(opens[0]) : null;
      const changeAmount = price != null && prevClose != null
        ? Math.round((price - prevClose) * 100) / 100 : null;
    const changePercent = price != null && prevClose != null && prevClose !== 0
      ? Math.round((changeAmount! / prevClose) * 10000) / 100 : null;

      return {
        code: def.code,
        name: def.name,
        price,
        changePercent,
        changeAmount,
        open,
        high: toNum(meta.regularMarketDayHigh),
        low: toNum(meta.regularMarketDayLow),
        prevClose,
        market: '全球',
      };
    } catch {
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  return null;
}

export async function fetchYahooGlobalIndices(): Promise<GlobalIndexListDto> {
  const results: GlobalIndexDto[] = [];
  const concurrency = 2;

  for (let i = 0; i < GLOBAL_INDEX_DEFS.length; i += concurrency) {
    const batch = GLOBAL_INDEX_DEFS.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map((def) => fetchSingleGlobalQuote(def)));
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      }
    }
  }

  return { items: results };
}
