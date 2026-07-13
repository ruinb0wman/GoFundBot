import { cache, cacheThrough, ttl } from '../core/cache.js';
import { AppError, assertCode } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { ProviderChain } from '../core/providerChain.js';
import type { ServiceResult } from '../types/common.js';
import { StockSdkMarketProvider } from '../providers/stock-sdk/stockSdkMarketProvider.js';
import { EastMoneyMarketProvider } from '../providers/eastmoney/eastmoneyMarketProvider.js';
import { YahooMarketProvider } from '../providers/yahoo/yahooMarketProvider.js';
import { isGlobalIndexSymbol } from '../providers/yahoo/yahooClient.js';
import type {
  ConstituentListDto,
  GlobalIndexListDto,
  IndexDto,
  IndexListDto,
  KlineDto,
  KlineOptions,
  MarketBreadthDto,
  MarketMoneyFlowDto,
  MarketProvider,
  MarketQuoteDto,
  NorthFlowDto,
  ProviderChainResult,
  SectorListDto,
  StockMoneyFlowDto,
} from '../providers/types.js';

export type { KlineDto, MarketQuoteDto } from '../providers/types.js';
export type { ConstituentListDto, IndexListDto, SectorListDto } from '../providers/types.js';

export interface IndexDetailDto {
  code: string;
  name: string;
  price: number | null;
  change_amt: number | null;
  change_pct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prev_close: number | null;
  volume: number | null;
  amount: number | null;
  amplitude: number | null;
  market: string;
}

export interface KlineQuery {
  period?: string;
  adjust?: string;
  startDate?: string;
  endDate?: string;
}

const stockSdkMarketProvider = new StockSdkMarketProvider();
const eastMoneyMarketProvider = new EastMoneyMarketProvider();
const yahooMarketProvider = new YahooMarketProvider();

export async function getMarketQuotes(symbolsParam: string | undefined): Promise<ServiceResult<MarketQuoteDto[]>> {
  const symbols = parseSymbols(symbolsParam);
  const key = `market:quotes:${symbols.join(',')}`;
  const chain = new ProviderChain<MarketProvider>([stockSdkMarketProvider, eastMoneyMarketProvider]);
  const result = await cacheThrough(key, ttl.marketQuotes, () =>
    chain.run('market.quotes', (provider) => provider.quotes(symbols))
  );

  return toServiceResult(result);
}

export async function getMarketKline(symbol: string, query: KlineQuery): Promise<ServiceResult<KlineDto[]>> {
  const stockSymbol = assertStockSymbol(symbol);
  const options = parseKlineOptions(query);
  const key = `market:kline:${stockSymbol}:${JSON.stringify(options)}`;
  const chain = new ProviderChain<MarketProvider>([stockSdkMarketProvider, eastMoneyMarketProvider]);
  const result = await cacheThrough(key, ttl.marketKline, () =>
    chain.run('market.kline', (provider) => provider.kline(stockSymbol, options))
  );

  return toServiceResult(result);
}

export async function getGlobalIndexKline(symbol: string, query: KlineQuery): Promise<ServiceResult<KlineDto[]>> {
  const globalSymbol = assertGlobalIndexSymbol(symbol);
  const options = parseGlobalKlineOptions(query);
  const key = `market:kline:global:${globalSymbol}:${JSON.stringify(options)}`;
  const chain = new ProviderChain<MarketProvider>([yahooMarketProvider]);
  const result = await cacheThrough(key, ttl.marketGlobalKline, () =>
    chain.run('market.kline', (provider) => provider.kline(globalSymbol, options))
  );

  return toServiceResult(result);
}

function normalizeIndexSymbol(symbol: string): string {
  const m = symbol.match(/^(\d)\.(\d{6})$/);
  if (m) {
    const prefix = m[1] === '1' ? 'sh' : 'sz';
    return prefix + m[2];
  }
  return symbol.toLowerCase();
}

