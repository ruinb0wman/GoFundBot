/**
 * 回测用的「收益序列」口径 —— 一个函数，所有回测取数路径共用。
 *
 * 单位净值（`nav`）在**份额拆分**当天会跳水：512010 在 2021-06-24 由 3.206 → 0.8207（1:4），
 * 在单位净值序列里这就是一根 −75% 的假阴线。拿它当收益序列，止损/动量/回撤/夏普全被污染
 * （拆分当天该腿「暴跌」触发止损，回撤与波动被记成 −75%）。
 *
 * 累计净值（`accNav`）在拆分当天连续、分红也一并累计，所以**优先用它**；
 * 只有当这条序列里累计净值基本缺失（<95% 的点有值，多见于货币基金或低质量数据源）时才退回单位净值。
 * 拆分与分红的实测清单见 `docs/architecture/backtest-engine.md`。
 */
import type { NavPoint } from './backtestTypes.js';

interface RawNavItem {
  date?: unknown;
  nav?: unknown;
  /** 累计净值（东财 `Data_ACWorthTrend`）；缺失时为 null。 */
  accNav?: unknown;
}

function positive(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/** `items` → 回测用 `NavPoint[]`（口径见文件头）。缺日期/净值的行直接丢弃。 */
export function toReturnNavPoints(items: unknown): NavPoint[] {
  if (!Array.isArray(items)) return [];
  const rows: { date: string; nav: number; accNav: number | null }[] = [];
  for (const raw of items) {
    const item = raw as RawNavItem;
    const nav = positive(item?.nav);
    const date = String(item?.date ?? '').slice(0, 10);
    if (!date || nav === null) continue;
    rows.push({ date, nav, accNav: positive(item?.accNav) });
  }
  if (rows.length === 0) return [];
  const withAcc = rows.filter((row) => row.accNav !== null);
  if (withAcc.length >= rows.length * 0.95) {
    return withAcc.map((row) => ({ date: row.date, nav: row.accNav as number }));
  }
  return rows.map((row) => ({ date: row.date, nav: row.nav }));
}
