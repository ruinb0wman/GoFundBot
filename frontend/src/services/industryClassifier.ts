/**
 * Frontend industry / fund-type classification and industry aggregation.
 * Ported from Service `industryService.ts` + `chatIndustryTools.ts`.
 * Used for screening enrichment and research/chat industry aggregation.
 */

export interface IndustryRule {
  pattern: RegExp
  tag: string
  keywords: string[]
}

export const INDUSTRY_RULES: IndustryRule[] = [
  { pattern: /创新药|医疗|医药|生物|医美|健康/, tag: '医药医疗', keywords: ['创新药', '医疗', '医药', '生物', '医美', '健康'] },
  { pattern: /新能源|光伏|风电|氢能|锂电|电池|能源/, tag: '新能源', keywords: ['新能源', '光伏', '风电', '氢能', '锂电', '电池', '能源'] },
  { pattern: /半导体|芯片|集成电路|电子/, tag: '半导体/芯片', keywords: ['半导体', '芯片', '集成电路', '电子'] },
  { pattern: /AI|人工智能|智能|机器人|大模型|算力/, tag: '人工智能', keywords: ['AI', '人工智能', '智能', '机器人', '大模型', '算力'] },
  { pattern: /消费|白酒|食品|饮料|家电|零售/, tag: '消费', keywords: ['消费', '白酒', '食品', '饮料', '家电', '零售'] },
  { pattern: /科技|互联|信息|软件|IT|计算机/, tag: '科技', keywords: ['科技', '互联', '信息', '软件', 'IT', '计算机'] },
  { pattern: /金融|银行|保险|证券|地产/, tag: '金融地产', keywords: ['金融', '银行', '保险', '证券', '地产'] },
  { pattern: /军工|国防|航天|航空/, tag: '军工', keywords: ['军工', '国防', '航天', '航空'] },
  { pattern: /化工|材料|有色|钢铁|建材/, tag: '周期', keywords: ['化工', '材料', '有色', '钢铁', '建材'] },
  { pattern: /沪深300|中证\d*|上证\d*|MSCI|指数/, tag: '宽基指数', keywords: ['沪深300', '中证', '上证', 'MSCI', '指数'] },
  { pattern: /红利|股息/, tag: '红利', keywords: ['红利', '股息'] },
  { pattern: /债券|纯债|短债|信用债|利率债/, tag: '固收', keywords: ['债券', '纯债', '短债', '信用债', '利率债'] },
  { pattern: /货币|理财/, tag: '货币', keywords: ['货币', '理财'] },
  { pattern: /海外|QDII|纳斯达克|恒生|标普|港股|美股/, tag: '海外', keywords: ['海外', 'QDII', '纳斯达克', '恒生', '标普', '港股', '美股'] },
  { pattern: /新能源车|汽车/, tag: '新能源汽车', keywords: ['新能源车', '汽车'] },
  { pattern: /通信|5G|6G|光模块/, tag: '通信', keywords: ['通信', '5G', '6G', '光模块'] },
  { pattern: /碳中和|环保|ESG/, tag: '环保/碳中和', keywords: ['碳中和', '环保', 'ESG'] },
  { pattern: /黄金|贵金属/, tag: '黄金/贵金属', keywords: ['黄金', '贵金属'] },
]

export function classifyFundIndustry(fundName: string | null | undefined): string {
  if (!fundName) return '其他'
  for (const rule of INDUSTRY_RULES) {
    if (rule.pattern.test(fundName)) return rule.tag
  }
  return '其他'
}

export function classifyFundType(name: string | null | undefined): string {
  if (!name) return '其他'
  const n = name.toUpperCase()
  if (n.includes('货币')) return '货币型'
  if (n.includes('债券') || n.includes('纯债') || n.includes('短债') || n.includes('可转债')) return '债券型'
  if (n.includes('ETF') || n.includes('交易型')) return 'ETF'
  if (n.includes('指数') || n.includes('联接')) return '指数型'
  if (n.includes('QDII')) return 'QDII'
  if (n.includes('FOF')) return 'FOF'
  if (n.includes('股票')) return '股票型'
  return '混合型'
}

export function batchClassifyIndustry(
  funds: { fund_code: string; fund_name: string }[],
): { fund_code: string; fund_name: string; industry_tag: string }[] {
  return funds.map((f) => ({
    fund_code: f.fund_code,
    fund_name: f.fund_name,
    industry_tag: classifyFundIndustry(f.fund_name),
  }))
}

// ---------------------------------------------------------------------------
// Fund list item shaped like FundScreeningSnapshotItemDto / ScreeningFund
// ---------------------------------------------------------------------------

export interface ScreeningLikeItem {
  code?: string
  fund_code?: string
  name?: string
  fund_name?: string
  type?: string | null
  fund_type?: string | null
  return1m?: number | null
  return_1m?: number | null
  return3m?: number | null
  return_3m?: number | null
  return6m?: number | null
  return_6m?: number | null
  return1y?: number | null
  return_1y?: number | null
  return2y?: number | null
  return_2y?: number | null
  return3y?: number | null
  return_3y?: number | null
}

function toCode(item: ScreeningLikeItem): string {
  return item.code ?? item.fund_code ?? ''
}

function toName(item: ScreeningLikeItem): string {
  return item.name ?? item.fund_name ?? ''
}

