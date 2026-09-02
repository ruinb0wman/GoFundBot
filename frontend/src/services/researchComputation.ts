/**
 * Frontend research dashboard computation.
 * Ported from Service `researchService.ts`; operates on frontend screening fund
 * items (from Dexie / IndexedDB) + optional market sector DTOs.
 */

import { classifyFundIndustry, classifyFundType, type ScreeningLikeItem } from './industryClassifier'

export interface SectorLike {
  code?: string
  name?: string
  changePercent?: number | null
  mainNetInflow?: number | null
}

interface ResearchRow {
  fund_code: string
  fund_name: string
  fund_type: string | null
  return_1m: number | null
  return_3m: number | null
  return_6m: number | null
  return_1y: number | null
  return_2y: number | null
  return_3y: number | null
  ytd: number | null
  nav: number | null
  nav_date: string | null
  updated_time: string | null
  max_drawdown_1y: number | null
  volatility_1y: number | null
  sharpe_ratio_1y: number | null
  sharpe_ratio_3y: number | null
  calmar_ratio_1y: number | null
  industry_tag_name: string | null
  pass_4433: boolean
}

const RESEARCH_FUND_GROUPS: Array<{ key: string; name: string; keywords: string[] }> = [
  { key: 'equity', name: '股票型', keywords: ['股票'] },
  { key: 'hybrid', name: '混合型', keywords: ['混合'] },
  { key: 'bond', name: '债券型', keywords: ['债券', '债券型'] },
  { key: 'index', name: '指数型', keywords: ['指数', '联接'] },
  { key: 'etf', name: 'ETF', keywords: ['ETF', '交易型开放式指数'] },
  { key: 'qdii', name: 'QDII', keywords: ['QDII'] },
  { key: 'fof', name: 'FOF', keywords: ['FOF'] },
  { key: 'money', name: '货币型', keywords: ['货币'] },
]

