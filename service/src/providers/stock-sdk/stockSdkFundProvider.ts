import type {
  FundDividendDto,
  FundDividendListDto,
  FundEstimateDto,
  FundNavHistoryDto,
  FundNavPointDto,
  FundRankHistoryDto,
  FundRankPointDto,
  FundTotalReturnTrendDto,
} from '../../types/fund.js';
import type { FundNavHistoryOptions, FundProvider } from '../types.js';
import { getStockSdk } from './stockSdkClient.js';

export class StockSdkFundProvider implements FundProvider {
  readonly name = 'stock-sdk';

  async estimate(code: string): Promise<FundEstimateDto> {
    assertStockSdkNotForcedToFail();
    return mapFundEstimate(await getStockSdk().fund.estimate(code));
  }

  async navHistory(code: string, options: FundNavHistoryOptions = {}): Promise<FundNavHistoryDto> {
    assertStockSdkNotForcedToFail();
    const data = mapFundNavHistory(await getStockSdk().fund.navHistory(code));
    return filterNavHistory(data, options);
  }

  async rankHistory(code: string): Promise<FundRankHistoryDto> {
    assertStockSdkNotForcedToFail();
    return mapFundRankHistory(await getStockSdk().fund.rankHistory(code));
  }

  async dividends(code: string): Promise<FundDividendListDto> {
    assertStockSdkNotForcedToFail();
    return mapFundDividendList(await getStockSdk().fund.dividendList({ code, page: 'all' }));
  }

  async totalReturnTrend(code: string): Promise<FundTotalReturnTrendDto> {
    assertStockSdkNotForcedToFail();
    const navData = mapFundNavHistory(await getStockSdk().fund.navHistory(code));
    const items = navData.items;
    if (items.length < 2) return { series: [] };
    const firstNav = items[0].nav;
    if (!firstNav || firstNav <= 0) return { series: [] };
    const data = items
      .filter(i => i.timestamp != null && i.nav > 0)
      .map(i => [i.timestamp, ((i.nav - firstNav) / firstNav) * 100]);
    return { series: [{ name: '本基金', data }] };
  }
}

function assertStockSdkNotForcedToFail(): void {
  if (process.env.DATA_SERVICE_FORCE_STOCK_SDK_FAILURE === '1') {
    throw new Error('Forced stock-sdk provider failure');
  }
}

function filterNavHistory(data: FundNavHistoryDto, range: FundNavHistoryOptions): FundNavHistoryDto {
  const start = range.startDate ? normalizeDate(range.startDate) : null;
  const end = range.endDate ? normalizeDate(range.endDate) : null;

  if (!start && !end) {
    return data;
  }

  return {
    ...data,
    items: data.items.filter((item) => {
      const date = normalizeDate(item.date);
      return (!start || date >= start) && (!end || date <= end);
    }),
  };
}

function normalizeDate(value: string): string {
  return value.replaceAll('-', '');
}

function mapFundEstimate(raw: unknown): FundEstimateDto {
  const item = asRecord(raw);
  return {
    code: toStringValue(item.code),
    name: toNullableString(item.name),
    navDate: toNullableString(item.navDate),
    nav: toNullableNumber(item.nav),
    estimatedNav: toNullableNumber(item.estimatedNav),
    estimatedChangePercent: toNullableNumber(item.estimatedChangePercent),
    estimateTime: toNullableString(item.estimateTime),
    isMoneyFund: false,
    sevenDayYield: null,
    unitIncome: null,
  };
}

function mapFundNavHistory(raw: unknown): FundNavHistoryDto {
  const item = asRecord(raw);
  const rows = Array.isArray(item.items) ? item.items : [];
  return {
    code: toStringValue(item.code),
    name: toNullableString(item.name),
    items: rows.map(mapFundNavPoint),
  };
}

function mapFundNavPoint(raw: unknown): FundNavPointDto {
  const item = asRecord(raw);
  const timestamp = toNullableNumber(item.timestamp);
  return {
    date: chinaDateFromTimestamp(timestamp) ?? toStringValue(item.date),
    timestamp,
    nav: toNumberValue(item.nav),
    accNav: toNullableNumber(item.accNav),
    dailyReturn: toNullableNumber(item.dailyReturn),
    unitMoney: toStringValue(item.unitMoney),
  };
}

function mapFundRankHistory(raw: unknown): FundRankHistoryDto {
  const item = asRecord(raw);
  const rows = Array.isArray(item.items) ? item.items : [];
  return {
    code: toStringValue(item.code),
    name: toNullableString(item.name),
    items: rows.map(mapFundRankPoint),
  };
}

function mapFundRankPoint(raw: unknown): FundRankPointDto {
  const item = asRecord(raw);
  const timestamp = toNullableNumber(item.timestamp);
  return {
    date: chinaDateFromTimestamp(timestamp) ?? toStringValue(item.date),
    timestamp,
    rank: toNullableNumber(item.rank),
    total: toNullableNumber(item.total),
    percentile: toNullableNumber(item.percentile),
  };
}

function mapFundDividendList(raw: unknown): FundDividendListDto {
  const item = asRecord(raw);
  const rows = Array.isArray(item.items) ? item.items : [];
  return {
    items: rows.map(mapFundDividend),
    totalPages: toNumberValue(item.totalPages),
    pageSize: toNumberValue(item.pageSize),
    currentPage: toNumberValue(item.currentPage),
  };
}

function mapFundDividend(raw: unknown): FundDividendDto {
  const item = asRecord(raw);
  return {
    code: toStringValue(item.code),
    name: toStringValue(item.name),
    equityRecordDate: toNullableString(item.equityRecordDate),
    exDividendDate: toNullableString(item.exDividendDate),
    dividendPerShare: toNullableNumber(item.dividendPerShare),
    payDate: toNullableString(item.payDate),
    dividendType: toNullableString(item.dividendType),
  };
}

/**
 * stock-sdk 的 `date` 字段是 `new Date(x).toISOString().slice(0,10)`（见其 dist 的 `Nr`），
 * 而东财 pingzhongdata 的 `x` 是「北京时间零点」（= UTC 前一天 16:00）→ 整条序列早一天，
 * 连周日的净值都会冒出来（实测 2026-09-27 是周日）。有 timestamp 时按 Asia/Shanghai 重算，
 * 与 `eastmoneyFundProvider` 的 `formatChinaDate` 对齐。
 */
function chinaDateFromTimestamp(timestamp: number | null): string | null {
  if (timestamp == null) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toStringValue(value: unknown): string {
  return value == null ? '' : String(value);
}

function toNullableString(value: unknown): string | null {
  return value == null || value === '' ? null : String(value);
}

function toNumberValue(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
