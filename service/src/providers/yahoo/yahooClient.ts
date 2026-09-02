import { AppError } from '../../core/errors.js';
import { fetchUrl } from '../../core/fetch.js';
import type { GlobalIndexDto, GlobalIndexListDto } from '../types.js';

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

export const CRYPTO_DEFS: Array<{ code: string; name: string; yahooSymbol: string; icon: string }> = [
  { code: 'BTC', name: '比特币', yahooSymbol: 'BTC-USD', icon: '₿' },
  { code: 'ETH', name: '以太坊', yahooSymbol: 'ETH-USD', icon: 'Ξ' },
  { code: 'SOL', name: 'Solana', yahooSymbol: 'SOL-USD', icon: '◎' },
  { code: 'BNB', name: '币安币', yahooSymbol: 'BNB-USD', icon: '◆' },
];

export const CODE_TO_YAHOO_MAP: Record<string, string> = Object.fromEntries(
  GLOBAL_INDEX_DEFS.map(d => [d.code.toLowerCase(), d.yahooSymbol])
);

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

function toYahooSymbol(symbol: string): string | null {
  const lower = symbol.replace(/^(sh|sz|bj)/i, '').toLowerCase();
  return YAHOO_SYMBOL_MAP[lower] ?? CODE_TO_YAHOO_MAP[lower] ?? null;
}

export function isGlobalIndexSymbol(symbol: string): boolean {
  const lower = symbol.replace(/^(sh|sz|bj)/i, '').toLowerCase();
  return lower in YAHOO_SYMBOL_MAP || lower in CODE_TO_YAHOO_MAP;
}

function getRangeForYears(years: number): string {
  if (years <= 1) return '1y';
  if (years <= 2) return '2y';
  if (years <= 5) return '5y';
  if (years <= 10) return '10y';
  return 'max';
}

function toNum(val: unknown): number | null {
  if (val == null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function toQuoteDate(val: unknown): string {
  const ts = toNum(val);
  if (!ts) return '';
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function toQuoteTime(val: unknown): string {
  const ts = toNum(val);
  if (!ts) return '';
  const iso = new Date(ts * 1000).toISOString();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(iso) ? iso : '';
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
  return fetchYahooChartBySymbol(yahooSymbol, symbol, period, startDate, endDate);
}

async function fetchYahooChartBySymbol(
  yahooSymbol: string,
  displaySymbol: string,
  period: string = 'daily',
  startDate?: string,
  endDate?: string,
): Promise<ChartPoint[]> {
  const interval = INTERVAL_MAP[period] || '1d';

  let range: string;
  if (startDate) {
    const start = parseDateNum(startDate);
    if (start) {
      const yearsNeeded = (Date.now() - start) / (365.25 * 24 * 60 * 60 * 1000);
      range = getRangeForYears(yearsNeeded);
    } else {
      range = RANGE_MAP[period] || '1y';
    }
  } else {
    range = RANGE_MAP[period] || '1y';
  }

  const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=${interval}`;

  const text = await fetchUrl(url, {
    timeoutMs: 15000,
    proxy: 'auto',
    headers: { 'Referer': 'https://finance.yahoo.com/' },
  });

  const payload = JSON.parse(text) as Record<string, unknown>;
  const chart = payload.chart as Record<string, unknown> | undefined;
  const resultArr = (chart?.result ?? []) as Record<string, unknown>[];
  if (!resultArr.length) {
    throw new AppError('PROVIDER_UNAVAILABLE', `Yahoo Finance returned empty result for ${displaySymbol}`, 502, { symbol: displaySymbol });
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
      let text: string;
      try {
        text = await fetchUrl(url, {
          timeoutMs: 15000,
          proxy: 'auto',
          headers: { 'Referer': 'https://finance.yahoo.com/' },
        });
      } catch (error: any) {
        if (error?.message?.includes('429')) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return null;
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
        date: toQuoteDate(meta.regularMarketTime),
        updateTime: toQuoteTime(meta.regularMarketTime),
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

export async function fetchGlobalIndexQuoteByCode(code: string): Promise<GlobalIndexDto | null> {
  const def = GLOBAL_INDEX_DEFS.find(d => d.code === code.toUpperCase());
  if (!def) return null;
  return fetchSingleGlobalQuote(def);
}

export async function fetchCryptoQuotes(): Promise<GlobalIndexListDto> {
  const results: GlobalIndexDto[] = [];
  const concurrency = 2;

  for (let i = 0; i < CRYPTO_DEFS.length; i += concurrency) {
    const batch = CRYPTO_DEFS.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((def) => fetchSingleGlobalQuote({ code: def.code, name: def.name, yahooSymbol: def.yahooSymbol }))
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push({
          ...r.value,
          market: '加密货币',
        });
      }
    }
  }

  return { items: results };
}

export async function fetchCryptoKline(symbol: string, period: string = 'daily'): Promise<ChartPoint[]> {
  const def = CRYPTO_DEFS.find(d => d.code === symbol.toUpperCase());
  if (!def) {
    throw new AppError('INVALID_ARGUMENT', `Unsupported crypto symbol: ${symbol}`, 400, { symbol });
  }
  return fetchYahooChartBySymbol(def.yahooSymbol, def.code, period);
}

export function isCryptoSymbol(symbol: string): boolean {
  return CRYPTO_DEFS.some(d => d.code === symbol.toUpperCase());
}