function toFloat(value: unknown): number | null {
  if (value === null || value === undefined || value === '--') return null
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

function roundPercent(value: unknown): number | null {
  const num = toFloat(value)
  return num !== null ? Math.round(num * 100) / 100 : null
}

function median(values: (number | null | undefined)[]): number | null {
  const nums = values.map(toFloat).filter((v): v is number => v !== null).sort((a, b) => a - b)
  if (nums.length === 0) return null
  const mid = Math.floor(nums.length / 2)
  return nums.length % 2 !== 0
    ? Math.round(nums[mid] * 100) / 100
    : Math.round(((nums[mid - 1] + nums[mid]) / 2) * 100) / 100
}

function avg(values: (number | null | undefined)[]): number | null {
  const nums = values.map(toFloat).filter((v): v is number => v !== null)
  return nums.length > 0 ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null
}

function positiveRate(values: (number | null | undefined)[]): number | null {
  const nums = values.map(toFloat).filter((v): v is number => v !== null)
  return nums.length > 0 ? Math.round((nums.filter((v) => v > 0).length / nums.length) * 10000) / 100 : null
}

function getCode(item: ScreeningLikeItem): string {
  return item.code ?? item.fund_code ?? ''
}

function getName(item: ScreeningLikeItem): string {
  return item.name ?? item.fund_name ?? ''
}

function getType(item: ScreeningLikeItem): string | null {
  return item.type ?? item.fund_type ?? null
}

function getReturn(item: ScreeningLikeItem, period: string): number | null {
  switch (period) {
    case '1m': return toFloat(item.return1m ?? item.return_1m)
    case '3m': return toFloat(item.return3m ?? item.return_3m)
    case '6m': return toFloat(item.return6m ?? item.return_6m)
    case '1y': return toFloat(item.return1y ?? item.return_1y)
    case '2y': return toFloat(item.return2y ?? item.return_2y)
    case '3y': return toFloat(item.return3y ?? item.return_3y)
    default: return null
  }
}

function fundTypeMatches(fundType: string | null, fundName: string | null, keywords: string[]): boolean {
  const text = `${fundType ?? ''} ${fundName ?? ''}`.toUpperCase()
  return keywords.some((kw) => text.includes(kw.toUpperCase()))
}

function fundGroupKey(fundType: string | null, fundName: string | null): string {
  for (const group of RESEARCH_FUND_GROUPS) {
    if (fundTypeMatches(fundType, fundName, group.keywords)) return group.key
  }
  return 'other'
}

/**
 * Build a research row matching Node `researchFundRow` (using the frontend's own
 * risk/industry fields, which are computed & persisted client-side).
 */
function researchFundRow(item: ScreeningLikeItem): ResearchRow {
  const code = getCode(item)
  const name = getName(item)
  const type = getType(item)
  const r = item as Record<string, unknown>
  return {
    fund_code: code,
    fund_name: name,
    fund_type: type,
    return_1m: roundPercent(getReturn(item, '1m')),
    return_3m: roundPercent(getReturn(item, '3m')),
    return_6m: roundPercent(getReturn(item, '6m')),
    return_1y: roundPercent(getReturn(item, '1y')),
    return_2y: roundPercent(getReturn(item, '2y')),
    return_3y: roundPercent(getReturn(item, '3y')),
    ytd: roundPercent(r.ytd),
    nav: toFloat(r.nav),
    nav_date: (r.nav_date as string) ?? null,
    updated_time: (r.updated_time as string) ?? null,
    max_drawdown_1y: toFloat(r.max_drawdown_1y),
    volatility_1y: toFloat(r.volatility_1y),
    sharpe_ratio_1y: toFloat(r.sharpe_ratio_1y),
    sharpe_ratio_3y: toFloat(r.sharpe_ratio_3y),
    calmar_ratio_1y: toFloat(r.calmar_ratio_1y),
    industry_tag_name: (r.industry_tag_name as string) ?? classifyFundIndustry(name),
    pass_4433: r.pass_4433 === 1 || r.pass_4433 === true,
  }
}

export function buildResearchMarketStats(items: ScreeningLikeItem[]): Record<string, unknown> {
  const rows = items.map((item) => researchFundRow(item))
  const total = rows.length

  const typeMap = new Map<string, { count: number; return1yValues: number[]; return3mValues: number[] }>()
  const groupMap = new Map<string, { key: string; name: string; count: number; return1yValues: number[] }>()
  let enrichedCount = 0

  for (const item of rows) {
    const fundType = item.fund_type || '未分类'
    let ts = typeMap.get(fundType)
    if (!ts) {
      ts = { count: 0, return1yValues: [], return3mValues: [] }
      typeMap.set(fundType, ts)
    }
    ts.count += 1
    if (item.return_1y !== null) ts.return1yValues.push(item.return_1y)
    if (item.return_3m !== null) ts.return3mValues.push(item.return_3m)
    if (item.sharpe_ratio_1y !== null) enrichedCount++

    const gk = fundGroupKey(item.fund_type, item.fund_name)
    let gs = groupMap.get(gk)
    if (!gs) {
      gs = { key: gk, name: RESEARCH_FUND_GROUPS.find((g) => g.key === gk)?.name ?? '其他', count: 0, return1yValues: [] }
      groupMap.set(gk, gs)
    }
    gs.count += 1
    if (item.return_1y !== null) gs.return1yValues.push(item.return_1y)
  }

  const typeStats = Array.from(typeMap.entries())
    .map(([fundType, stat]) => ({
      fund_type: fundType,
      count: stat.count,
      ratio: total ? Math.round((stat.count / total) * 10000) / 100 : 0,
      pass_4433: 0,
      pass_rate: 0,
      return_1y_median: median(stat.return1yValues),
      return_3m_median: median(stat.return3mValues),
    }))
    .sort((a, b) => b.count - a.count)

  const groupStats = Array.from(groupMap.values())
    .map((stat) => ({
      key: stat.key,
      name: stat.name,
      count: stat.count,
      ratio: total ? Math.round((stat.count / total) * 10000) / 100 : 0,
      return_1y_median: median(stat.return1yValues),
    }))
    .sort((a, b) => b.count - a.count)

  const latestUpdate = rows.map((r) => r.updated_time).filter(Boolean).sort().reverse()[0] ?? null

  return {
    summary: {
      total_funds: total,
      return_1y_median: median(rows.map((r) => r.return_1y)),
      return_3m_median: median(rows.map((r) => r.return_3m)),
      positive_1y_rate: positiveRate(rows.map((r) => r.return_1y)),
      latest_update: latestUpdate,
    },
    type_stats: typeStats.slice(0, 30),
    group_stats: groupStats,
    items: rows,
    enrichment_summary: {
      total,
      enriched: enrichedCount,
      missing: total - enrichedCount,
    },
  }
}

export function buildResearchFundDashboard(items: ScreeningLikeItem[], limit: number): Record<string, unknown> {
  const grouped = new Map<string, { key: string; name: string; items: ResearchRow[] }>()
  for (const group of RESEARCH_FUND_GROUPS) {
    grouped.set(group.key, { key: group.key, name: group.name, items: [] })
  }
  grouped.set('other', { key: 'other', name: '其他', items: [] })

  for (const item of items) {
    const row = researchFundRow(item)
    const gk = fundGroupKey(row.fund_type, row.fund_name)
    if (!grouped.has(gk)) grouped.set(gk, { key: gk, name: '其他', items: [] })
    grouped.get(gk)!.items.push(row)
  }

  const cards = Array.from(grouped.values())
    .filter((g) => g.items.length > 0)
    .map((group) => {
      const sorted = [...group.items].sort((a, b) => {
        const pa = a.pass_4433 ? 1 : 0
        const pb = b.pass_4433 ? 1 : 0
        if (pa !== pb) return pb - pa
        const sa = a.sharpe_ratio_1y ?? -999
        const sb = b.sharpe_ratio_1y ?? -999
        if (sa !== sb) return sb - sa
        const ra = a.return_1y ?? -999
        const rb = b.return_1y ?? -999
        return rb - ra
      })
      return {
        key: group.key,
        name: group.name,
        summary: {
          total: group.items.length,
          pass_4433: group.items.filter((i) => i.pass_4433).length,
          return_1y_avg: avg(group.items.map((i) => i.return_1y)),
          sharpe_1y_avg: null,
        },
        items: sorted.slice(0, limit),
      }
    })
    .sort((a, b) => b.summary.total - a.summary.total)

  return { cards, limit }
}

export function buildResearchEtfTracking(items: ScreeningLikeItem[], limit: number): Record<string, unknown> {
  const etfItems: Record<string, unknown>[] = []
  for (const item of items) {
    const type = (getType(item) ?? '').toUpperCase()
    const name = getName(item).toUpperCase()
    if (type.includes('ETF') || type.includes('交易型开放式') || type.includes('指数') || name.includes('ETF')) {
      etfItems.push({
        fund_code: getCode(item),
        fund_name: getName(item),
        fund_type: getType(item),
        estimate_change: null,
        return_1y: roundPercent(getReturn(item, '1y')),
        nav_date: (item as Record<string, unknown>).nav_date ?? null,
        source: 'eastmoney.screening',
      })
    }
  }

  const categories = new Map<string, { category: string; count: number }>()
  for (const etf of etfItems) {
    const n = (etf.fund_name as string) || ''
    let cat: string
    if (/债|货币/.test(n)) cat = '债券/货币 ETF'
    else if (/港|纳斯达克|标普|日经|德国|QDII/.test(n)) cat = '跨境 ETF'
    else if (/黄金|商品|能源|豆粕/.test(n)) cat = '商品 ETF'
    else if (/医药|消费|芯片|半导体|证券|银行|军工|AI|机器人/.test(n)) cat = '行业主题 ETF'
    else cat = '宽基/普通指数 ETF'
    let s = categories.get(cat)
    if (!s) {
      s = { category: cat, count: 0 }
      categories.set(cat, s)
    }
    s.count += 1
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
  }
}

export function buildResearchSectorSummary(sectors: SectorLike[], limit: number): Record<string, unknown> {
  const items = sectors.slice(0, limit).map((s) => {
    const change = toFloat(s.changePercent)
    let mood: string
    let summaryText: string
    if (change === null) {
      mood = 'unknown'
      summaryText = '暂无涨跌幅数据'
    } else if (change >= 2) {
      mood = 'strong'
      summaryText = '强势上涨，短线热度较高'
    } else if (change >= 0) {
      mood = 'positive'
      summaryText = '温和上涨，表现好于弱势板块'
    } else if (change <= -2) {
      mood = 'weak'
      summaryText = '明显回调，注意波动风险'
    } else {
      mood = 'negative'
      summaryText = '小幅回落，走势偏弱'
    }
    const inflow = toFloat(s.mainNetInflow)
    const flowText = inflow !== null ? (inflow > 0 ? '，主力资金净流入' : '，主力资金净流出') : ''
    return {
      code: s.code,
      name: s.name,
      change_percent: change,
      main_net_inflow: inflow,
      mood,
      summary: summaryText + flowText,
    }
  })

  const withChange = items.filter((it) => it.change_percent !== null) as Array<{ change_percent: number } & Record<string, unknown>>
  const withInflow = items.filter((it) => it.main_net_inflow !== null) as Array<{ main_net_inflow: number } & Record<string, unknown>>

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
  }
}

