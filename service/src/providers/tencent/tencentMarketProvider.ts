import type { KlineDto, KlineOptions, MarketProvider, MarketQuoteDto } from '../types.js';
import { AppError } from '../../core/errors.js';
import { fetchUrl } from '../../core/fetch.js';

const QT_URL = 'https://qt.gtimg.cn/';
const KLINE_URL = 'https://web.ifzq.gtimg.cn/app/app/kline/kline';

export class TencentMarketProvider implements MarketProvider {
  readonly name = 'tencent';

  async quotes(symbols: string[]): Promise<MarketQuoteDto[]> {
    const valid = symbols
      .map((sym) => toQtCode(sym))
      .filter((code): code is string => code !== null);

    if (valid.length === 0) return [];

    const text = await fetchUrl(`${QT_URL}?q=${valid.join(',')}`, {
      timeoutMs: 8000,
      proxy: 'never',
      encoding: 'gbk',
      headers: { Referer: 'https://gu.qq.com/' },
    });

    return parseQtQuotes(text, valid, symbols);
  }

  async kline(symbol: string, options: KlineOptions): Promise<KlineDto[]> {
    const qtCode = toQtCode(symbol);
    if (!qtCode) {
      throw new AppError('PROVIDER_UNAVAILABLE', `Tencent does not support symbol ${symbol}`, 502, { symbol });
    }

    const periodMap: Record<string, string> = { daily: 'day', weekly: 'week', monthly: 'month' };
    const period = periodMap[options.period] || 'day';

    const params = new URLSearchParams({ code: qtCode, type: period });
    if (options.startDate) params.set('start', options.startDate.replaceAll('-', ''));
    if (options.endDate) params.set('end', options.endDate.replaceAll('-', ''));

    const data = await fetchUrl<Record<string, unknown>>(`${KLINE_URL}?${params.toString()}`, {
      timeoutMs: 8000,
      proxy: 'never',
      as: 'json',
      headers: { Referer: 'https://gu.qq.com/' },
    });

    const klines = data.data as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(klines)) return [];

    const cleanCode = symbol.replace(/^(sh|sz|bj)/i, '');
    return klines.map((item) => {
      const date = String(item.date ?? item.time ?? '');
      const timestamp = date ? new Date(date).getTime() : null;
      return {
        code: cleanCode,
        date,
        timestamp,
        open: toNullableNum(item.open),
        close: toNullableNum(item.close),
        high: toNullableNum(item.high),
        low: toNullableNum(item.low),
        volume: toNullableNum(item.volume ?? item.vol),
        amount: toNullableNum(item.amount),
        change: toNullableNum(item.change),
        changePercent: toNullableNum(item.changePercent ?? item.pctChg),
        turnoverRate: null,
      };
    });
  }
}

function toQtCode(symbol: string): string | null {
  const cleaned = symbol.trim().replace(/\.(SH|SZ|BJ|HK)$/i, '');
  const m = cleaned.match(/^(sh|sz|bj)?(\d{6})$/i);
  if (!m) return null;
  const prefix = (m[1] ?? '').toLowerCase();
  const numeric = m[2];
  if (/^\d{5}$/.test(numeric)) return null;
  if (prefix) return `${prefix}${numeric}`;
  if (/^[69]/.test(numeric)) return `sh${numeric}`;
  if (/^[023]/.test(numeric)) return `sz${numeric}`;
  if (/^[48]/.test(numeric)) return `bj${numeric}`;
  return null;
}

function detectMarket(qtCode: string): string {
  const lower = qtCode.toLowerCase();
  if (lower.startsWith('sh')) return '上海';
  if (lower.startsWith('sz')) return '深圳';
  if (lower.startsWith('bj')) return '北京';
  return 'CN';
}

function parseQtQuotes(
  text: string,
  requestedQtCodes: string[],
  originalSymbols: string[],
): MarketQuoteDto[] {
  const pattern = /v_(\w+)="([^"]*)"/g;
  const qtCodeToOriginal = new Map<string, string>();
  for (let i = 0; i < requestedQtCodes.length; i++) {
    qtCodeToOriginal.set(requestedQtCodes[i], originalSymbols[i]);
  }

  const results: MarketQuoteDto[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const rawQtCode = match[1];
    const raw = match[2];
    const parts = raw.split('~');

    if (parts.length < 8) continue;

    const name = (parts[1] || '').trim();
    const code = (parts[2] || '').trim();
    if (!name || !code) continue;

    const currentPrice = parseFloat(parts[3]);
    const prevClose = parseFloat(parts[4]);
    const open = parseFloat(parts[5]);
    const volume = parseFloat(parts[6]) || 0;
    const amount = parseFloat(parts[7]) || 0;

    const change = prevClose > 0 && !isNaN(prevClose) && !isNaN(currentPrice) ? currentPrice - prevClose : 0;
    const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

    const originalSymbol = qtCodeToOriginal.get(rawQtCode) || rawQtCode;

    results.push({
      symbol: originalSymbol,
      code,
      name,
      price: isNaN(currentPrice) ? 0 : currentPrice,
      change,
      changePercent,
      volume,
      amount,
      market: detectMarket(rawQtCode),
      assetType: 'stock',
      source: 'tencent.quotes',
      date: toQuoteDate(parts[30] ?? ''),
    });
  }

  return results;
}

function toQuoteDate(value: string): string {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function toNullableNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
