const INDUSTRY_RULES: [RegExp, string][] = [
  [/创新药|医疗|医药|生物|医美|健康/, '医药医疗'],
  [/新能源|光伏|风电|氢能|锂电|电池|能源/, '新能源'],
  [/半导体|芯片|集成电路|电子/, '半导体/芯片'],
  [/AI|人工智能|智能|机器人|大模型|算力/, '人工智能'],
  [/消费|白酒|食品|饮料|家电|零售/, '消费'],
  [/科技|互联|信息|软件|IT|计算机/, '科技'],
  [/金融|银行|保险|证券|地产/, '金融地产'],
  [/军工|国防|航天|航空/, '军工'],
  [/化工|材料|有色|钢铁|建材/, '周期'],
  [/沪深300|中证\w+|上证\w+|MSCI|指数/, '宽基指数'],
  [/红利|股息/, '红利'],
  [/债券|纯债|短债|信用债|利率债/, '固收'],
  [/货币|理财/, '货币'],
  [/海外|QDII|纳斯达克|恒生|标普|港股|美股/, '海外'],
  [/新能源车|汽车/, '新能源汽车'],
  [/通信|5G|6G|光模块/, '通信'],
  [/碳中和|环保|ESG/, '环保/碳中和'],
  [/黄金|贵金属/, '黄金/贵金属'],
];

export function classifyFundIndustry(fundName: string): string {
  if (!fundName) return '其他';
  for (const [pattern, tag] of INDUSTRY_RULES) {
    if (pattern.test(fundName)) {
      return tag;
    }
  }
  return '其他';
}

export function batchClassifyIndustry(
  funds: { fund_code: string; fund_name: string }[],
): { fund_code: string; fund_name: string; industry_tag: string }[] {
  return funds.map(f => ({
    fund_code: f.fund_code,
    fund_name: f.fund_name,
    industry_tag: classifyFundIndustry(f.fund_name),
  }));
}