export function buildResearchIndustryPerformance(items: ScreeningLikeItem[]): Record<string, unknown> {
  // Frontend uses industry-tag grouping (like chatIndustryTools) so results are
  // stable regardless of raw fund_type values.
  const groups = new Map<string, { funds: Record<string, unknown>[]; return3m: number[]; return6m: number[]; return1y: number[]; return3y: number[] }>()

  for (const item of items) {
    const industry = classifyFundIndustry(getName(item))
    let bucket = groups.get(industry)
    if (!bucket) {
      bucket = { funds: [], return3m: [], return6m: [], return1y: [], return3y: [] }
      groups.set(industry, bucket)
    }
    bucket.funds.push({ fund_code: getCode(item), fund_name: getName(item), fund_type: getType(item) })
    const r3m = getReturn(item, '3m')
    const r6m = getReturn(item, '6m')
    const r1y = getReturn(item, '1y')
    const r3y = getReturn(item, '3y')
    if (r3m !== null) bucket.return3m.push(r3m)
    if (r6m !== null) bucket.return6m.push(r6m)
    if (r1y !== null) bucket.return1y.push(r1y)
    if (r3y !== null) bucket.return3y.push(r3y)
  }

  const resultItems = Array.from(groups.entries()).map(([industry, bucket]) => ({
    industry,
    fund_count: bucket.funds.length,
    return_3m_avg: avg(bucket.return3m),
    return_3m_median: median(bucket.return3m),
    return_6m_avg: avg(bucket.return6m),
    return_6m_median: median(bucket.return6m),
    return_1y_avg: avg(bucket.return1y),
    return_1y_median: median(bucket.return1y),
    return_3y_avg: avg(bucket.return3y),
    return_3y_median: median(bucket.return3y),
    positive_3m_rate: positiveRate(bucket.return3m),
    positive_6m_rate: positiveRate(bucket.return6m),
    positive_1y_rate: positiveRate(bucket.return1y),
    positive_3y_rate: positiveRate(bucket.return3y),
    updated_time: null,
  }))

  const sorted3m = [...resultItems].sort((a, b) => {
    const va = a.return_3m_median ?? -9999
    const vb = b.return_3m_median ?? -9999
    return vb - va
  })
  const sorted1y = [...resultItems].sort((a, b) => {
    const va = a.return_1y_median ?? -9999
    const vb = b.return_1y_median ?? -9999
    return vb - va
  })
  const weak3m = [...resultItems].sort((a, b) => {
    const va = a.return_3m_median ?? 9999
    const vb = b.return_3m_median ?? 9999
    return va - vb
  })

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
  }
}

export function buildDashboard(
  items: ScreeningLikeItem[],
  sectors: SectorLike[],
  limit: number,
  etfLimit: number,
): Record<string, unknown> {
  return {
    market_stats: buildResearchMarketStats(items),
    fund_dashboard: buildResearchFundDashboard(items, limit),
    etf_tracking: buildResearchEtfTracking(items, etfLimit),
    industry_performance: buildResearchIndustryPerformance(items),
    updated_at: new Date().toISOString(),
    data_source: {
      primary: 'eastmoney.screening (client-side)',
      industry_performance: 'frontend classification',
      etf_net_flow: 'not_available',
    },
  }
}