export async function getIndexDetail(symbol: string): Promise<ServiceResult<IndexDetailDto>> {
  const normalized = normalizeIndexSymbol(symbol);
  const [quoteResult, klineResult] = await Promise.allSettled([
    getMarketQuotes(normalized),
    getMarketKline(normalized, { period: 'daily' }),
  ]);

  let code = normalized;
  let name = '';
  let price: number | null = null;
  let changeAmt: number | null = null;
  let changePct: number | null = null;
  let open: number | null = null;
  let high: number | null = null;
  let low: number | null = null;
  let prevClose: number | null = null;
  let volume: number | null = null;
  let amount: number | null = null;
  let market = '';

  if (quoteResult.status === 'fulfilled' && quoteResult.value.data?.length) {
    const q = quoteResult.value.data[0];
    code = q.code;
    name = q.name;
    price = q.price;
    changeAmt = q.change;
    changePct = q.changePercent;
    volume = q.volume;
    amount = q.amount;
    market = q.market;
  }

  if (klineResult.status === 'fulfilled' && klineResult.value.data?.length) {
    const data = klineResult.value.data;
    const latest = data[data.length - 1];
    open = latest.open;
    high = latest.high;
    low = latest.low;
    prevClose = data.length >= 2 ? data[data.length - 2].close : latest.close;
  }

  const amplitude = high != null && low != null && prevClose != null && prevClose !== 0
    ? +(((high - low) / prevClose) * 100).toFixed(2)
    : null;

  const data: IndexDetailDto = {
    code,
    name,
    price,
    change_amt: changeAmt,
    change_pct: changePct,
    open,
    high,
    low,
    prev_close: prevClose,
    volume,
    amount,
    amplitude,
    market,
  };

  return {
    data,
    provider: quoteResult.status === 'fulfilled' ? quoteResult.value.provider : (klineResult.status === 'fulfilled' ? klineResult.value.provider : 'none'),
    fallback: quoteResult.status !== 'fulfilled' || klineResult.status !== 'fulfilled',
    cached: false,
    stale: false,
    updatedAt: new Date(),
  };
}

function parseSymbols(value: string | undefined): string[] {
  if (!value) {
    throw new AppError('INVALID_ARGUMENT', 'symbols query is required', 400, { symbols: value });
  }

  const symbols = value
    .split(',')
    .map((symbol) => symbol.trim())
    .filter(Boolean);

  if (symbols.length === 0) {
    throw new AppError('INVALID_ARGUMENT', 'symbols query must contain at least one symbol', 400, { symbols: value });
  }

  return symbols.map((symbol) => assertStockSymbol(symbol));
}

function assertStockSymbol(value: string | undefined): string {
  const symbol = assertCode(value, 'symbol');
  if (!/^(sh|sz)?\d{6}$/i.test(symbol)) {
    throw new AppError('INVALID_ARGUMENT', 'A-share symbol must look like sh600519, sz000001, or 600519', 400, {
      symbol: value,
    });
  }
  return symbol.toLowerCase();
}

function assertGlobalIndexSymbol(value: string | undefined): string {
  const symbol = assertCode(value, 'symbol');
  const lower = symbol.toLowerCase();
  if (!isGlobalIndexSymbol(lower)) {
    throw new AppError('INVALID_ARGUMENT', `Unsupported global index symbol: ${symbol}`, 400, { symbol });
  }
  return lower;
}

function parseGlobalKlineOptions(query: KlineQuery): KlineOptions {
  const period = query.period ?? 'daily';
  if (!['daily', 'weekly', 'monthly'].includes(period)) {
    throw new AppError('INVALID_ARGUMENT', 'period must be daily, weekly, or monthly', 400, { period });
  }
  return {
    period: period as 'daily' | 'weekly' | 'monthly',
    adjust: '' as const,
    startDate: query.startDate ? normalizeDate(query.startDate) : undefined,
    endDate: query.endDate ? normalizeDate(query.endDate) : undefined,
  };
}

