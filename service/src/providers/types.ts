import type {
  FundAssetAllocationDto,
  FundDividendListDto,
  FundEstimateDto,
  FundBasicDto,
  FundHolderStructureDto,
  FundHoldingsDto,
  FundManagersDto,
  FundNavHistoryDto,
  FundPerformanceDto,
  FundPerformanceEvaluationDto,
  FundPositionTrendItemDto,
  FundRankHistoryDto,
  FundScaleFluctuationDto,
  FundScreeningSnapshotDto,
  FundSearchResultDto,
  FundSubscriptionRedemptionDto,
  FundTotalReturnTrendDto,
} from '../types/fund.js';
import type { StockReferenceDto } from '../models/stock.js';

export interface FundNavHistoryOptions {
  startDate?: string;
  endDate?: string;
}

export interface FundScreeningSnapshotOptions {
  types?: string[];
  sort?: string;
  pageSize?: number;
  limitPerType?: number;
}

export interface KlineOptions {
  period: 'daily' | 'weekly' | 'monthly';
  adjust: '' | 'qfq' | 'hfq';
  startDate?: string;
  endDate?: string;
}

export interface MarketQuoteDto {
  symbol: string;
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
  market: string;
  assetType: string;
  source?: string;
  date?: string;
}

export interface KlineDto {
  code: string;
  date?: string;
  time?: string;
  timestamp: number | null;
  open: number | null;
  close: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  amount: number | null;
  change: number | null;
  changePercent: number | null;
  turnoverRate: number | null;
}

export interface SectorDto {
  code: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  mainNetInflow: number | null;
  turnoverRate: number | null;
  date?: string;
}

export interface SectorListDto {
  items: SectorDto[];
}

export interface ConstituentDto {
  code: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  marketValue: number | null;
  pe: number | null;
  turnoverRate: number | null;
}

export interface ConstituentListDto {
  items: ConstituentDto[];
  sectorCode: string;
  sectorName: string | null;
}

export interface IndexDto {
  code: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  changeAmount: number | null;
  market: string;
}

export interface IndexListDto {
  items: IndexDto[];
}

export interface StockMoneyFlowPointDto {
  date: string;
  mainNetInflow: number | null;
  superLargeNetInflow: number | null;
  largeNetInflow: number | null;
  mediumNetInflow: number | null;
  smallNetInflow: number | null;
  mainNetInflowRatio: number | null;
}

export interface StockMoneyFlowDto {
  code: string;
  name: string | null;
  items: StockMoneyFlowPointDto[];
}

export interface MarketMoneyFlowDto {
  date: string;
  mainNetInflow: number | null;
  superLargeNetInflow: number | null;
  largeNetInflow: number | null;
  mediumNetInflow: number | null;
  smallNetInflow: number | null;
}

export interface MarketBreadthDto {
  upCount: number;
  downCount: number;
  flatCount: number;
  /** 涨停家数；涨跌停池取不到时为 null（不再填假值） */
  limitUp: number | null;
  /** 跌停家数；涨跌停池取不到时为 null */
  limitDown: number | null;
  total: number;
  /** 统计口径，例如 '沪深两市' */
  scope: string;
  /** 数据日期 YYYY-MM-DD（来自指数行情 f124） */
  date: string;
}

export interface LimitUpStockDto {
  code: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  amount: number | null;
  reason: string | null;
  firstTime: string | null;
  lastTime: string | null;
  openCount: number;
  continuousDays: number;
}

export interface LimitUpStockListDto {
  items: LimitUpStockDto[];
}

export interface NorthFlowDto {
  date: string;
  /** 恒为 null：2024-08-19 起沪深港通不再披露北向资金净流入 */
  shNetInflow: number | null;
  szNetInflow: number | null;
  totalNetInflow: number | null;
  /** 当日成交总额，单位百万元（亿元 = 值 / 100），沪股通。注意不是万元 */
  shDealAmount: number | null;
  /** 当日成交总额，单位百万元（亿元 = 值 / 100），深股通 */
  szDealAmount: number | null;
  /** 当日成交总额，单位百万元（亿元 = 值 / 100），北向合计 */
  totalDealAmount: number | null;
}

export interface GlobalIndexDto {
  code: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  changeAmount: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  market: string | null;
  date?: string;
  /** ISO 完整时间（含时分秒），来自交易所最近成交时间 */
  updateTime?: string;
}

export interface GlobalIndexListDto {
  items: GlobalIndexDto[];
}

export interface NewsItemDto {
  title: string;
  summary: string | null;
  url: string | null;
  source: string;
  publishedAt: string | null;
}

export interface NewsListDto {
  items: NewsItemDto[];
  total?: number;
  hasMore?: boolean;
}

export interface FundProvider {
  name: string;
  estimate(code: string): Promise<FundEstimateDto>;
  navHistory(code: string, options?: FundNavHistoryOptions): Promise<FundNavHistoryDto>;
  rankHistory(code: string): Promise<FundRankHistoryDto>;
  dividends(code: string): Promise<FundDividendListDto>;
  search?(keyword: string): Promise<FundSearchResultDto>;
  screeningSnapshot?(options?: FundScreeningSnapshotOptions): Promise<FundScreeningSnapshotDto>;
  basic?(code: string): Promise<FundBasicDto>;
  holdings?(code: string): Promise<FundHoldingsDto>;
  managers?(code: string): Promise<FundManagersDto>;
  assetAllocation?(code: string): Promise<FundAssetAllocationDto>;
  performance?(code: string): Promise<FundPerformanceDto>;
  performanceEvaluation?(code: string): Promise<FundPerformanceEvaluationDto>;
  subscriptionRedemption?(code: string): Promise<FundSubscriptionRedemptionDto>;
  holderStructure?(code: string): Promise<FundHolderStructureDto>;
  sameTypeFunds?(code: string): Promise<unknown[][]>;
  scaleFluctuation?(code: string): Promise<FundScaleFluctuationDto>;
  positionTrend?(code: string): Promise<FundPositionTrendItemDto[]>;
  totalReturnTrend?(code: string): Promise<FundTotalReturnTrendDto>;
}

export interface MarketProvider {
  name: string;
  quotes(symbols: string[]): Promise<MarketQuoteDto[]>;
  kline(symbol: string, options: KlineOptions): Promise<KlineDto[]>;
  indices?(): Promise<IndexListDto>;
  sectors?(): Promise<SectorListDto>;
  sectorConstituents?(code: string): Promise<ConstituentListDto>;
  moneyFlow?(code: string, days?: number): Promise<StockMoneyFlowDto>;
  marketMoneyFlow?(): Promise<MarketMoneyFlowDto>;
  breadth?(): Promise<MarketBreadthDto>;
  limitUpStocks?(limit?: number): Promise<LimitUpStockListDto>;
  northFlow?(): Promise<NorthFlowDto>;
  globalIndices?(): Promise<GlobalIndexListDto>;
}

export interface StockProvider {
  name: string;
  reference(code: string): Promise<StockReferenceDto>;
}

export interface NewsProvider {
  name: string;
  flashNews?(count?: number): Promise<NewsListDto>;
}

export interface ProviderErrorSummary {
  provider: string;
  message: string;
  code?: unknown;
}

export interface ProviderChainResult<T> {
  data: T;
  provider: string;
  fallback: boolean;
  stale: boolean;
  providerErrors: ProviderErrorSummary[];
}
