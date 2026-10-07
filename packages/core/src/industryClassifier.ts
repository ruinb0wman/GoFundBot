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