function parseKlineOptions(query: KlineQuery): KlineOptions {
  const period = query.period ?? 'daily';
  const adjust = query.adjust ?? 'none';

  if (!['daily', 'weekly', 'monthly'].includes(period)) {
    throw new AppError('INVALID_ARGUMENT', 'period must be daily, weekly, or monthly', 400, { period });
  }

  if (!['none', 'qfq', 'hfq'].includes(adjust)) {
    throw new AppError('INVALID_ARGUMENT', 'adjust must be none, qfq, or hfq', 400, { adjust });
  }

  if (query.startDate && !isDateLike(query.startDate)) {
    throw new AppError('INVALID_ARGUMENT', 'startDate must be YYYY-MM-DD or YYYYMMDD', 400, {
      startDate: query.startDate,
    });
  }

  if (query.endDate && !isDateLike(query.endDate)) {
    throw new AppError('INVALID_ARGUMENT', 'endDate must be YYYY-MM-DD or YYYYMMDD', 400, {
      endDate: query.endDate,
    });
  }

  const normalizedAdjust: '' | 'qfq' | 'hfq' = adjust === 'none' ? '' : (adjust as 'qfq' | 'hfq');

  return {
    period: period as 'daily' | 'weekly' | 'monthly',
    adjust: normalizedAdjust,
    startDate: query.startDate ? normalizeDate(query.startDate) : undefined,
    endDate: query.endDate ? normalizeDate(query.endDate) : undefined,
  };
}

function isDateLike(value: string): boolean {
  return /^\d{4}-?\d{2}-?\d{2}$/.test(value);
}

function normalizeDate(value: string): string {
  return value.replaceAll('-', '');
}

export async function getMarketSectors(): Promise<ServiceResult<SectorListDto>> {
  const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider]);
  const result = await cacheThrough('market:sectors', ttl.marketQuotes, () =>
    chain.run('market.sectors', (provider) => {
      if (!provider.sectors) {
        throw new AppError('PROVIDER_UNAVAILABLE', `${provider.name} does not implement sectors`, 501);
      }
      return provider.sectors();
    })
  );

  return toServiceResult(result);
}

export async function getMarketSectorConstituents(code: string): Promise<ServiceResult<ConstituentListDto>> {
  const sectorCode = assertCode(code, 'code');
  const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider]);
  const result = await cacheThrough(`market:sector:${sectorCode}:constituents`, ttl.marketQuotes, () =>
    chain.run('market.sectorConstituents', (provider) => {
      if (!provider.sectorConstituents) {
        throw new AppError('PROVIDER_UNAVAILABLE', `${provider.name} does not implement sector constituents`, 501);
      }
      return provider.sectorConstituents(sectorCode);
    })
  );

  return toServiceResult(result);
}

export async function getMarketIndices(): Promise<ServiceResult<IndexListDto>> {
  const chain = new ProviderChain<MarketProvider>([stockSdkMarketProvider, eastMoneyMarketProvider]);
  const result = await cacheThrough('market:indices', ttl.marketQuotes, () =>
    chain.run('market.indices', (provider) => {
      if (!provider.indices) {
        throw new AppError('PROVIDER_UNAVAILABLE', `${provider.name} does not implement indices`, 501);
      }
      return provider.indices();
    })
  );

  return toServiceResult(result);
}

export async function getStockMoneyFlow(code: string, days?: number): Promise<ServiceResult<StockMoneyFlowDto>> {
  const stockSymbol = assertStockSymbol(code);
  const key = `market:money-flow:${stockSymbol}:${days ?? 1}`;
  const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider]);
  const result = await cacheThrough(key, ttl.marketMoneyFlow, () =>
    chain.run('market.moneyFlow', (provider) => {
      if (!provider.moneyFlow) {
        throw new AppError('PROVIDER_UNAVAILABLE', `${provider.name} does not implement moneyFlow`, 501);
      }
      return provider.moneyFlow(stockSymbol, days);
    })
  );

  return toServiceResult(result);
}

