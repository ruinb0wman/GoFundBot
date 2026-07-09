import type { FundScreeningSnapshotItemDto } from '../types/fund.js';
import type { SectorDto } from '../providers/types.js';

const RESEARCH_FUND_GROUPS: Array<{ key: string; name: string; keywords: string[] }> = [
  { key: 'equity', name: '股票型', keywords: ['股票'] },
  { key: 'hybrid', name: '混合型', keywords: ['混合'] },
  { key: 'bond', name: '债券型', keywords: ['债券', '债券型'] },
  { key: 'index', name: '指数型', keywords: ['指数', '联接'] },
  { key: 'etf', name: 'ETF', keywords: ['ETF', '交易型开放式指数'] },
  { key: 'qdii', name: 'QDII', keywords: ['QDII'] },
  { key: 'fof', name: 'FOF', keywords: ['FOF'] },
  { key: 'money', name: '货币型', keywords: ['货币'] },
];

function toFloat(value: unknown): number | null {
  if (value === null || value === undefined || value === '--') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function roundPercent(value: unknown): number | null {
  const num = toFloat(value);
  return num !== null ? Math.round(num * 100) / 100 : null;
}

function median(values: (number | null | undefined)[]): number | null {
  const nums = values.map(toFloat).filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 !== 0
    ? Math.round(nums[mid] * 100) / 100
    : Math.round(((nums[mid - 1] + nums[mid]) / 2) * 100) / 100;
}

function avg(values: (number | null | undefined)[]): number | null {
  const nums = values.map(toFloat).filter((v): v is number => v !== null);
  return nums.length > 0 ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;
}

function positiveRate(values: (number | null | undefined)[]): number | null {
  const nums = values.map(toFloat).filter((v): v is number => v !== null);
  return nums.length > 0 ? Math.round((nums.filter((v) => v > 0).length / nums.length) * 10000) / 100 : null;
}

function fundTypeMatches(fundType: string | null, fundName: string | null, keywords: string[]): boolean {
  const text = `${fundType ?? ''} ${fundName ?? ''}`.toUpperCase();
  return keywords.some((kw) => text.includes(kw.toUpperCase()));
}

function fundGroupKey(fundType: string | null, fundName: string | null): string {
  for (const group of RESEARCH_FUND_GROUPS) {
    if (fundTypeMatches(fundType, fundName, group.keywords)) return group.key;
  }
  return 'other';
}

function latestUpdateTime(items: FundScreeningSnapshotItemDto[]): string | null {
  const dates = items.map((i) => i.updatedAt).filter(Boolean) as string[];
  return dates.length > 0 ? dates.sort().reverse()[0] : null;
}

function researchFundRow(item: FundScreeningSnapshotItemDto): Record<string, unknown> {
  return {
    fund_code: item.code,
    fund_name: item.name,
    fund_type: item.type,
    return_1m: roundPercent(item.return1m),
    return_3m: roundPercent(item.return3m),
    return_6m: roundPercent(item.return6m),
    return_1y: roundPercent(item.return1y),
    return_3y: roundPercent(item.return3y),
    max_drawdown_1y: null,
    volatility_1y: null,
    sharpe_ratio_1y: null,
    calmar_ratio_1y: null,
    rank_pct_1y: null,
    pass_4433: false,
    estimate_change: null,
    estimate_time: null,
    nav: item.nav,
    nav_date: item.navDate,
    updated_time: item.updatedAt,
  };
}

export function buildResearchMarketStats(items: FundScreeningSnapshotItemDto[]): Record<string, unknown> {
  const rows = items.map((item) => researchFundRow(item));
  const total = rows.length;

  const typeMap = new Map<string, { count: number; pass4433: number; return1yValues: number[]; return3mValues: number[] }>();
  const groupMap = new Map<string, { key: string; name: string; count: number; return1yValues: number[] }>();

  for (const item of rows) {
    const fundType = (item.fund_type as string) || '未分类';
    let ts = typeMap.get(fundType);
    if (!ts) {
      ts = { count: 0, pass4433: 0, return1yValues: [], return3mValues: [] };
      typeMap.set(fundType, ts);
    }
    ts.count += 1;
    if (item.pass_4433) ts.pass4433 += 1;
    if (item.return_1y !== null) ts.return1yValues.push(item.return_1y as number);
    if (item.return_3m !== null) ts.return3mValues.push(item.return_3m as number);

    const gk = fundGroupKey(item.fund_type as string | null, item.fund_name as string | null);
    let gs = groupMap.get(gk);
    if (!gs) {
      gs = { key: gk, name: RESEARCH_FUND_GROUPS.find((g) => g.key === gk)?.name ?? '其他', count: 0, return1yValues: [] };
      groupMap.set(gk, gs);
    }
    gs.count += 1;
    if (item.return_1y !== null) gs.return1yValues.push(item.return_1y as number);
  }

  const typeStats = Array.from(typeMap.entries())
    .map(([fundType, stat]) => ({
      fund_type: fundType,
      count: stat.count,
      ratio: total ? Math.round((stat.count / total) * 10000) / 100 : 0,
      pass_4433: stat.pass4433,
      pass_rate: stat.count ? Math.round((stat.pass4433 / stat.count) * 10000) / 100 : 0,
      return_1y_median: median(stat.return1yValues),
      return_3m_median: median(stat.return3mValues),
    }))
    .sort((a, b) => b.count - a.count);

  const groupStats = Array.from(groupMap.values())
    .map((stat) => ({
      key: stat.key,
      name: stat.name,
      count: stat.count,
      ratio: total ? Math.round((stat.count / total) * 10000) / 100 : 0,
      return_1y_median: median(stat.return1yValues),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    summary: {
      total_funds: total,
      risk_ready: 0,
      risk_ready_rate: 0,
      rank_ready: 0,
      rank_ready_rate: 0,
      pass_4433: 0,
      pass_4433_rate: 0,
      return_1y_median: median(rows.map((r) => r.return_1y as number | null)),
      return_3m_median: median(rows.map((r) => r.return_3m as number | null)),
      positive_1y_rate: positiveRate(rows.map((r) => r.return_1y as number | null)),
      latest_update: latestUpdateTime(items),
    },
    type_stats: typeStats.slice(0, 30),
    group_stats: groupStats,
  };
}

export function buildResearchFundDashboard(items: FundScreeningSnapshotItemDto[], limit: number): Record<string, unknown> {
  const grouped = new Map<string, { key: string; name: string; items: Record<string, unknown>[] }>();
  for (const group of RESEARCH_FUND_GROUPS) {
    grouped.set(group.key, { key: group.key, name: group.name, items: [] });
  }
  grouped.set('other', { key: 'other', name: '其他', items: [] });

  for (const item of items) {
    const row = researchFundRow(item);
    const gk = fundGroupKey(item.type, item.name);
    if (!grouped.has(gk)) grouped.set(gk, { key: gk, name: '其他', items: [] });
    grouped.get(gk)!.items.push(row);
  }

  const cards = Array.from(grouped.values())
    .filter((g) => g.items.length > 0)
    .map((group) => {
      const sorted = group.items.sort((a, b) => {
        const pa = a.pass_4433 ? 1 : 0;
        const pb = b.pass_4433 ? 1 : 0;
        if (pa !== pb) return pb - pa;
        const sa = (a.sharpe_ratio_1y as number) ?? -999;
        const sb = (b.sharpe_ratio_1y as number) ?? -999;
        if (sa !== sb) return sb - sa;
        const ra = (a.return_1y as number) ?? -999;
        const rb = (b.return_1y as number) ?? -999;
        return rb - ra;
      });
      return {
        key: group.key,
        name: group.name,
        summary: {
          total: group.items.length,
          pass_4433: group.items.filter((i) => i.pass_4433).length,
          return_1y_avg: avg(group.items.map((i) => i.return_1y as number | null)),
          sharpe_1y_avg: null,
        },
        items: sorted.slice(0, limit),
      };
    })
    .sort((a, b) => b.summary.total - a.summary.total);

  return { cards, limit };
}

export function buildResearchEtfTracking(items: FundScreeningSnapshotItemDto[], limit: number): Record<string, unknown> {
  const etfItems: Record<string, unknown>[] = [];
  for (const item of items) {
    const type = (item.type ?? '').toUpperCase();
    const name = (item.name ?? '').toUpperCase();
    if (type.includes('ETF') || type.includes('交易型开放式') || type.includes('指数') || name.includes('ETF')) {
      etfItems.push({
        fund_code: item.code,
        fund_name: item.name,
        fund_type: item.type,
        estimate_change: null,
        return_1y: roundPercent(item.return1y),
        nav_date: item.navDate,
        source: 'eastmoney.screening',
      });
    }
  }

  const categories = new Map<string, { category: string; count: number; estimateValues: number[] }>();
  for (const etf of etfItems) {
    const n = (etf.fund_name as string) || '';
    let cat: string;
    if (/债|货币/.test(n)) cat = '债券/货币 ETF';
    else if (/港|纳斯达克|标普|日经|德国|QDII/.test(n)) cat = '跨境 ETF';
    else if (/黄金|商品|能源|豆粕/.test(n)) cat = '商品 ETF';
    else if (/医药|消费|芯片|半导体|证券|银行|军工|AI|机器人/.test(n)) cat = '行业主题 ETF';
    else cat = '宽基/普通指数 ETF';
    let s = categories.get(cat);
    if (!s) {
      s = { category: cat, count: 0, estimateValues: [] };
      categories.set(cat, s);
    }
    s.count += 1;
  }

  return {
    items: etfItems.slice(0, limit),
    categories: Array.from(categories.values())
      .map((s) => ({
        category: s.category,
        count: s.count,
        estimate_change_avg: null,
        return_1y_median: median(etfItems.map((e) => e.return_1y as number | null)),
        net_flow: null,
      }))
      .sort((a, b) => b.count - a.count),
    summary: {
      total: etfItems.length,
      with_estimate: 0,
      avg_estimate_change: null,
      positive_estimate_rate: null,
      net_flow_available: false,
      net_flow_note: '当前数据源尚未接入 ETF 实时估值；估值缺失时仅显示历史净值。',
    },
  };
}

export function buildResearchSectorSummary(sectors: SectorDto[], limit: number): Record<string, unknown> {
  const items = sectors.slice(0, limit).map((s) => {
    const change = toFloat(s.changePercent);
    let mood: string;
    let summaryText: string;
    if (change === null) {
      mood = 'unknown';
      summaryText = '暂无涨跌幅数据';
    } else if (change >= 2) {
      mood = 'strong';
      summaryText = '强势上涨，短线热度较高';
    } else if (change >= 0) {
      mood = 'positive';
      summaryText = '温和上涨，表现好于弱势板块';
    } else if (change <= -2) {
      mood = 'weak';
      summaryText = '明显回调，注意波动风险';
    } else {
      mood = 'negative';
      summaryText = '小幅回落，走势偏弱';
    }
    const inflow = toFloat(s.mainNetInflow);
    const flowText = inflow !== null ? (inflow > 0 ? '，主力资金净流入' : '，主力资金净流出') : '';
    return {
      code: s.code,
      name: s.name,
      change_percent: change,
      main_net_inflow: inflow,
      mood,
      summary: summaryText + flowText,
    };
  });

  const withChange = items.filter((it) => it.change_percent !== null) as Array<{ change_percent: number } & Record<string, unknown>>;
  const withInflow = items.filter((it) => it.main_net_inflow !== null) as Array<{ main_net_inflow: number } & Record<string, unknown>>;

  return {
    items,
    top_gainers: withChange.sort((a, b) => b.change_percent - a.change_percent).slice(0, 8),
    top_losers: withChange.sort((a, b) => a.change_percent - b.change_percent).slice(0, 8),
    inflow_leaders: withInflow.sort((a, b) => b.main_net_inflow - a.main_net_inflow).slice(0, 8),
    summary: {
      total: items.length,
      strong_count: items.filter((it) => it.mood === 'strong').length,
      positive_count: items.filter((it) => it.change_percent !== null && it.change_percent >= 0).length,
      negative_count: items.filter((it) => it.change_percent !== null && it.change_percent < 0).length,
    },
  };
}

export function buildResearchIndustryPerformance(items: FundScreeningSnapshotItemDto[]): Record<string, unknown> {
  const groups = new Map<string, { funds: Record<string, unknown>[]; return3m: number[]; return6m: number[]; return1y: number[]; return3y: number[] }>();

  for (const item of items) {
    const type = (item.type || '未分类');
    let bucket = groups.get(type);
    if (!bucket) {
      bucket = { funds: [], return3m: [], return6m: [], return1y: [], return3y: [] };
      groups.set(type, bucket);
    }
    bucket.funds.push({ fund_code: item.code, fund_name: item.name, fund_type: item.type });
    const r3m = toFloat(item.return3m);
    const r6m = toFloat(item.return6m);
    const r1y = toFloat(item.return1y);
    const r3y = toFloat(item.return3y);
    if (r3m !== null) bucket.return3m.push(r3m);
    if (r6m !== null) bucket.return6m.push(r6m);
    if (r1y !== null) bucket.return1y.push(r1y);
    if (r3y !== null) bucket.return3y.push(r3y);
  }

  const resultItems = Array.from(groups.entries()).map(([industry, bucket]) => {
    const stat3m = { median: median(bucket.return3m), positive_rate: positiveRate(bucket.return3m) };
    const stat6m = { median: median(bucket.return6m), positive_rate: positiveRate(bucket.return6m) };
    const stat1y = { median: median(bucket.return1y), positive_rate: positiveRate(bucket.return1y) };
    const stat3y = { median: median(bucket.return3y), positive_rate: positiveRate(bucket.return3y) };
    return {
      industry,
      fund_count: bucket.funds.length,
      return_3m_avg: avg(bucket.return3m),
      return_3m_median: stat3m.median,
      return_6m_avg: avg(bucket.return6m),
      return_6m_median: stat6m.median,
      return_1y_avg: avg(bucket.return1y),
      return_1y_median: stat1y.median,
      return_3y_avg: avg(bucket.return3y),
      return_3y_median: stat3y.median,
      positive_3m_rate: stat3m.positive_rate,
      positive_6m_rate: stat6m.positive_rate,
      positive_1y_rate: stat1y.positive_rate,
      positive_3y_rate: stat3y.positive_rate,
      updated_time: null,
    };
  });

  const sorted3m = [...resultItems].sort((a, b) => {
    const va = a.return_3m_median ?? -9999;
    const vb = b.return_3m_median ?? -9999;
    return vb - va;
  });
  const sorted1y = [...resultItems].sort((a, b) => {
    const va = a.return_1y_median ?? -9999;
    const vb = b.return_1y_median ?? -9999;
    return vb - va;
  });
  const weak3m = [...resultItems].sort((a, b) => {
    const va = a.return_3m_median ?? 9999;
    const vb = b.return_3m_median ?? 9999;
    return va - vb;
  });

  return {
    items: resultItems,
    summary: {
      total: resultItems.length,
      fund_count: resultItems.reduce((sum, r) => sum + r.fund_count, 0),
      updated_time: null,
    },
    top_3m: sorted3m.slice(0, 8),
    top_1y: sorted1y.slice(0, 8),
    weak_3m: weak3m.slice(0, 8),
  };
}

export function buildDashboard(
  items: FundScreeningSnapshotItemDto[],
  sectors: SectorDto[],
  limit: number,
  etfLimit: number,
): Record<string, unknown> {
  return {
    market_stats: buildResearchMarketStats(items),
    fund_dashboard: buildResearchFundDashboard(items, limit),
    etf_tracking: buildResearchEtfTracking(items, etfLimit),
    industry_performance: buildResearchIndustryPerformance(items),
    industry_performance_task: {
      running: false,
      status: 'idle',
      message: '行业表现数据基于基金实时筛选快照聚合；后续可通过 PythonRunner 触发 classify_industry 增强。',
    },
    updated_at: new Date().toISOString(),
    data_source: {
      primary: 'eastmoney.screening',
      industry_performance: 'eastmoney fund screening snapshot (type-based grouping)',
      etf_net_flow: 'not_available',
    },
  };
}
