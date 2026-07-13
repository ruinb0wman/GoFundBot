import type { GlobalIndexListDto, KlineDto, KlineOptions, MarketProvider, MarketQuoteDto } from '../types.js';
import { AppError } from '../../core/errors.js';
import { fetchYahooChart, fetchYahooGlobalIndices, isGlobalIndexSymbol } from './yahooClient.js';

export class YahooMarketProvider implements MarketProvider {
  readonly name = 'yahoo';

  async quotes(_symbols: string[]): Promise<MarketQuoteDto[]> {
    throw new AppError('PROVIDER_UNAVAILABLE', 'YahooMarketProvider does not implement quotes', 501);
  }

  async kline(symbol: string, options: KlineOptions): Promise<KlineDto[]> {
    if (!isGlobalIndexSymbol(symbol)) {
      return [];
    }

    const points = await fetchYahooChart(symbol, options.period, options.startDate, options.endDate);

    return points.map((p) => {
      const change = p.close != null && p.open != null ? p.close - p.open : null;
      const changePercent = p.open != null && p.open !== 0 && change != null ? (change / p.open) * 100 : null;

      return {
        code: symbol,
        date: p.timestamp ? new Date(p.timestamp).toISOString().slice(0, 10).replace(/-/g, '') : '',
        timestamp: p.timestamp,
        open: p.open,
        close: p.close,
        high: p.high,
        low: p.low,
        volume: p.volume,
        amount: null,
        change,
        changePercent,
        turnoverRate: null,
      };
    });
  }

  async globalIndices(): Promise<GlobalIndexListDto> {
    return fetchYahooGlobalIndices();
  }
}
