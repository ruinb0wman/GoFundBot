import { cache, cacheThrough, ttl } from '../core/cache.js';
import { AppError, assertCode } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { ProviderChain } from '../core/providerChain.js';
import { dataSourceScorer } from '../core/dataSourceScorer.js';
import { runPython } from './pythonRunner.js';
import { fetchUrl } from '../core/fetch.js';
import type { ServiceResult } from '../types/common.js';
import { StockSdkMarketProvider } from '../providers/stock-sdk/stockSdkMarketProvider.js';
import { EastMoneyMarketProvider } from '../providers/eastmoney/eastmoneyMarketProvider.js';
import { YahooMarketProvider } from '../providers/yahoo/yahooMarketProvider.js';
import { TencentMarketProvider } from '../providers/tencent/tencentMarketProvider.js';
import { JoinQuantMarketProvider } from '../providers/joinquant/joinquantMarketProvider.js';
import { isGlobalIndexSymbol, GLOBAL_INDEX_DEFS, fetchGlobalIndexQuoteByCode } from '../providers/yahoo/yahooClient.js';
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

const tencentMarketProvider = new TencentMarketProvider();
const joinQuantMarketProvider = new JoinQuantMarketProvider();
const stockSdkMarketProvider = new StockSdkMarketProvider();
const eastMoneyMarketProvider = new EastMoneyMarketProvider();
const yahooMarketProvider = new YahooMarketProvider();

export async function getMarketQuotes(symbolsParam: string | undefined): Promise<ServiceResult<MarketQuoteDto[]>> {
  const symbols = parseSymbols(symbolsParam);
  const key = `market:quotes:${symbols.join(',')}`;
    const chain = new ProviderChain<MarketProvider>([tencentMarketProvider, stockSdkMarketProvider, eastMoneyMarketProvider], dataSourceScorer);
  const result = await cacheThrough(key, ttl.marketQuotes, () =>
    chain.run('market.quotes', (provider) => provider.quotes(symbols), { timeoutMs: 5000 })
  );

  return toServiceResult(result);
}

