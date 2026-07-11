import { Router } from 'express';
import { asyncHandler } from '../core/errors.js';
import { sendSuccess } from '../core/response.js';
import { cache } from '../core/cache.js';
import {
  getFundScreeningSnapshot,
  getFundDetail,
  searchFunds,
} from '../services/fundService.js';
import { enrichmentMap, enrichFund, getEnrichment } from '../services/screeningEnrichment.js';
import { fetchFundCodeSearchList } from '../providers/eastmoney/eastmoneyFundProvider.js';
import type {
  FundSearchItemDto,
  FundSearchResultDto,
  FundScreeningSnapshotItemDto,
} from '../types/fund.js';

export const screeningRouter = Router();

// ---------------------------------------------------------------------------
// In-memory update progress state
// ---------------------------------------------------------------------------

interface UpdateProgress {
  running: boolean;
  progress: number;
  total: number;
  current_fund: string;
  success_count: number;
  fail_count: number;
  message: string;
}

let updateState: UpdateProgress = {
  running: false,
  progress: 0,
  total: 0,
  current_fund: '',
  success_count: 0,
  fail_count: 0,
  message: '',
};

let stopFlag = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enrichResponseFund(
  code: string,
  name: string,
  snapshotItem?: FundScreeningSnapshotItemDto,
): Record<string, unknown> {
  const e = getEnrichment(code);
  return {
    fund_code: code,
    fund_name: name,
    fund_type: e?.fund_type ?? snapshotItem?.type ?? null,
    return_1m: snapshotItem?.return1m ?? null,
    return_3m: snapshotItem?.return3m ?? null,
    return_6m: snapshotItem?.return6m ?? null,
    return_1y: snapshotItem?.return1y ?? null,
    return_2y: snapshotItem?.return2y ?? null,
    return_3y: snapshotItem?.return3y ?? null,
    ytd: snapshotItem?.ytd ?? null,
    since_inception: snapshotItem?.sinceInception ?? null,
    fee: snapshotItem?.fee ?? null,
    nav: snapshotItem?.nav ?? null,
    nav_date: snapshotItem?.navDate ?? null,
    source: snapshotItem?.source ?? null,
    updated_time: snapshotItem?.updatedAt ?? null,
    max_drawdown_1y: e?.max_drawdown_1y ?? null,
    sharpe_ratio_1y: e?.sharpe_ratio_1y ?? null,
    sharpe_ratio_3y: e?.sharpe_ratio_3y ?? null,
    volatility_1y: e?.volatility_1y ?? null,
    calmar_ratio_1y: e?.calmar_ratio_1y ?? null,
    industry_tag_name: e?.industry_tag ?? null,
  };
}

