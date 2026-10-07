/**
 * 服务端回测：取净值（复用 `/api/funds/:code/nav-history` 的 provider 链与缓存）→ 调 `@gofund/core` 引擎。
 *
 * 与前端页面用的是**同一份引擎源码**（`packages/core`，两边都直连 src），
 * 所以同一组参数在浏览器与 Node 上必然得到同一个数字。
 *
 * 返回值是**抽样后的紧凑 payload**（`sampleBacktest` / `samplePortfolioBacktest`），
 * 完整 timeline 由页面自己渲染 —— 这与原先聊天工具的口径一致。
 *
 * 注意：这里用**相对路径**引 core（而不是 tsconfig paths 别名），
 * 因为别名只对 tsx/类型检查生效，`tsc` 产物会保留别名 specifier 导致 `node dist/...` 解析失败。
 */
import { getFundNavHistory } from './fundService.js';
import { runBacktest } from '../../../packages/core/src/backtest/backtestEngine.js';
import { runPortfolioBacktest } from '../../../packages/core/src/backtest/portfolioBacktest.js';
import { compareStrategies } from '../../../packages/core/src/backtest/strategyCompare.js';
import { sampleBacktest } from '../../../packages/core/src/backtest/timelineSample.js';
import { samplePortfolioBacktest } from '../../../packages/core/src/backtest/portfolioSample.js';
import {
  portfolioSpecFromToolArgs,
  resolveDateRange,
  specFromToolArgs,
  type PortfolioToolArgs,
  type ToolArgs,
} from '../../../packages/core/src/backtest/toolArgs.js';
import {
  isBacktestResult,
  isPortfolioResult,
  type NavPoint,
} from '../../../packages/core/src/backtest/backtestTypes.js';

/** 净值条目：日期 `YYYY-MM-DD`、净值 > 0。 */
function toNavPoints(items: unknown): NavPoint[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((raw) => raw as { date?: unknown; nav?: unknown })
    .filter((item) => Boolean(item?.date) && item?.nav != null)
    .map((item) => ({ date: String(item.date).slice(0, 10), nav: Number(item.nav) }))
    .filter((point) => Number.isFinite(point.nav) && point.nav > 0);
}

/** 取某只基金在窗口内的净值（走 service 的 24h 缓存）。 */
export async function fetchNavPoints(
  fundCode: string,
  startDate?: string,
  endDate?: string
): Promise<NavPoint[]> {
  const result = await getFundNavHistory(fundCode, { startDate, endDate });
  return toNavPoints((result.data as { items?: unknown })?.items);
}

/** 窗口内过滤（与前端 `clipNavHistory` 同语义，含边界）。 */
export function clipNavPoints(
  points: NavPoint[],
  range: { startDate?: string; endDate?: string }
): NavPoint[] {
  return points.filter((point) => {
    if (range.startDate && point.date < range.startDate) return false;
    if (range.endDate && point.date > range.endDate) return false;
    return true;
  });
}

/** 单基金定投/价值平均/均线偏离回测（`run_backtest` 的服务端对应物）。 */
export async function runFixedInvestmentBacktest(args: ToolArgs) {
  const fundCode = String(args.fund_code ?? '').trim();
  if (!fundCode) return { error: '缺少 fund_code（基金代码）' };

  const { startDate, endDate } = resolveDateRange(args);
  try {
    const raw = await fetchNavPoints(fundCode, startDate, endDate);
    const nav = clipNavPoints(raw, { startDate, endDate });
    if (nav.length === 0) {
      return { error: `未获取到 ${fundCode} 在 ${startDate} ~ ${endDate} 的净值数据` };
    }
    const spec = specFromToolArgs(args);
    const outcome = runBacktest(nav, spec);
    if (!isBacktestResult(outcome)) return { error: outcome.error };
    return {
      fund_code: fundCode,
      start_date: startDate,
      end_date: endDate,
      ...sampleBacktest(outcome, spec),
    };
  } catch (error) {
    return { error: `净值数据获取失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 多资产组合回测（`run_portfolio_backtest` 的服务端对应物）。 */
export async function runPortfolioBacktestForArgs(args: PortfolioToolArgs) {
  const spec = portfolioSpecFromToolArgs(args);
  if (spec.assets.length < 1) {
    return { error: '至少需要 1 个资产（基金或现金）' };
  }

  const { startDate, endDate } = resolveDateRange(args as ToolArgs);
  const codes = [
    ...new Set(
      spec.assets
        .filter((asset) => asset.kind !== 'cash')
        .map((asset) => String((asset as { fundCode?: string }).fundCode ?? '').trim())
        .filter(Boolean)
    ),
  ];

  const navByCode: Record<string, NavPoint[]> = {};
  const failures = new Map<string, string>();
  await Promise.all(
    codes.map(async (code) => {
      try {
        navByCode[code] = clipNavPoints(await fetchNavPoints(code, startDate, endDate), {
          startDate,
          endDate,
        });
      } catch (error) {
        failures.set(code, `净值获取失败：${error instanceof Error ? error.message : String(error)}`);
        navByCode[code] = [];
      }
    })
  );

  const usable = codes.filter((code) => (navByCode[code]?.length ?? 0) > 0);
  if (codes.length > 0 && usable.length === 0) {
    const detail = [...failures.values()][0];
    return { error: detail ?? `未获取到 ${codes.join('、')} 在 ${startDate} ~ ${endDate} 的净值数据` };
  }

  const outcome = runPortfolioBacktest(spec, { navByCode });
  if (!isPortfolioResult(outcome)) return { error: outcome.error };
  for (const entry of outcome.excluded) {
    const reason = failures.get(entry.code);
    if (reason) entry.reason = reason;
  }

  return {
    start_date: startDate,
    end_date: endDate,
    ...samplePortfolioBacktest(outcome, spec),
  };
}

/** 多策略对比（`compare_backtest_strategies` / `suggest_strategy` 的服务端对应物）。 */
export async function compareBacktestStrategies(args: ToolArgs) {
  const fundCode = String(args.fund_code ?? '').trim();
  if (!fundCode) return { error: '缺少 fund_code（基金代码）' };

  const { startDate, endDate } = resolveDateRange(args);
  try {
    const nav = clipNavPoints(await fetchNavPoints(fundCode, startDate, endDate), { startDate, endDate });
    if (nav.length === 0) {
      return { error: `未获取到 ${fundCode} 在 ${startDate} ~ ${endDate} 的净值数据` };
    }
    const comparison = compareStrategies(
      nav,
      { ...specFromToolArgs(args), takeProfitRate: args.take_profit_rate ?? null, stopLossRate: args.stop_loss_rate ?? null },
      { range: `${startDate} ~ ${endDate}` }
    );
    if ('error' in comparison) return { error: comparison.error };
    return {
      fund_code: fundCode,
      range: `${startDate} ~ ${endDate}`,
      recommended: {
        key: comparison.recommended.key,
        name: comparison.recommended.name,
        reason: comparison.recommended.reason,
        spec: comparison.recommended.spec,
        summary: comparison.recommended.summary,
      },
      strategies: comparison.strategies.map((entry) => ({
        key: entry.key,
        name: entry.name,
        spec: entry.spec,
        summary: entry.summary,
      })),
    };
  } catch (error) {
    return { error: `净值数据获取失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
