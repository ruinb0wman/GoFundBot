import type {
  GlobalIndexDto,
  GlobalIndexListDto,
  KlineDto,
  KlineOptions,
  MarketProvider,
  MarketQuoteDto,
} from '../types.js';
import { AppError } from '../../core/errors.js';
import { fetchUrl } from '../../core/fetch.js';
import { GLOBAL_INDEX_DEFS, findGlobalIndexDef } from '../globalIndexDefs.js';

const QT_URL = 'https://qt.gtimg.cn/';
// 腾讯新格式 K 线：每行含成交额（万元）。旧的 `app/app/kline/kline` 已失效（返回 code:11）。
const KLINE_URL = 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get';
// 备用 host 返回同样的行结构，但只有前 6 列（无成交额）。
const KLINE_FALLBACK_URL = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';

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

  /**
   * 全球指数实时行情（`qt.gtimg.cn` 一次批量，国内直连）。
   *
   * 只覆盖腾讯收录的代码（`def.tencentSymbol`：美股 NDX/DJI/SPX + 港股 HSI/HSCEI），
   * 未收录的（日经/欧股/印度）直接跳过，由 ProviderChain 继续降级到 Yahoo。
   *
   * `market` 用「港股」标记 hk*：前端 `useMarketOverview.indices` 把恒生系归在
   * 「中国市场（A股/港股）」栏，若标成「全球」，「恒生指数」会同时命中 chinaNames 与
   * globalNames 两套名字匹配，同一张卡片在两栏重复出现。
   *
   * 为什么不用 `[31]/[32]` 的涨跌字段：港股那行 `[35]` 是现价而不是币种，字段位置在
   * 美/港之间有漂移，统一由 `[3]` 现价 / `[4]` 昨收自算（与 A 股 `parseQtQuotes` 同口径）。
   */
  async globalIndices(): Promise<GlobalIndexListDto> {
    const defs = GLOBAL_INDEX_DEFS.filter((def) => def.tencentSymbol);
    if (defs.length === 0) return { items: [] };

    const text = await fetchUrl(`${QT_URL}?q=${defs.map((def) => def.tencentSymbol).join(',')}`, {
      timeoutMs: 5000,
      proxy: 'never',
      encoding: 'gbk',
      headers: { Referer: 'https://gu.qq.com/' },
    });

    return { items: parseTencentGlobalQuotes(text, defs) };
  }

  async kline(symbol: string, options: KlineOptions): Promise<KlineDto[]> {
    const globalDef = findGlobalIndexDef(symbol);
    if (globalDef) {
      // 腾讯未收录 → 返回空数组（不抛），让 `getGlobalIndexKline` 的 validate 触发降级。
      if (!globalDef.tencentSymbol) return [];
      return fetchKlineFromTencent(globalDef.tencentSymbol, globalDef.code, options);
    }

    const qtCode = toQtCode(symbol);
    if (!qtCode) {
      throw new AppError('PROVIDER_UNAVAILABLE', `Tencent does not support symbol ${symbol}`, 502, { symbol });
    }

    return fetchKlineFromTencent(qtCode, qtCode.replace(/^(sh|sz|bj)/i, ''), options);
  }
}

/**
 * 腾讯新格式 K 线（A 股个股/指数 + 海外指数共用）。
 *
 * 行结构：`[date, open, close, high, low, volume, {}, turnover, amount(万元), ...]`。
 * 指数返回 `day/week/month`，个股复权返回 `qfqday/hfqday`。
 */
async function fetchKlineFromTencent(qtCode: string, code: string, options: KlineOptions): Promise<KlineDto[]> {
  const periodMap: Record<string, string> = { daily: 'day', weekly: 'week', monthly: 'month' };
  const period = periodMap[options.period] || 'day';
  const fq = options.adjust === 'hfq' ? 'hfq' : options.adjust === 'qfq' ? 'qfq' : '';

  const start = toDashedDate(options.startDate);
  const end = toDashedDate(options.endDate);
  // 腾讯用 count 决定返回条数（start 只是下限钳制），先取足量再按 [startDate, endDate] 过滤。
  const count = start && end
    ? Math.min(640, Math.max(20, calendarDays(start, end) + 10))
    : period === 'day' ? 320 : 200;

  let node: Record<string, unknown> | null = null;
  for (const baseUrl of [KLINE_URL, KLINE_FALLBACK_URL]) {
    try {
      node = await fetchKlineNode(baseUrl, qtCode, period, start, end, count, fq);
    } catch {
      node = null;
    }
    if (node) break;
  }
  if (!node) return [];

  const rows = pickKlineRows(node, period, fq);
  if (!Array.isArray(rows)) return [];

  let prevClose: number | null = null;
  const mapped: KlineDto[] = [];

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const date = String(row[0] ?? '');
    if (!date) continue;

    const close = toNullableNum(row[2]);
    const change = prevClose != null && close != null ? close - prevClose : null;
    const changePercent =
      change != null && prevClose != null && prevClose !== 0 ? (change / prevClose) * 100 : null;
    // row[8] = 成交额（万元），与 EastMoney/akshare 的「元」对齐需 ×1e4。
    const amountWan = toNullableNum(row[8]);
    const timestamp = date ? new Date(date).getTime() : NaN;

    mapped.push({
      code,
      date,
      timestamp: Number.isFinite(timestamp) ? timestamp : null,
      open: toNullableNum(row[1]),
      close,
      high: toNullableNum(row[3]),
      low: toNullableNum(row[4]),
      volume: toNullableNum(row[5]),
      amount: amountWan != null ? amountWan * 1e4 : null,
      change,
      changePercent,
      turnoverRate: toNullableNum(row[7]),
    });
    prevClose = close;
  }

  return mapped.filter((item) => {
    const d = item.date?.replace(/-/g, '') ?? '';
    return (!options.startDate || d >= options.startDate) && (!options.endDate || d <= options.endDate);
  });
}

