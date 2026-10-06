/**
 * Portfolio backtest entry point: fetch every fund's NAV (reusing the single-fund
 * endpoint + its 24h cache), then run the local multi-asset engine.
 *
 * Mirrors `runBacktestForFund.ts`: returns `{ error }` (never throws) for data
 * problems so the UI and the LLM tool can report a message.
 */

import { fetchNavHistory } from './runBacktestForFund';
import { runPortfolioBacktest } from './portfolioBacktest';
import { isPortfolioResult, type NavPoint, type PortfolioBacktestFailure, type PortfolioBacktestResult, type PortfolioSpec } from './backtestTypes';

export interface PortfolioBacktestRequest extends PortfolioSpec {
  startDate?: string;
  endDate?: string;
  /** In-memory NAV per code (skips the HTTP call) — used by tests/callers that already have it. */
  navByCode?: Record<string, NavPoint[]>;
}

export async function backtestPortfolio(
  request: PortfolioBacktestRequest,
): Promise<PortfolioBacktestResult | PortfolioBacktestFailure> {
  const { startDate, endDate, navByCode, ...spec } = request;
  const codes = [
    ...new Set(
      (spec.assets ?? [])
        .filter((asset) => asset.kind !== 'cash')
        .map((asset) => String((asset as { fundCode?: string }).fundCode ?? '').trim())
        .filter(Boolean),
    ),
  ];

  const history: Record<string, NavPoint[]> = { ...(navByCode ?? {}) };
  const failureReasons = new Map<string, string>();
  await Promise.all(
    codes.map(async (code) => {
      if (history[code]) return;
      try {
        history[code] = await fetchNavHistory(code, startDate, endDate);
      } catch (error) {
        failureReasons.set(code, `净值获取失败：${error instanceof Error ? error.message : String(error)}`);
        history[code] = [];
      }
    }),
  );

  const result = runPortfolioBacktest(spec, { navByCode: history });
  if (isPortfolioResult(result)) {
    for (const entry of result.excluded) {
      const reason = failureReasons.get(entry.code);
      if (reason) entry.reason = reason;
    }
  }
  return result;
}
