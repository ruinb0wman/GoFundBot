import type { KlineDto, KlineOptions, MarketProvider, MarketQuoteDto } from '../types.js';
import { jqQuery, hasJoinquantKey } from './joinquantClient.js';

export class JoinQuantMarketProvider implements MarketProvider {
  readonly name = 'joinquant';

  async quotes(): Promise<MarketQuoteDto[]> {
    throw new Error('JoinQuant does not support real-time quotes');
  }

  async kline(symbol: string, options: KlineOptions): Promise<KlineDto[]> {
    assertKeyConfigured();

    const cleanCode = symbol.replace(/^(sh|sz|bj)/i, '');
    let table: string;
    switch (options.period) {
      case 'weekly': table = 'stock_weekly'; break;
      case 'monthly': table = 'stock_monthly'; break;
      default: table = 'stock_daily';
    }

    const filter = [`code='${cleanCode}'`];
    if (options.startDate) filter.push(`day>='${options.startDate.replaceAll('-', '')}'`);
    if (options.endDate) filter.push(`day<='${options.endDate.replaceAll('-', '')}'`);

    const rows = await jqQuery<Record<string, unknown>>({
      table,
      columns: ['day', 'open', 'close', 'high', 'low', 'volume', 'amount', 'change', 'pct_change'],
      filter: filter.join('&'),
      orderBy: 'day',
    });

    return rows.map((row) => {
      const date = String(row.day ?? '');
      return {
        code: cleanCode,
        date,
        timestamp: date ? new Date(date).getTime() : null,
        open: toNum(row.open),
        close: toNum(row.close),
        high: toNum(row.high),
        low: toNum(row.low),
        volume: toNum(row.volume),
        amount: toNum(row.amount),
        change: toNum(row.change),
        changePercent: toNum(row.pct_change),
        turnoverRate: null,
      };
    });
  }
}

function assertKeyConfigured(): void {
  if (!hasJoinquantKey()) {
    throw new Error('JoinQuant API key not configured');
  }
}

function toNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