export async function getMarketMoneyFlow(): Promise<ServiceResult<MarketMoneyFlowDto>> {
  const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider]);
  const result = await cacheThrough('market:money-flow:market', ttl.marketMoneyFlow, () =>
    chain.run('market.marketMoneyFlow', (provider) => {
      if (!provider.marketMoneyFlow) {
        throw new AppError('PROVIDER_UNAVAILABLE', `${provider.name} does not implement marketMoneyFlow`, 501);
      }
      return provider.marketMoneyFlow();
    })
  );

  return toServiceResult(result);
}

export async function getMarketBreadth(): Promise<ServiceResult<MarketBreadthDto>> {
  const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider]);
  const result = await cacheThrough('market:breadth', ttl.marketBreadth, () =>
    chain.run('market.breadth', (provider) => {
      if (!provider.breadth) {
        throw new AppError('PROVIDER_UNAVAILABLE', `${provider.name} does not implement breadth`, 501);
      }
      return provider.breadth();
    })
  );

  return toServiceResult(result);
}

export async function getNorthFlow(): Promise<ServiceResult<NorthFlowDto>> {
  const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider]);
  const result = await cacheThrough('market:north-flow', ttl.marketNorthFlow, () =>
    chain.run('market.northFlow', (provider) => {
      if (!provider.northFlow) {
        throw new AppError('PROVIDER_UNAVAILABLE', `${provider.name} does not implement northFlow`, 501);
      }
      return provider.northFlow();
    })
  );

  return toServiceResult(result);
}

export async function getGlobalIndices(): Promise<ServiceResult<GlobalIndexListDto>> {
  const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider]);
  const result = await cacheThrough('market:global-indices', ttl.marketGlobalIndices, () =>
    chain.run('market.globalIndices', (provider) => {
      if (!provider.globalIndices) {
        throw new AppError('PROVIDER_UNAVAILABLE', `${provider.name} does not implement globalIndices`, 501);
      }
      return provider.globalIndices();
    })
  );

  return toServiceResult(result);
}