export async function getMarketKline(symbol: string, query: KlineQuery): Promise<ServiceResult<KlineDto[]>> {
  if (isGlobalIndexSymbol(symbol)) {
    return getGlobalIndexKline(symbol, query);
  }
  const stockSymbol = assertStockSymbol(symbol);
  const options = parseKlineOptions(query);
  const key = `market:kline:${stockSymbol}:${JSON.stringify(options)}`;

  const cached = cache.get<ProviderChainResult<KlineDto[]>>(key);
  if (cached) return toServiceResult(cached);

  try {
    const chain = new ProviderChain<MarketProvider>([joinQuantMarketProvider, tencentMarketProvider, stockSdkMarketProvider, eastMoneyMarketProvider], dataSourceScorer);
    const result = await chain.run('market.kline', (provider) => provider.kline(stockSymbol, options), { timeoutMs: 5000, validate: (data) => Array.isArray(data) && data.length > 0 });
    return toServiceResult(cache.set(key, result, ttl.marketKline));
  } catch (err) {
    logger.error('All kline providers failed, trying akshare fallback', {
      symbol: stockSymbol,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const { data, source } = await getMarketKlineFromPython(stockSymbol, options);
    const result: ProviderChainResult<KlineDto[]> = {
      data,
      provider: source,
      fallback: true,
      stale: false,
      providerErrors: [],
    };
    return toServiceResult(cache.set(key, result, ttl.marketKline));
  } catch (fallbackErr) {
    logger.error('Python kline fallback also failed', {
      error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
    });
    throw new AppError('PROVIDER_UNAVAILABLE', 'All providers failed for market.kline', 503);
  }
}

async function getMarketKlineFromPython(stockSymbol: string, options: KlineOptions): Promise<{ data: KlineDto[]; source: string }> {
  const sources = ['baostock', 'akshare'];
  for (const source of sources) {
    const data = await _tryPythonKlineSource(source, stockSymbol, options);
    if (data.length > 0) return { data, source };
  }
  return { data: [], source: 'none' };
}

async function _tryPythonKlineSource(source: string, stockSymbol: string, options: KlineOptions): Promise<KlineDto[]> {
  const startDate = options.startDate ?? '';
  const endDate = options.endDate ?? '';
  try {
    const result = await runPython<Record<string, unknown>>('data_complete.py', {
      args: [
        '--source', source,
        '--type', 'kline',
        '--code', stockSymbol,
        '--start_date', startDate,
        '--end_date', endDate,
      ],
      timeoutMs: 60_000,
    });
    const rawItems = (result?.kline ?? []) as Record<string, unknown>[];
    return rawItems.map((item) => {
      const date = String(item.date ?? '');
      const timestamp = date ? new Date(date).getTime() : null;
      return {
        code: stockSymbol,
        date,
        timestamp,
        open: toNullableNumber(item.open),
        close: toNullableNumber(item.close),
        high: toNullableNumber(item.high),
        low: toNullableNumber(item.low),
        volume: toNullableNumber(item.volume),
        amount: toNullableNumber(item.amount),
        change: toNullableNumber(item.change),
        changePercent: toNullableNumber(item.changePercent),
        turnoverRate: null,
      } as KlineDto;
    });
  } catch {
    return [];
  }
}

async function getNorthFlowFromAkshare(): Promise<NorthFlowDto> {
  const result = await runPython<Record<string, unknown>>('data_complete.py', {
    args: ['--source', 'akshare', '--type', 'north_flow'],
    timeoutMs: 60_000,
  });

  const northFlow = (result?.north_flow ?? {}) as Record<string, unknown>;
  const total = (northFlow.total ?? {}) as Record<string, unknown>;
  const sh = (northFlow.sh ?? {}) as Record<string, unknown>;
  const sz = (northFlow.sz ?? {}) as Record<string, unknown>;

  const shNetDealAmt = toNullableNumber(sh.net_deal_amt);
  const szNetDealAmt = toNullableNumber(sz.net_deal_amt);
  const totalNetDealAmt = toNullableNumber(total.net_deal_amt);

  return {
    date: String(total.date ?? ''),
    shNetInflow: shNetDealAmt,
    szNetInflow: szNetDealAmt,
    totalNetInflow: totalNetDealAmt,
    shUpCount: null,
    shDownCount: null,
    szUpCount: null,
    szDownCount: null,
  };
}

async function getMarketMoneyFlowFromAkshare(): Promise<MarketMoneyFlowDto> {
  const result = await runPython<Record<string, unknown>>('data_complete.py', {
    args: ['--source', 'akshare', '--type', 'money_flow'],
    timeoutMs: 30_000,
  });

  const mf = (result?.money_flow ?? {}) as Record<string, unknown>;
  return {
    date: String(mf.date ?? ''),
    mainNetInflow: toNullableNumber(mf.mainNetInflow),
    superLargeNetInflow: toNullableNumber(mf.superLargeNetInflow),
    largeNetInflow: toNullableNumber(mf.largeNetInflow),
    mediumNetInflow: toNullableNumber(mf.mediumNetInflow),
    smallNetInflow: toNullableNumber(mf.smallNetInflow),
  };
}

export async function getGlobalIndexKline(symbol: string, query: KlineQuery): Promise<ServiceResult<KlineDto[]>> {
  const globalSymbol = assertGlobalIndexSymbol(symbol);
  const options = parseGlobalKlineOptions(query);
  const key = `market:kline:global:${globalSymbol}:${JSON.stringify(options)}`;
  const chain = new ProviderChain<MarketProvider>([yahooMarketProvider], dataSourceScorer);
  const result = await cacheThrough(key, ttl.marketGlobalKline, () =>
    chain.run('market.kline', (provider) => provider.kline(globalSymbol, options))
  );

  return toServiceResult(result);
}

async function getGlobalIndexDetail(def: { code: string; name: string; yahooSymbol: string }): Promise<ServiceResult<IndexDetailDto>> {
  const [quoteResult, klineResult] = await Promise.allSettled([
    fetchGlobalIndexQuoteByCode(def.code),
    getGlobalIndexKline(def.code, { period: 'daily' }),
  ]);

  let code = def.code;
  let name = def.name;
  let price: number | null = null;
  let changeAmt: number | null = null;
  let changePct: number | null = null;
  let open: number | null = null;
  let high: number | null = null;
  let low: number | null = null;
  let prevClose: number | null = null;
  let volume: number | null = null;
  let amount: number | null = null;
  let market = '全球';

  if (quoteResult.status === 'fulfilled' && quoteResult.value) {
    const q = quoteResult.value;
    price = q.price;
    changeAmt = q.changeAmount;
    changePct = q.changePercent;
    open = q.open;
    high = q.high;
    low = q.low;
    prevClose = q.prevClose;
  }

  if (klineResult.status === 'fulfilled' && klineResult.value.data?.length) {
    const data = klineResult.value.data;
    const latest = data[data.length - 1];
    if (open == null) open = latest.open;
    if (high == null) high = latest.high;
    if (low == null) low = latest.low;
    prevClose = data.length >= 2 ? data[data.length - 2].close : (prevClose ?? latest.close);
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
    provider: quoteResult.status === 'fulfilled' ? 'yahoo' : (klineResult.status === 'fulfilled' ? 'yahoo' : 'none'),
    fallback: quoteResult.status !== 'fulfilled' || klineResult.status !== 'fulfilled',
    cached: false,
    stale: false,
    updatedAt: new Date(),
  };
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
  const globalDef = GLOBAL_INDEX_DEFS.find(d => d.code === symbol.toUpperCase());
  if (globalDef) {
    return getGlobalIndexDetail(globalDef);
  }

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
    endDate: query.endDate ? normalizeDate(query.endDate) : (query.startDate ? normalizeDate(new Date().toISOString().slice(0, 10)) : undefined),
  };
}

function isDateLike(value: string): boolean {
  return /^\d{4}-?\d{2}-?\d{2}$/.test(value);
}

function normalizeDate(value: string): string {
  return value.replaceAll('-', '');
}

export async function getMarketSectors(): Promise<ServiceResult<SectorListDto>> {
  const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider], dataSourceScorer);
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
  const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider], dataSourceScorer);
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
  const chain = new ProviderChain<MarketProvider>([stockSdkMarketProvider, eastMoneyMarketProvider], dataSourceScorer);
  const result = await cacheThrough('market:indices', ttl.marketQuotes, () =>
    chain.run('market.indices', (provider) => {
      if (!provider.indices) {
        throw new AppError('PROVIDER_UNAVAILABLE', `${provider.name} does not implement indices`, 501);
      }
      return provider.indices();
    }, { timeoutMs: 5000 })
  );

  return toServiceResult(result);
}

