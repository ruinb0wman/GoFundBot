import type { FundProvider, FundNavHistoryOptions } from '../types.js';
import type { FundEstimateDto, FundNavHistoryDto, FundNavPointDto, FundTotalReturnTrendDto } from '../../types/fund.js';
import { fetchUrl } from '../../core/fetch.js';

const ESTIMATE_URL = 'https://web.ifzq.gtimg.cn/app/fund/estimate';
const NAV_HISTORY_URL = 'https://web.ifzq.gtimg.cn/app/fund/funddaily';

export class TencentFundProvider implements FundProvider {
  readonly name = 'tencent-fund';

  async estimate(code: string): Promise<FundEstimateDto> {
    const data = await fetchUrl<Record<string, unknown>>(`${ESTIMATE_URL}?code=${code}`, {
      timeoutMs: 8000,
      proxy: 'never',
      as: 'json',
      headers: { Referer: 'https://gu.qq.com/' },
    });

    const info = (data.data ?? data) as Record<string, unknown>;
    return {
      code,
      name: toNullableStr(info.fund_name ?? info.name),
      navDate: toNullableStr(info.nav_date ?? info.date),
      nav: toNullableNum(info.nav ?? info.dwjz),
      estimatedNav: toNullableNum(info.estimate ?? info.gsz),
      estimatedChangePercent: toNullableNum(info.estimate_change ?? info.gszzl),
      estimateTime: toNullableStr(info.estimate_time ?? info.gztime),
    };
  }

  async navHistory(code: string, options?: FundNavHistoryOptions): Promise<FundNavHistoryDto> {
    const params = new URLSearchParams({ code });
    if (options?.startDate) params.set('start', options.startDate.replaceAll('-', ''));
    if (options?.endDate) params.set('end', options.endDate.replaceAll('-', ''));

    const data = await fetchUrl<Record<string, unknown>>(`${NAV_HISTORY_URL}?${params.toString()}`, {
      timeoutMs: 10000,
      proxy: 'never',
      as: 'json',
      headers: { Referer: 'https://gu.qq.com/' },
    });

    const dataNode = (data.data ?? data) as Record<string, unknown>;
    const klines = dataNode.klines ?? dataNode.records ?? dataNode.data;
    const rows = Array.isArray(klines) ? (klines as Record<string, unknown>[]) : [];

    const items: FundNavPointDto[] = rows.map((row) => {
      const date = String(row.day ?? row.date ?? row[0] ?? '');
      const timestamp = date ? new Date(date).getTime() : null;
      const navVal = toNullableNum(row.net_value ?? row.netValue ?? row.nav ?? row[1]);
      return {
        date,
        timestamp,
        nav: navVal ?? 0,
        accNav: toNullableNum(row.acc_value ?? row.total_value ?? row.accNav ?? row[2]),
        dailyReturn: toNullableNum(row.daily_return ?? row.dailyReturn ?? row[3]),
        unitMoney: '元',
      };
    });

    return { code, name: null, items };
  }

  async rankHistory(): Promise<never> {
    throw new Error('Tencent fund does not implement rank history');
  }

  async dividends(): Promise<never> {
    throw new Error('Tencent fund does not implement dividends');
  }

  async totalReturnTrend(code: string): Promise<FundTotalReturnTrendDto> {
    const navData = await this.navHistory(code);
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

function toNullableStr(value: unknown): string | null {
  return value == null || value === '' ? null : String(value);
}

function toNullableNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