/**
 * 解析 `qt.gtimg.cn` 的全球指数行。
 *
 * 字段位置（2026-10 实测，美/港一致）：
 * `[1]` 名称、`[2]` 代码、`[3]` 现价、`[4]` 昨收、`[5]` 今开、`[6]` 成交量、
 * `[30]` 时间、`[33]` 最高、`[34]` 最低。
 */
function parseTencentGlobalQuotes(
  text: string,
  defs: Array<{ code: string; name: string; tencentSymbol?: string }>,
): GlobalIndexDto[] {
  const byTencentSymbol = new Map(defs.map((def) => [def.tencentSymbol as string, def]));
  const pattern = /v_(\w+)="([^"]*)"/g;
  const items: GlobalIndexDto[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const def = byTencentSymbol.get(match[1]);
    if (!def) continue;

    const parts = match[2].split('~');
    if (parts.length < 35) continue;

    const price = toNullableNum(parts[3]);
    if (price == null) continue;

    const prevClose = toNullableNum(parts[4]);
    const change = prevClose != null ? round2(price - prevClose) : null;
    const changePercent =
      prevClose != null && prevClose !== 0 ? round2(((price - prevClose) / prevClose) * 100) : null;
    const { date, updateTime } = parseTencentGlobalTime(parts[30] ?? '');

    items.push({
      code: def.code,
      name: def.name,
      price,
      changePercent,
      changeAmount: change,
      open: toNullableNum(parts[5]),
      high: toNullableNum(parts[33]),
      low: toNullableNum(parts[34]),
      prevClose,
      market: (def.tencentSymbol as string).toLowerCase().startsWith('hk') ? '港股' : '全球',
      date,
      updateTime,
    });
  }

  return items;
}

/** `2026-10-08 12:54:59`（美）与 `2026/10/08 18:31:15`（港）两种分隔符都吃。 */
function parseTencentGlobalTime(raw: string): { date: string; updateTime: string } {
  const match = raw.trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return { date: '', updateTime: '' };
  const [, y, mo, d, h, mi, s] = match;
  const date = `${y}-${mo}-${d}`;
  const parsed = new Date(`${date}T${h}:${mi}:${s}+08:00`);
  return { date, updateTime: Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString() };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface TencentKlineResponse {
  code?: number;
  data?: Record<string, Record<string, unknown>>;
}

async function fetchKlineNode(
  baseUrl: string,
  qtCode: string,
  period: string,
  start: string,
  end: string,
  count: number,
  fq: string,
): Promise<Record<string, unknown> | null> {
  const param = [qtCode, period, start, end, count, fq].join(',');
  const data = await fetchUrl<TencentKlineResponse>(
    `${baseUrl}?${new URLSearchParams({ param }).toString()}`,
    { timeoutMs: 8000, proxy: 'never', as: 'json', headers: { Referer: 'https://gu.qq.com/' } },
  );
  if (Number(data.code) !== 0) return null;
  const node = data.data?.[qtCode];
  return node && typeof node === 'object' ? node : null;
}

/** 指数返回 `day`/`week`/`month`，个股复权返回 `qfqday`/`hfqday` 等。 */
function pickKlineRows(node: Record<string, unknown>, period: string, fq: string): unknown[] | null {
  for (const key of [`${fq}${period}`, period, `qfq${period}`, `hfq${period}`]) {
    if (Array.isArray(node[key])) return node[key] as unknown[];
  }
  return null;
}

function toDashedDate(value?: string): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 8) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function calendarDays(start: string, end: string): number {
  const from = new Date(`${start}T00:00:00Z`).getTime();
  const to = new Date(`${end}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 30;
  return Math.max(1, Math.round((to - from) / 86400000));
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