export async function getStockMoneyFlow(code: string, days?: number): Promise<ServiceResult<StockMoneyFlowDto>> {
  const stockSymbol = assertStockSymbol(code);
  const key = `market:money-flow:${stockSymbol}:${days ?? 1}`;
  const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider], dataSourceScorer);
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
  const key = 'market:money-flow:market';

  const cached = cache.get<ProviderChainResult<MarketMoneyFlowDto>>(key);
  if (cached) return toServiceResult(cached);

  try {
    const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider], dataSourceScorer);
    const result = await chain.run('market.marketMoneyFlow', (provider) => {
      if (!provider.marketMoneyFlow) {
        throw new AppError('PROVIDER_UNAVAILABLE', `${provider.name} does not implement marketMoneyFlow`, 501);
      }
      return provider.marketMoneyFlow();
    });
    if (result.data.date) {
      return toServiceResult(cache.set(key, result, ttl.marketMoneyFlow));
    }
    logger.warn('EastMoney market money flow returned empty date, trying akshare fallback', {
      provider: result.provider,
    });
  } catch (err) {
    logger.error('Market money flow providers failed, trying akshare fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const data = await getMarketMoneyFlowFromAkshare();
    const result: ProviderChainResult<MarketMoneyFlowDto> = {
      data,
      provider: 'akshare',
      fallback: true,
      stale: false,
      providerErrors: [],
    };
    return toServiceResult(cache.set(key, result, ttl.marketMoneyFlow));
  } catch (fallbackErr) {
    logger.error('Akshare market money flow fallback also failed', {
      error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
    });
    throw new AppError('PROVIDER_UNAVAILABLE', 'All providers failed for market money flow', 503);
  }
}