function toType(item: ScreeningLikeItem): string | null {
  return item.type ?? item.fund_type ?? null
}

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

export function buildIndustryPerformanceFromScreening(items: ScreeningLikeItem[]): Record<string, unknown> {
  const groups = new Map<string, { funds: Record<string, unknown>[]; return3m: number[]; return6m: number[]; return1y: number[]; return3y: number[] }>()

  for (const item of items) {
    const industry = classifyFundIndustry(toName(item))
    let bucket = groups.get(industry)
    if (!bucket) {
      bucket = { funds: [], return3m: [], return6m: [], return1y: [], return3y: [] }
      groups.set(industry, bucket)
    }
    bucket.funds.push({ fund_code: toCode(item), fund_name: toName(item), fund_type: toType(item) })
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
  }))

  const sorted3m = [...resultItems].sort((a, b) => (b.return_3m_median ?? -9999) - (a.return_3m_median ?? -9999))
  const sorted1y = [...resultItems].sort((a, b) => (b.return_1y_median ?? -9999) - (a.return_1y_median ?? -9999))
  const weak3m = [...resultItems].sort((a, b) => (a.return_3m_median ?? 9999) - (b.return_3m_median ?? 9999))

  return {
    items: resultItems,
    summary: {
      total: resultItems.length,
      fund_count: resultItems.reduce((sum, r) => sum + r.fund_count, 0),
    },
    top_3m: sorted3m.slice(0, 8),
    top_1y: sorted1y.slice(0, 8),
    weak_3m: weak3m.slice(0, 8),
  }
}

export function filterFundsByIndustry(
  items: ScreeningLikeItem[],
  keyword: string,
): { funds: Record<string, unknown>[]; total: number; message?: string } {
  if (!keyword) return { funds: [], total: 0, message: '关键词为空' }

  const matchedTags = new Set<string>()
  const kw = keyword.toLowerCase()
  for (const rule of INDUSTRY_RULES) {
    const match = rule.keywords.some((k) => k.toLowerCase().includes(kw) || kw.includes(k.toLowerCase()))
    if (match) matchedTags.add(rule.tag)
  }

  const funds = items
    .map((item) => ({ item, tag: classifyFundIndustry(toName(item)) }))
    .filter(({ tag }) => matchedTags.size === 0 || matchedTags.has(tag))
    .slice(0, 50)
    .map(({ item }) => ({
      fund_code: toCode(item),
      fund_name: toName(item),
      fund_type: toType(item),
      industry_tag: null,
      industry_ratio: null,
      return_1m: roundPercent(getReturn(item, '1m')),
      return_3m: roundPercent(getReturn(item, '3m')),
      return_6m: roundPercent(getReturn(item, '6m')),
      return_1y: roundPercent(getReturn(item, '1y')),
    }))

  if (funds.length === 0) {
    return { funds: [], total: 0, message: `未找到与'${keyword}'相关的基金` }
  }
  return { funds, total: funds.length }
}

export function compute4433Ranking(items: ScreeningLikeItem[]): Record<string, unknown>[] {
  const groups = new Map<string, ScreeningLikeItem[]>()
  for (const item of items) {
    const name = toName(item)
    if (!name) continue
    const gk = classifyFundType(name)
    if (!groups.has(gk)) groups.set(gk, [])
    groups.get(gk)!.push(item)
  }

  const passing: Record<string, unknown>[] = []

  for (const [, groupItems] of groups) {
    if (groupItems.length < 10) continue

    const nums = (p: string) => groupItems.map((i) => getReturn(i, p)).filter((v): v is number => v !== null).sort((a, b) => a - b)
    const v1y = nums('1y')
    const v2y = nums('2y')
    const v3y = nums('3y')
    const v3m = nums('3m')
    const v6m = nums('6m')

    if (v1y.length < 10 || v3m.length < 10 || v6m.length < 10) continue

    const p75_1y = v1y[Math.floor(v1y.length * 0.75)]
    const p75_2y = v2y.length >= 10 ? v2y[Math.floor(v2y.length * 0.75)] : null
    const p75_3y = v3y.length >= 10 ? v3y[Math.floor(v3y.length * 0.75)] : null
    const p67_3m = v3m[Math.floor(v3m.length * 2 / 3)]
    const p67_6m = v6m[Math.floor(v6m.length * 2 / 3)]

    for (const item of groupItems) {
      const r1y = getReturn(item, '1y')
      const r3m = getReturn(item, '3m')
      const r6m = getReturn(item, '6m')
      const r2y = getReturn(item, '2y')
      const r3y = getReturn(item, '3y')
      const ok =
        r1y !== null && r1y >= p75_1y &&
        r3m !== null && r3m >= p67_3m &&
        r6m !== null && r6m >= p67_6m &&
        (p75_2y === null || (r2y !== null && r2y >= p75_2y)) &&
        (p75_3y === null || (r3y !== null && r3y >= p75_3y))

      if (ok) {
        passing.push({
          fund_code: toCode(item),
          fund_name: toName(item),
          fund_type: toType(item),
          return_1y: roundPercent(r1y),
          return_3m: roundPercent(r3m),
          return_6m: roundPercent(r6m),
        })
      }
    }
  }

  return passing.sort((a, b) => ((b.return_1y as number) ?? 0) - ((a.return_1y as number) ?? 0)).slice(0, 50)
}
