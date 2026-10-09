import { AppError } from '../../core/errors.js';
import { fetchUrl } from '../../core/fetch.js';
import type { GlobalIndexDto, GlobalIndexListDto } from '../types.js';
import {
  CODE_TO_YAHOO_MAP,
  GLOBAL_INDEX_DEFS,
  LEGACY_GLOBAL_SYMBOL_MAP,
} from '../globalIndexDefs.js';

const YAHOO_BASE = 'https://query1.finance.yahoo.com';

interface ChartPoint {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  timestamp: number | null;
}

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
  return LEGACY_GLOBAL_SYMBOL_MAP[lower] ?? CODE_TO_YAHOO_MAP[lower] ?? null;
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

  // 同 `fetchSingleGlobalQuote`：3500ms（曾经 15000）。这条路径现在只服务
  // 「腾讯未收录的海外指数」兜底（如 N225），超时拉长只会把「拿不到」变成「卡 15s」。
  const text = await fetchUrl(url, {
    timeoutMs: 3500,
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

/**
 * 单只 Yahoo 报价。
 *
 * `timeoutMs` 默认 **3500ms**（曾经 15000）：Yahoo 在本机直连与代理都不通（见
 * `.pi/plans/global-market-sources.md` §1.2），15s 超时会把「拿不到」放大成「页面挂死」。
 * 重试只有 429 一次，且首尾总耗时仍由 `fetchYahooGlobalIndices` 的预算兜住。
 */
async function fetchSingleGlobalQuote(
  def: { code: string; name: string; yahooSymbol: string },
  timeoutMs = 3500,
): Promise<GlobalIndexDto | null> {
  const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(def.yahooSymbol)}?range=1d&interval=1d`;
  const maxAttempts = 2;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      let text: string;
      try {
        text = await fetchUrl(url, {
          timeoutMs,
          proxy: 'auto',
          headers: { 'Referer': 'https://finance.yahoo.com/' },
        });
      } catch (error: any) {
        if (error?.message?.includes('429') && attempt < maxAttempts - 1) {
          await sleep(500);
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
      if (attempt < maxAttempts - 1) await sleep(500);
    }
  }
  return null;
}

/**
 * 全球指数批量报价（Yahoo 仅作兜底，主源是腾讯）。
 *
 * **11 个代码一次性并发**（曾经 `concurrency = 2` 串行分批：6 批 × 15s ≈ 84s，
 * 就是首屏卡死的根因）。每个请求各自带超时，谁先回来算谁；慢的不阻塞已拿到的，
 * 所以整体耗时 ≈ `timeoutMs`，而不是「批次数 × timeoutMs」。
 */
export async function fetchYahooGlobalIndices(timeoutMs = 3500): Promise<GlobalIndexListDto> {
  const items: GlobalIndexDto[] = [];

  await Promise.allSettled(
    GLOBAL_INDEX_DEFS.map(async (def) => {
      const quote = await fetchSingleGlobalQuote(def, timeoutMs);
      if (quote) items.push(quote);
    }),
  );

  return { items };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 加密货币报价/K 线已迁到 Binance（`providers/binance/binanceClient.ts`）：
 * Yahoo 在本机直连与代理都不通，4 个代码 2 批 × 15s = 30s 曾让 `/api/market/crypto`
 * 每次轮询都卡满 30s。这里只保留全球指数的兜底能力。
 */