export async function getMarketBreadth(): Promise<ServiceResult<MarketBreadthDto>> {
  const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider], dataSourceScorer);
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
  const key = 'market:north-flow';

  const cached = cache.get<ProviderChainResult<NorthFlowDto>>(key);
  if (cached) return toServiceResult(cached);

  try {
    const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider], dataSourceScorer);
    const result = await chain.run('market.northFlow', (provider) => {
      if (!provider.northFlow) {
        throw new AppError('PROVIDER_UNAVAILABLE', `${provider.name} does not implement northFlow`, 501);
      }
      return provider.northFlow();
    });
    return toServiceResult(cache.set(key, result, ttl.marketNorthFlow));
  } catch (err) {
    logger.error('NorthFlow providers failed, trying akshare fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const data = await getNorthFlowFromAkshare();
    const result: ProviderChainResult<NorthFlowDto> = {
      data,
      provider: 'akshare',
      fallback: true,
      stale: false,
      providerErrors: [],
    };
    return toServiceResult(cache.set(key, result, ttl.marketNorthFlow));
  } catch (fallbackErr) {
    logger.error('Akshare north flow fallback also failed', {
      error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
    });
    throw new AppError('PROVIDER_UNAVAILABLE', 'All providers failed for north flow', 503);
  }
}