export async function fetchGoldRealtime(): Promise<Record<string, any>> {
  const cached = cache.get<Record<string, any>>('gold:realtime');
  if (cached) return cached.value;

  try {
    const url = new URL('https://api.jijinhao.com/quoteCenter/realTime.htm');
    url.searchParams.set('codes', 'JO_71,JO_92233,JO_92232');
    url.searchParams.set('_', String(Date.now()));

    const response = await fetch(url.toString(), {
      headers: {
        'accept': '*/*',
        'referer': 'https://quote.cngold.org/gjs/gjhj.html',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });

    const text = await response.text();
    const json = JSON.parse(text.replace('var quote_json = ', ''));

    const codeMap: Record<string, string> = {
      'JO_71': '黄金T+D',
      'JO_92233': '国际黄金',
      'JO_92232': '国际白银',
    };

    const codes = ['JO_71', 'JO_92233', 'JO_92232'];
    const result: any[] = [];

    for (const code of codes) {
      const d = json[code];
      if (!d) continue;
      const to2 = (v: any) => Math.round((v || 0) * 100) / 100;
      result.push({
        name: d.showName || codeMap[code] || code,
        price: to2(d.q63),
        change: to2(d.q70),
        change_pct: `${to2(d.q80)}%`,
        open: to2(d.q1),
        high: to2(d.q3),
        low: to2(d.q4),
        prev_close: to2(d.q2),
        update_time: d.time ? new Date(d.time).toISOString() : '',
        unit: d.unit || '',
      });
    }

    const data = {
      success: true,
      data: result,
      update_time: new Date().toISOString(),
    };
    cache.set('gold:realtime', data, ttl.goldRealtime);
    return data;
  } catch (error) {
    return {
      success: false,
      data: [],
      update_time: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getGoldHistory(days: number = 10): Promise<Record<string, any>> {
  const cacheKey = `gold:history:${days}`;
  const cached = cache.get<Record<string, any>>(cacheKey);
  if (cached) return cached.value;

  try {
    const fetchMetalHistory = async (code: string, needField = '128,129,70') => {
      const url = new URL('https://api.jijinhao.com/quoteCenter/history.htm');
      url.searchParams.set('code', code);
      url.searchParams.set('style', '3');
      url.searchParams.set('pageSize', String(days));
      url.searchParams.set('needField', needField);
      url.searchParams.set('currentPage', '1');
      url.searchParams.set('_', String(Date.now()));

      const response = await fetch(url.toString(), {
        headers: {
          'accept': '*/*',
          'referer': 'https://quote.cngold.org/gjs/swhj_zghj.html',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(10000),
      });

      const text = await response.text();
      return JSON.parse(text.replace('var quote_json = ', ''));
    };

    const [data1, data2] = await Promise.all([
      fetchMetalHistory('JO_52683'),
      fetchMetalHistory('JO_42660'),
    ]);

    const raw1 = data1?.data || [];
    const raw2 = data2?.data || [];

    const result = raw1.map((item: any, i: number) => {
      const t = item.time || 0;
      const date = t ? new Date(t).toISOString().slice(0, 10) : '';
      const gold2 = raw2[i] || {};
      return {
        date,
        china_gold_price: item.q1 ?? 'N/A',
        china_gold_change: String(item.q70 ?? 'N/A'),
        zhoudafu_price: gold2.q1 ?? 'N/A',
        zhoudafu_change: String(gold2.q70 ?? 'N/A'),
      };
    });

    const data = {
      success: true,
      data: result,
      update_time: new Date().toISOString(),
    };
    cache.set(cacheKey, data, ttl.goldHistory);
    return data;
  } catch (error) {
    return {
      success: false,
      data: [],
      update_time: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getSilverHistory(days: number = 10): Promise<Record<string, any>> {
  const cacheKey = `silver:history:${days}`;
  const cached = cache.get<Record<string, any>>(cacheKey);
  if (cached) return cached.value;

  try {
    const url = new URL('https://api.jijinhao.com/quoteCenter/history.htm');
    url.searchParams.set('code', 'JO_92232');
    url.searchParams.set('style', '3');
    url.searchParams.set('pageSize', String(days));
    url.searchParams.set('needField', '70');
    url.searchParams.set('currentPage', '1');
    url.searchParams.set('_', String(Date.now()));

    const response = await fetch(url.toString(), {
      headers: {
        'accept': '*/*',
        'referer': 'https://quote.cngold.org/gjs/swhj_zghj.html',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });

    const text = await response.text();
    const parsed = JSON.parse(text.replace('var quote_json = ', ''));
    const raw = parsed?.data || [];
    const unit = parsed?.unit || '美元/盎司';

    const result = raw.map((item: any) => {
      const t = item.time || 0;
      const date = t ? new Date(t).toISOString().slice(0, 10) : '';
      return {
        date,
        price: item.q1 ?? 'N/A',
        change: String(item.q70 ?? 'N/A'),
        high: item.q3 ?? 'N/A',
        low: item.q4 ?? 'N/A',
        volume: item.q60 ?? 0,
        unit,
      };
    });

    const data = {
      success: true,
      data: result,
      update_time: new Date().toISOString(),
    };
    cache.set(cacheKey, data, ttl.goldHistory);
    return data;
  } catch (error) {
    return {
      success: false,
      data: [],
      update_time: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getMarketSectorsFromAkshare(limit = 90): Promise<any[]> {
  try {
    const result = await getMarketSectors();
    const items = result.data.items ?? [];
    return items.slice(0, Math.min(Math.max(limit, 1), 120)).map(s => ({
      name: s.name,
      code: s.code,
      change_pct: s.changePercent != null ? `${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%` : '',
      main_inflow: s.mainNetInflow != null ? `${s.mainNetInflow >= 0 ? '+' : ''}${s.mainNetInflow.toFixed(2)}亿` : '',
      raw_change: s.changePercent,
      raw_main_inflow: s.mainNetInflow,
    }));
  } catch {
    return [];
  }
}

export async function getMarketIndicesFromAkshare(): Promise<any[]> {
  try {
    const result = await getMarketIndices();
    const items = result.data.items ?? [];
    return items.map(idx => ({
      code: idx.code,
      name: idx.name,
      price: idx.price ?? 0,
      change_pct: idx.changePercent ?? 0,
      change_amount: idx.changeAmount ?? 0,
      market: idx.market,
    }));
  } catch {
    return [];
  }
}

export async function fetchIndicesFromSina(): Promise<IndexListDto> {
  const SINA_URL = 'http://hq.sinajs.cn/list=sh000001,sz399001,sz399006,sh000300,sh000688';
  const INDEX_MAP: Record<string, { name: string; market: string }> = {
    sh000001: { name: '上证指数', market: '上海' },
    sz399001: { name: '深证成指', market: '深圳' },
    sz399006: { name: '创业板指', market: '深圳' },
    sh000300: { name: '沪深300', market: '上海' },
    sh000688: { name: '科创50', market: '上海' },
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(SINA_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        'Referer': 'https://finance.sina.com.cn',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`Sina HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buffer);

    const items: IndexDto[] = [];

    for (const key of Object.keys(INDEX_MAP)) {
      const re = new RegExp(`var hq_str_${key}="([^"]*)"`);
      const match = text.match(re);
      if (!match) continue;

      const parts = match[1].split(',');
      const idxInfo = INDEX_MAP[key];
      const currentStr = parts[3];
      const prevCloseStr = parts[2];
      const volumeStr = parts[8];
      const amountStr = parts[9];

      const price = parseFloat(currentStr);
      const prevClose = parseFloat(prevCloseStr);
      const change = price - prevClose;
      const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

      items.push({
        code: key,
        name: idxInfo.name,
        price: isNaN(price) ? null : price,
        changePercent: isNaN(changePercent) ? null : changePercent,
        changeAmount: isNaN(change) ? null : change,
        market: idxInfo.market,
      });
    }

    return { items };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('fetchIndicesFromSina failed', { error: errMsg });
    return {
      items: Object.entries(INDEX_MAP).map(([code, info]) => ({
        code,
        name: info.name,
        price: null,
        changePercent: null,
        changeAmount: null,
        market: info.market,
      })),
    };
  }
}

export async function getMarketOverview(): Promise<Record<string, unknown>> {
  const updateTime = new Date().toISOString();

  let indices: any[] = [];

  const [indicesResult, goldResult] = await Promise.allSettled([
    getMarketIndices(),
    fetchGoldRealtime(),
  ]);

  if (indicesResult.status === 'fulfilled') {
    indices = indicesResult.value.data.items ?? [];
  }

  const goldRealtime = goldResult.status === 'fulfilled'
    ? goldResult.value
    : { success: false, data: [], update_time: updateTime };

  return {
    success: true,
    market_index: { success: true, data: indices },
    gold_realtime: goldRealtime,
    a_volume_7days: { success: false, data: [], update_time: updateTime },
    update_time: updateTime,
  };
}

function toServiceResult<T>(lookup: {
  value: ProviderChainResult<T>;
  cached: boolean;
  updatedAt: Date;
}): ServiceResult<T> {
  return {
    data: lookup.value.data,
    provider: lookup.value.provider,
    fallback: lookup.value.fallback,
    cached: lookup.cached,
    stale: lookup.value.stale,
    updatedAt: lookup.updatedAt,
  };
}
