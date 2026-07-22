import type { FundProvider, FundNavHistoryOptions } from '../types.js';
import type { FundNavHistoryDto, FundNavPointDto, FundRankHistoryDto, FundRankPointDto } from '../../types/fund.js';
import { jqQuery, hasJoinquantKey } from './joinquantClient.js';

export class JoinQuantFundProvider implements FundProvider {
  readonly name = 'joinquant';

  async estimate(): Promise<never> {
    throw new Error('JoinQuant does not support real-time fund estimates');
  }

  async navHistory(code: string, _options?: FundNavHistoryOptions): Promise<FundNavHistoryDto> {
    assertKeyConfigured();

    const rows = await jqQuery<Record<string, unknown>>({
      table: 'fund_nav',
      columns: ['day', 'net_value', 'total_value', 'daily_return'],
      filter: `code='${code}'`,
      orderBy: 'day',
    });

    const items: FundNavPointDto[] = rows.map((row) => {
      const date = String(row.day ?? '');
      const nav = toNum(row.net_value);
      return {
        date,
        timestamp: date ? new Date(date).getTime() : null,
        nav: nav ?? 0,
        accNav: toNum(row.total_value),
        dailyReturn: toNum(row.daily_return),
        unitMoney: '元',
      };
    });

    return { code, name: '', items };
  }

  async rankHistory(code: string): Promise<FundRankHistoryDto> {
    assertKeyConfigured();

    const rows = await jqQuery<Record<string, unknown>>({
      table: 'fund_rank',
      columns: ['day', 'rank', 'total_count'],
      filter: `code='${code}'`,
      orderBy: 'day',
    });

    const items: FundRankPointDto[] = rows.map((row) => {
      const date = String(row.day ?? '');
      return {
        date,
        timestamp: date ? new Date(date).getTime() : null,
        rank: toNum(row.rank),
        total: toNum(row.total_count),
        percentile: null,
      };
    });

    return { code, name: '', items };
  }

  async dividends(): Promise<never> {
    throw new Error('JoinQuant does not implement fund dividends');
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