export async function getGlobalIndices(): Promise<ServiceResult<GlobalIndexListDto>> {
  const chain = new ProviderChain<MarketProvider>([eastMoneyMarketProvider, yahooMarketProvider], dataSourceScorer);
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

    const text = await fetchUrl(url.toString(), {
      timeoutMs: 10000,
      proxy: 'never',
      headers: { 'referer': 'https://quote.cngold.org/gjs/gjhj.html' },
    });

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

      const text = await fetchUrl(url.toString(), {
        timeoutMs: 10000,
        proxy: 'never',
        headers: { 'referer': 'https://quote.cngold.org/gjs/swhj_zghj.html' },
      });

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

    const text = await fetchUrl(url.toString(), {
      timeoutMs: 10000,
      proxy: 'never',
      headers: { 'referer': 'https://quote.cngold.org/gjs/swhj_zghj.html' },
    });

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

export interface SectorSpotItem {
  name: string;
  code: string;
  change_pct: string;
  main_inflow: string;
  raw_change: number | null;
  raw_main_inflow: number | null;
}

export async function getMarketSectorsFromAkshare(limit = 90): Promise<{
  items: SectorSpotItem[];
  source: string;
  error?: string;
}> {
  const clampedLimit = Math.min(Math.max(limit, 1), 120);

  // Primary: EastMoney via provider
  try {
    const result = await getMarketSectors();
    const items = result.data.items ?? [];
    if (items.length > 0) {
      return {
        source: result.provider,
        items: items.slice(0, clampedLimit).map(s => ({
          name: s.name,
          code: s.code,
          change_pct: s.changePercent != null ? `${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%` : '',
          main_inflow: s.mainNetInflow != null ? `${s.mainNetInflow >= 0 ? '+' : ''}${(s.mainNetInflow / 1e8).toFixed(2)}亿` : '',
          raw_change: s.changePercent,
          raw_main_inflow: s.mainNetInflow,
        })),
      };
    }
  } catch (err) {
    logger.error('EastMoney sectors failed, trying akshare fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Fallback: Python akshare (THS source)
  try {
    const spotResult = await runPython<Record<string, unknown>>('data_complete.py', {
      args: ['--source', 'akshare', '--type', 'sector_spot'],
      timeoutMs: 60_000,
    });
    const sectors = (spotResult?.sector_spot ?? []) as SectorSpotItem[];
    if (sectors.length > 0) {
      return {
        source: 'akshare_thailand',
        items: sectors.slice(0, clampedLimit),
      };
    }
  } catch (err) {
    logger.error('Akshare sectors fallback also failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    source: 'failed',
    items: [],
    error: '所有板块数据源均不可用',
  };
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
    const text = await fetchUrl(SINA_URL, {
      timeoutMs: 10000,
      proxy: 'never',
      encoding: 'gbk',
      headers: { Referer: 'https://finance.sina.com.cn' },
    });

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

export async function getAVolume7Days(): Promise<{
  success: boolean;
  data: Array<{ date: string; total: string; shanghai: string; shenzhen: string; beijing: string }>;
  update_time: string;
}> {
  const updateTime = new Date().toISOString();
  try {
    const now = new Date();
    const endDate = now.toISOString().slice(0, 10).replace(/-/g, '');
    const startDate = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');

    const [shResult, szResult] = await Promise.allSettled([
      getMarketKline('sh000001', { period: 'daily', startDate, endDate }),
      getMarketKline('sz399001', { period: 'daily', startDate, endDate }),
    ]);

    const shData = shResult.status === 'fulfilled' ? (shResult.value.data ?? []) : [];
    const szData = szResult.status === 'fulfilled' ? (szResult.value.data ?? []) : [];

    const shLast7 = shData.slice(-7);
    const szLast7 = szData.slice(-7);

    const volumeMap = new Map<string, { date: string; shanghai: number; shenzhen: number }>();

    for (const item of shLast7) {
      if (item.date && item.amount != null) {
        volumeMap.set(item.date, { date: item.date, shanghai: item.amount, shenzhen: 0 });
      }
    }

    for (const item of szLast7) {
      const d = item.date;
      if (!d) continue;
      const entry = volumeMap.get(d);
      if (entry) {
        entry.shenzhen = item.amount ?? 0;
      } else if (item.amount != null) {
        volumeMap.set(d, { date: d, shanghai: 0, shenzhen: item.amount });
      }
    }

    const result = Array.from(volumeMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-7)
      .map((item) => {
        const total = item.shanghai + item.shenzhen;
        return {
          date: item.date,
          total: `${(total / 1e8).toFixed(2)}亿`,
          shanghai: `${(item.shanghai / 1e8).toFixed(2)}亿`,
          shenzhen: `${(item.shenzhen / 1e8).toFixed(2)}亿`,
          beijing: '0亿',
        };
      });

    return { success: true, data: result, update_time: updateTime };
  } catch {
    return { success: false, data: [], update_time: updateTime };
  }
}

const A_SHARE_INDICES: Array<{ symbol: string; name: string; market: string }> = [
  { symbol: 'sh000001', name: '上证指数', market: 'A股' },
  { symbol: 'sz399001', name: '深证成指', market: 'A股' },
  { symbol: 'sz399006', name: '创业板指', market: 'A股' },
  { symbol: 'sh000300', name: '沪深300', market: 'A股' },
  { symbol: 'sh000688', name: '科创50', market: 'A股' },
];
const CN_INDEX_MAP = new Map(
  A_SHARE_INDICES.map((x) => [x.symbol.replace(/^(sh|sz|bj)/i, ''), x])
);

export async function getCombinedIndices(): Promise<Record<string, unknown>> {
  const updateTime = new Date().toISOString();
  const symbols = A_SHARE_INDICES.map((x) => x.symbol).join(',');

  const [cnResult, globalResult] = await Promise.allSettled([
    getMarketQuotes(symbols),
    getGlobalIndices(),
  ]);

  const indices: any[] = [];
  const returnedNumericCodes = new Set<string>();

  if (cnResult.status === 'fulfilled') {
    const quotes = cnResult.value.data ?? [];
    for (const q of quotes) {
      returnedNumericCodes.add(q.code);
      const knownIdx = CN_INDEX_MAP.get(q.code);
      indices.push({
        code: knownIdx?.symbol ?? q.symbol,
        name: q.name,
        price: q.price ?? null,
        change_pct: q.changePercent ?? null,
        change_amount: q.change ?? null,
        market: knownIdx?.market ?? 'A股',
      });
    }
  }

  for (const [numericCode, idx] of CN_INDEX_MAP) {
    if (!returnedNumericCodes.has(numericCode)) {
      indices.push({
        code: idx.symbol,
        name: idx.name,
        price: null,
        change_pct: null,
        change_amount: null,
        market: idx.market,
      });
    }
  }

  if (globalResult.status === 'fulfilled') {
    const globalItems = (globalResult.value.data.items ?? []).map((item) => ({
      code: item.code,
      name: item.name,
      price: item.price ?? null,
      change_pct: item.changePercent ?? null,
      change_amount: item.changeAmount ?? null,
      market: '全球',
    }));
    indices.push(...globalItems);
  }

  return {
    success: true,
    data: indices,
    update_time: updateTime,
  };
}

export async function getMarketOverview(): Promise<Record<string, unknown>> {
  const updateTime = new Date().toISOString();

  const symbols = A_SHARE_INDICES.map((x) => x.symbol).join(',');

  const [cnResult, globalResult, goldResult, volResult] = await Promise.allSettled([
    getMarketQuotes(symbols),
    getGlobalIndices(),
    fetchGoldRealtime(),
    getAVolume7Days(),
  ]);

  const indices: any[] = [];
  const returnedNumericCodes = new Set<string>();

  if (cnResult.status === 'fulfilled') {
    const quotes = cnResult.value.data ?? [];
    for (const q of quotes) {
      returnedNumericCodes.add(q.code);
      const knownIdx = CN_INDEX_MAP.get(q.code);
      indices.push({
        code: knownIdx?.symbol ?? q.symbol,
        name: q.name,
        price: q.price ?? null,
        change_pct: q.changePercent ?? null,
        change_amount: q.change ?? null,
        market: knownIdx?.market ?? 'A股',
      });
    }
  }

  for (const [numericCode, idx] of CN_INDEX_MAP) {
    if (!returnedNumericCodes.has(numericCode)) {
      indices.push({
        code: idx.symbol,
        name: idx.name,
        price: null,
        change_pct: null,
        change_amount: null,
        market: idx.market,
      });
    }
  }

  if (globalResult.status === 'fulfilled') {
    const globalItems = (globalResult.value.data.items ?? []).map((item) => ({
      code: item.code,
      name: item.name,
      price: item.price ?? null,
      change_pct: item.changePercent ?? null,
      change_amount: item.changeAmount ?? null,
      market: '全球',
    }));
    indices.push(...globalItems);
  }

  const goldRealtime = goldResult.status === 'fulfilled'
    ? goldResult.value
    : { success: false, data: [], update_time: updateTime };

  const aVolume7days = volResult.status === 'fulfilled'
    ? volResult.value
    : { success: false, data: [], update_time: updateTime };

  return {
    success: true,
    market_index: { success: true, data: indices },
    gold_realtime: goldRealtime,
    a_volume_7days: aVolume7days,
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

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
