/**
 * Fund-level backtest entry point: fetch NAV history, then run the local engine.
 *
 * Replaces `POST /api/backtest/fixed-investment` (Node → pythonRunner → backtest.py)
 * for both the 定投回测 page and the chat tools. The NAV endpoint and its 24h server
 * cache are reused; no new data plumbing.
 */

import api from '../api';
import { runBacktest } from './backtestEngine';
import type { BacktestFailure, BacktestResult, BacktestSpec, NavPoint } from './backtestTypes';

export interface BacktestRequest extends BacktestSpec {
  startDate?: string;
  endDate?: string;
  /** In-memory NAV (skips the HTTP call) — used by the chat tools when they already have it. */
  navHistory?: NavPoint[];
}

interface NavItem {
  date?: string;
  nav?: number | string;
}

/** Tolerant unwrap: the service wraps payloads as { success, data: {...} }. */
function unwrapItems(body: unknown): NavItem[] {
  const envelope = body as { data?: unknown } | undefined;
  const payload = (envelope?.data ?? envelope) as { items?: NavItem[] } | undefined;
  return Array.isArray(payload?.items) ? payload.items : [];
}

export async function fetchNavHistory(fundCode: string, startDate?: string, endDate?: string): Promise<NavPoint[]> {
  const params: Record<string, string> = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  const res = await api.get(`/funds/${fundCode}/nav-history`, { params });
  return unwrapItems((res as { data?: unknown })?.data)
    .filter((item): item is { date: string; nav: number | string } => Boolean(item?.date) && item?.nav != null)
    .map((item) => ({ date: String(item.date).slice(0, 10), nav: Number(item.nav) }))
    .filter((item) => Number.isFinite(item.nav) && item.nav > 0);
}

function inRange(dates: { startDate?: string; endDate?: string }, date: string): boolean {
  if (dates.startDate && date < dates.startDate) return false;
  if (dates.endDate && date > dates.endDate) return false;
  return true;
}

/**
 * Restrict a NAV series to a date range (inclusive). Exported because the strategy
 * comparison must run on the same window the page shows — otherwise the recommended
 * strategy is derived from the fund's entire life while the result card shows three
 * years, and 「应用此策略参数」 then produces different numbers.
 */
export function clipNavHistory(nav: NavPoint[], dates: { startDate?: string; endDate?: string }): NavPoint[] {
  return nav.filter((point) => inRange(dates, point.date));
}

/**
 * Runs a backtest for a fund. Returns `{ error }` (never throws) for data problems
 * so callers — UI and LLM tools — can render/report a message.
 */
export async function backtestFund(
  fundCode: string,
  request: BacktestRequest = {},
): Promise<BacktestResult | BacktestFailure> {
  const { startDate, endDate, navHistory, ...spec } = request;
  try {
    const raw = navHistory ?? (await fetchNavHistory(fundCode, startDate, endDate));
    const filtered = clipNavHistory(raw, { startDate, endDate });
    if (filtered.length === 0) return { error: `未获取到 ${fundCode} 在 ${startDate ?? '成立以来'} ~ ${endDate ?? '至今'} 的净值数据` };
    return runBacktest(filtered, spec);
  } catch (error) {
    return { error: `净值数据获取失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