async function runBatchUpdate(): Promise<void> {
  stopFlag = false;
  updateState.running = true;
  updateState.progress = 0;
  updateState.success_count = 0;
  updateState.fail_count = 0;
  updateState.message = '获取基金排行...';

  try {
    const snapshot = await getFundScreeningSnapshot({ limitPerType: 500 });
    const allFunds = ((snapshot.data as { items?: FundScreeningSnapshotItemDto[] })?.items ?? []);
    updateState.total = allFunds.length;

    const CONCURRENCY = 10;
    for (let i = 0; i < allFunds.length; i += CONCURRENCY) {
      if (stopFlag) {
        updateState.message = `已手动停止。成功${updateState.success_count}，失败${updateState.fail_count}`;
        updateState.running = false;
        return;
      }

      const chunk = allFunds.slice(i, i + CONCURRENCY);
      updateState.message = `处理中 (${i + 1}-${Math.min(i + CONCURRENCY, allFunds.length)}/${allFunds.length})`;

      await Promise.allSettled(
        chunk.map(async (fund) => {
          updateState.current_fund = `${fund.code} - ${fund.name}`;
          try {
            await enrichFund(fund.code);
            updateState.success_count++;
          } catch {
            updateState.fail_count++;
          }
          updateState.progress = Math.min(updateState.progress + 1, updateState.total);
        }),
      );
    }

    updateState.message = `完成。成功${updateState.success_count}，失败${updateState.fail_count}`;
  } catch (err) {
    updateState.message = `处理失败: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    updateState.running = false;
    updateState.current_fund = '';
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

screeningRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const freshCount = enrichmentMap.size;
    sendSuccess(res, {
      status: 'ready',
      sync_available: true,
      basic_count: freshCount,
      risk_metrics_count: freshCount,
      latest_update: freshCount > 0 ? Array.from(enrichmentMap.values()).reduce<string | null>(
        (latest, e) => !latest || e.updated_at > latest ? e.updated_at : latest, null,
      ) : null,
    });
  }),
);

screeningRouter.get(
  '/sync',
  asyncHandler(async (req, res) => {
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    const force = req.query.force === 'true' || req.query.force === '1';
    if (force) cache.clear();

    const snapshot = await getFundScreeningSnapshot({ limitPerType: 500 });
    const updatedAt = snapshot.updatedAt?.toISOString?.() || null;

    if (since && updatedAt && since >= updatedAt) {
      sendSuccess(res, { unchanged: true, sync_time: updatedAt });
      return;
    }

    const allFunds = ((snapshot.data as { items?: FundScreeningSnapshotItemDto[] })?.items ?? []);
    const funds = allFunds.map(f => enrichResponseFund(f.code, f.name, f));
    sendSuccess(res, { unchanged: false, funds, total: funds.length, sync_time: new Date().toISOString() });
  }),
);

screeningRouter.get(
  '/progress',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, updateState);
  }),
);

screeningRouter.post(
  '/update',
  asyncHandler(async (req, res) => {
    if (updateState.running) {
      sendSuccess(res, { message: '已有任务运行中', task_id: null });
      return;
    }
    runBatchUpdate();
    sendSuccess(res, { message: '更新任务已启动', task_id: '1' });
  }),
);

screeningRouter.post(
  '/stop',
  asyncHandler(async (_req, res) => {
    stopFlag = true;
    updateState.message = '正在停止...';
    sendSuccess(res, { message: '已发送停止信号' });
  }),
);

screeningRouter.post(
  '/query',
  asyncHandler(async (req, res) => {
    const { keyword, fund_types, sort_by, sort_order, page = 1, page_size = 20 } = req.body ?? {};

    if (keyword) {
      const searchResult = await searchFunds(keyword);
      const items = ((searchResult.data as FundSearchResultDto)?.items ?? []) as FundSearchItemDto[];
      sendSuccess(res, {
        funds: items.map(f => enrichResponseFund(f.code, f.name)),
        total: items.length,
        page,
        page_size,
      });
      return;
    }

    const snapshot = await getFundScreeningSnapshot({
      types: fund_types ? String(fund_types).split(',') : undefined,
      sort: sort_by,
      pageSize: page_size as number,
    });

    const allFunds = ((snapshot.data as { items?: FundScreeningSnapshotItemDto[] })?.items ?? []);
    const total = allFunds.length;
    const start = ((page as number) - 1) * (page_size as number);
    const pageItems = allFunds.slice(start, start + (page_size as number));

    sendSuccess(res, {
      funds: pageItems.map(f => enrichResponseFund(f.code, f.name, f)),
      total,
      page,
      page_size,
    });
  }),
);

screeningRouter.get(
  '/strategies',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { strategies: [] });
  }),
);

screeningRouter.post(
  '/available-types',
  asyncHandler(async (_req, res) => {
    const list = await fetchFundCodeSearchList();
    const types = [...new Set(list.map(f => f.type).filter(Boolean))].sort();
    sendSuccess(res, { types });
  }),
);

screeningRouter.get(
  '/industry-tags',
  asyncHandler(async (_req, res) => {
    const tagCount = new Map<string, number>();
    for (const [, e] of enrichmentMap) {
      if (e.industry_tag) tagCount.set(e.industry_tag, (tagCount.get(e.industry_tag) ?? 0) + 1);
    }
    const allTags = Array.from(tagCount.entries()).map(([name, count]) => ({ name, count }));

    const sectorGroups = [
      { name: '医药医疗', patterns: ['医药医疗'] },
      { name: '新能源', patterns: ['新能源', '新能源汽车'] },
      { name: '科技', patterns: ['科技', '半导体/芯片', '人工智能', '通信'] },
      { name: '消费', patterns: ['消费'] },
      { name: '金融地产', patterns: ['金融地产'] },
      { name: '军工', patterns: ['军工'] },
      { name: '周期', patterns: ['周期'] },
      { name: '宽基指数', patterns: ['宽基指数', '红利'] },
      { name: '固收', patterns: ['固收', '货币'] },
      { name: '海外', patterns: ['海外'] },
      { name: '环保', patterns: ['环保/碳中和'] },
      { name: '黄金', patterns: ['黄金/贵金属'] },
    ];

    const grouped: { name: string; tags: { name: string; count: number }[]; count: number }[] = [];
    const used = new Set<string>();
    for (const group of sectorGroups) {
      const tags = allTags.filter(t => group.patterns.includes(t.name));
      const totalCount = tags.reduce((s, t) => s + t.count, 0);
      if (tags.length > 0) {
        grouped.push({ name: group.name, tags, count: totalCount });
        tags.forEach(t => used.add(t.name));
      }
    }

    const ungrouped = allTags.filter(t => !used.has(t.name));

    sendSuccess(res, { fundTypeGroups: [], sectorGroups: grouped, ungrouped });
  }),
);

screeningRouter.get(
  '/stock-industry/status',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { status: 'not_built', progress: 0 });
  }),
);

screeningRouter.post(
  '/stock-industry/warmup',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'Not available in Node.js screening service' });
  }),
);

screeningRouter.get(
  '/fund/:code',
  asyncHandler(async (req, res) => {
    const code = String(req.params.code);
    try {
      const detail = await getFundDetail(code);
      sendSuccess(res, detail);
    } catch (err) {
      const existing = enrichmentMap.get(code);
      if (existing) {
        sendSuccess(res, { data: { code, sections: {} }, provider: 'enrichment', ...existing });
        return;
      }
      throw err;
    }
  }),
);

screeningRouter.post(
  '/fill-risk',
  asyncHandler(async (req, res) => {
    const { codes } = req.body ?? {};
    const list = Array.isArray(codes) ? codes as string[] : [];

    if (list.length === 0) {
      // 没有指定 codes 则补充 enrichment 中缺少风险指标的
      const needRisk: string[] = [];
      for (const [code, e] of enrichmentMap) {
        if (e.sharpe_ratio_1y == null && e.max_drawdown_1y == null) {
          needRisk.push(code);
        }
      }
      if (needRisk.length === 0) {
        sendSuccess(res, { updated: 0, message: '所有基金已有风险指标' });
        return;
      }
      const CONCURRENCY = 10;
      let updated = 0;
      for (let i = 0; i < needRisk.length; i += CONCURRENCY) {
        const chunk = needRisk.slice(i, i + CONCURRENCY);
        await Promise.allSettled(
          chunk.map(async (code) => {
            try {
              await enrichFund(code);
              updated++;
            } catch { /* ignore */ }
          }),
        );
      }
      sendSuccess(res, { updated, total: needRisk.length, message: `更新 ${updated}/${needRisk.length}` });
      return;
    }

    let updated = 0;
    const CONCURRENCY = 10;
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      const chunk = list.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        chunk.map(async (code) => {
          try {
            await enrichFund(code);
            updated++;
          } catch { /* ignore */ }
        }),
      );
    }
    sendSuccess(res, { updated, total: list.length, message: `更新 ${updated}/${list.length}` });
  }),
);

screeningRouter.post(
  '/update-single/:code',
  asyncHandler(async (req, res) => {
    const code = String(req.params.code);
    await enrichFund(code);
    const e = getEnrichment(code);
    sendSuccess(res, {
      fund_code: code,
      ...(e ?? {
        fund_type: null, industry_tag: null,
        max_drawdown_1y: null, sharpe_ratio_1y: null, sharpe_ratio_3y: null,
        volatility_1y: null, calmar_ratio_1y: null,
      }),
    });
  }),
);

screeningRouter.post(
  '/recalculate-rankings',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { message: 'Rankings are computed client-side (useCompute4433)' });
  }),
);
