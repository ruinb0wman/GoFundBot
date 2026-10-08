/**
 * 投研看板聚合（P3.4）：原来在前端用 `/api/screening/query?page_size=5000` + 板块行情拼，
 * 现在直接读 SQLite 的筛选行 + core 的 `buildDashboard`。
 *
 * 顺带修掉两处死代码：`buildDashboard` 的 `sectors` 参数从来没被用过
 * （`buildResearchSectorSummary` 零调用），所以这里既不取板块、也没了那次多余的行情请求。
 */
import { logger } from '../core/logger.js';
import { getAllScreeningFunds, screeningDataVersion } from './screeningService.js';
import { buildDashboard } from '../../../packages/core/src/researchComputation.js';

/**
 * 给模型用的**紧凑版**看板：去掉逐条基金列表（每张卡片的 top 基金、ETF 全表），
 * 只留汇总数字 + 分类型统计 + 行业表现 —— 整包约 20KB，不会被 `MAX_RESULT_CHARS` 截断。
 * 需要明细的调用方（前端页面）用完整版。
 */
export function compactDashboard(dashboard: Record<string, unknown>, etfLimit = 10): Record<string, unknown> {
  const stats = (dashboard.market_stats ?? {}) as Record<string, unknown>;
  const cards = ((dashboard.fund_dashboard ?? {}) as { cards?: Record<string, unknown>[] }).cards ?? [];
  const etf = (dashboard.etf_tracking ?? {}) as Record<string, unknown>;
  return {
    market_stats: {
      summary: stats.summary,
      type_stats: stats.type_stats,
      enrichment_summary: stats.enrichment_summary,
    },
    fund_dashboard: {
      cards: cards.map((card) => ({ key: card.key, name: card.name, summary: card.summary })),
    },
    etf_tracking: {
      summary: etf.summary,
      categories: etf.categories,
      items: ((etf.items ?? []) as unknown[]).slice(0, Math.max(0, etfLimit)),
      note: 'ETF 明细已截取前若干条；完整明细见前端 /research 页面。',
    },
    industry_performance: dashboard.industry_performance,
    updated_at: dashboard.updated_at,
    data_source: dashboard.data_source,
  };
}

export interface DashboardOptions {
  /** 基金看板每个榜单取前几名（默认 5）。 */
  limit?: number;
  /** ETF 每日跟踪取多少行（默认 80）。 */
  etfLimit?: number;
}

export async function getResearchDashboard(options: DashboardOptions = {}): Promise<Record<string, unknown>> {
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 50);
  const etfLimit = Math.min(Math.max(options.etfLimit ?? 80, 1), 500);

  // 进程内 60s 缓存：key 含筛选库的数据版本（同步/富化/排名后自动失效），
  // 所以「同步完再请求」拿到的一定是新数据。
  const key = `${limit}:${etfLimit}:${screeningDataVersion()}`;
  if (dashboardCache && dashboardCache.key === key && Date.now() - dashboardCache.at < DASHBOARD_TTL_MS) {
    return dashboardCache.value;
  }

  const funds = getAllScreeningFunds();
  const value = buildDashboard(funds, limit, etfLimit);
  dashboardCache = { key, at: Date.now(), value };
  logger.info('research dashboard built', { funds: funds.length, limit, etfLimit });

  return value;
}

const DASHBOARD_TTL_MS = 60_000;
let dashboardCache: { key: string; at: number; value: Record<string, unknown> } | null = null;
