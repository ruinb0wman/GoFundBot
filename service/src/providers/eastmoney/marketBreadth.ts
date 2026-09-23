import type { MarketBreadthDto } from '../types.js';
import { fetchJson } from './eastmoneyRequest.js';

/**
 * 市场涨跌统计（沪深两市合计）。
 *
 * 关键：涨跌家数是 `f104/f105/f106`，不是 `f168/f169/f170`。
 * `f168/f169/f170/f171` 是「换手率/涨跌额/涨跌幅/振幅」（未传 fltt=2 时放大 100 倍），
 * 早期实现误把它们当成 up/down/flat，导致返回「68/873/22、合计 963」这种半截数据。
 *
 * 涨跌家数口径：上证指数（1.000001）的 f104/f105/f106 = 沪市全体，
 * 深证成指（0.399001）的 f104/f105/f106 = 深市全体，两者相加即沪深两市合计。
 *
 * 涨跌停家数来自 push2ex 涨/跌停池的 `tc`，该接口必须带 date=YYYYMMDD。
 */

const QUOTE_REFERER = 'https://quote.eastmoney.com/';
const ULIST_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
const ZT_POOL_URL = 'https://push2ex.eastmoney.com/getTopicZTPool';
const DT_POOL_URL = 'https://push2ex.eastmoney.com/getTopicDTPool';
const POOL_UT = '7eea3edcaed734bea9cbfc24409ed989';

/** 沪深两市正常交易日合计家数量级约 5000+，低于该下限视为半截/异常数据 */
const MIN_TOTAL = 3000;
const MAX_TOTAL = 7000;

interface MarketCounts {
  up: number;
  down: number;
  flat: number;
}

export async function fetchMarketBreadth(): Promise<MarketBreadthDto> {
  const empty: MarketBreadthDto = {
    upCount: 0,
    downCount: 0,
    flatCount: 0,
    limitUp: null,
    limitDown: null,
    total: 0,
    scope: '沪深两市',
    date: '',
  };

  try {
    const params = new URLSearchParams({
      fltt: '2',
      invt: '2',
      secids: '1.000001,0.399001',
      fields: 'f12,f14,f104,f105,f106,f124',
    });
    const respData = await fetchJson(`${ULIST_URL}?${params.toString()}`, 10000, QUOTE_REFERER);
    const dataNode = (respData.data ?? respData) as Record<string, unknown>;
    const diff = (dataNode.diff ?? []) as Record<string, unknown>[];
    const rows: Record<string, unknown>[] = Array.isArray(diff)
      ? diff
      : (Object.values(diff) as Record<string, unknown>[]);

    const shRow = findMarketRow(rows, '000001');
    const szRow = findMarketRow(rows, '399001');
    if (!shRow || !szRow) return empty;

    const sh = toCounts(shRow);
    const sz = toCounts(szRow);
    const upCount = sh.up + sz.up;
    const downCount = sh.down + sz.down;
    const flatCount = sh.flat + sz.flat;
    const total = upCount + downCount + flatCount;

    // 半截数据（只回一个市场、或字段缺失）宁可报不可用，也不报局部数字
    if (total < MIN_TOTAL || total > MAX_TOTAL || (upCount === 0 && downCount === 0)) {
      return empty;
    }

    const date = toShanghaiDate(shRow.f124);
    const dateCompact = date.replace(/-/g, '');
    const [limitUp, limitDown] = await Promise.all([
      fetchPoolCount(ZT_POOL_URL, 'fbt:asc', dateCompact),
      fetchPoolCount(DT_POOL_URL, 'fund:asc', dateCompact),
    ]);

    return { upCount, downCount, flatCount, limitUp, limitDown, total, scope: '沪深两市', date };
  } catch {
    return empty;
  }
}

function findMarketRow(rows: Record<string, unknown>[], code: string): Record<string, unknown> | null {
  return rows.find((item) => String(item.f12 ?? '') === code) ?? null;
}

function toCounts(row: Record<string, unknown>): MarketCounts {
  return { up: toInt(row.f104), down: toInt(row.f105), flat: toInt(row.f106) };
}

/** 涨/跌停池计数；失败或池内无数据返回 null（非交易日、休市、接口变更等） */
async function fetchPoolCount(url: string, sort: string, date: string): Promise<number | null> {
  if (!date) return null;
  const params = new URLSearchParams({
    ut: POOL_UT,
    dpt: 'wz.ztzt',
    Pageindex: '0',
    pagesize: '1',
    sort,
    date,
  });
  try {
    const respData = await fetchJson(`${url}?${params.toString()}`, 10000, QUOTE_REFERER);
    const dataNode = (respData.data ?? null) as Record<string, unknown> | null;
    if (!dataNode) return null;
    const tc = toNum(dataNode.tc);
    return tc != null ? tc : null;
  } catch {
    return null;
  }
}

/** Unix 秒 → 东八区日期 YYYY-MM-DD（不能用 toISOString，那是 UTC） */
function toShanghaiDate(value: unknown): string {
  const ts = toNum(value);
  if (!ts) return '';
  const shifted = new Date((ts + 8 * 3600) * 1000).toISOString();
  const date = shifted.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function toNum(value: unknown): number | null {
  if (value == null || value === '' || value === '-') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toInt(value: unknown): number {
  const num = toNum(value);
  return num != null ? Math.floor(num) : 0;
}
