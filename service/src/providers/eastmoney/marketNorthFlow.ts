import { AppError } from '../../core/errors.js';
import type { NorthFlowDto } from '../types.js';
import { fetchJson } from './eastmoneyRequest.js';

/**
 * 北向资金数据（东方财富数据中心 RPT_MUTUAL_DEAL_HISTORY）。
 *
 * 为什么不再用 push2 `.../kamt.kline/get`：
 * 2024-08-19 起沪深交易所调整沪深港通交易信息披露机制，北向资金不再披露
 * 实时买入额/卖出额/净买入，只在每交易日收市后公布当日成交总额。
 * push2 那条接口的净额字段从此恒为 `0.00`（注意是 0 而不是 null，容易被误读成
 * 「北向零流入」），也没有成交总额，所以整个接口对本场景已经无用。
 *
 * 现在唯一还有数据的北向口径是数据中心 `DEAL_AMT`（当日成交总额），因此 `*NetInflow`
 * 一律返回 null，由前端按「净流入不可用 + 成交总额可用」呈现。
 *
 * 单位坑：`DEAL_AMT` 的单位是**百万元**，不是万元（亿元 = 值 / 100）。
 * 实测 2026-09-21：北向 283911.86 / 沪股通 133832.25 / 深股通 150079.61，
 * 对应新闻口径「沪深股通合计成交 2839.12 亿、沪股通 1338.32 亿」，即除以 100。
 * （对比：push2 kamt/get 的字段才是万元——它的 dayAmtThreshold=5200000 即 520 亿额度。）
 */

const DATA_REFERER = 'https://data.eastmoney.com/';
const DATA_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

const MUTUAL_TYPES = { total: '005', sh: '001', sz: '003' } as const;

interface MutualDealRow {
  date: string;
  dealAmount: number | null;
}

export async function fetchMarketNorthFlow(): Promise<NorthFlowDto> {
  const [total, sh, sz] = await Promise.all([
    fetchMutualDeal(MUTUAL_TYPES.total),
    fetchMutualDeal(MUTUAL_TYPES.sh),
    fetchMutualDeal(MUTUAL_TYPES.sz),
  ]);

  return {
    date: total.date || sh.date || sz.date || '',
    shNetInflow: null,
    szNetInflow: null,
    totalNetInflow: null,
    shDealAmount: sh.dealAmount,
    szDealAmount: sz.dealAmount,
    totalDealAmount: total.dealAmount,
  };
}

async function fetchMutualDeal(mutualType: string): Promise<MutualDealRow> {
  const params = new URLSearchParams({
    reportName: 'RPT_MUTUAL_DEAL_HISTORY',
    columns: 'TRADE_DATE,FUND_INFLOW,NET_DEAL_AMT,DEAL_AMT',
    filter: `(MUTUAL_TYPE="${mutualType}")`,
    sortColumns: 'TRADE_DATE',
    sortTypes: '-1',
    pageSize: '1',
    pageNumber: '1',
    source: 'WEB',
    client: 'WEB',
  });

  const respData = await fetchJson(`${DATA_URL}?${params.toString()}`, 15000, DATA_REFERER);
  const result = (respData.result ?? null) as Record<string, unknown> | null;
  const rows = (result?.data ?? []) as Record<string, unknown>[];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError('PROVIDER_UNAVAILABLE', `North flow ${mutualType} returned no rows`, 502);
  }

  const row = rows[0];
  return {
    date: String(row.TRADE_DATE ?? '').slice(0, 10),
    dealAmount: toNullableNumber(row.DEAL_AMT),
  };
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
