export interface FundEnrichment {
  fund_type: string | null;
  industry_tag: string | null;
  max_drawdown_1y: number | null;
  sharpe_ratio_1y: number | null;
  sharpe_ratio_3y: number | null;
  volatility_1y: number | null;
  calmar_ratio_1y: number | null;
  updated_at: string;
}

export const enrichmentMap = new Map<string, FundEnrichment>();

export async function enrichFund(code: string): Promise<void> {
  const { getFundNavHistory } = await import('./fundService.js');
  const { fetchFundCodeSearchList } = await import('../providers/eastmoney/eastmoneyFundProvider.js');
  const { computeRiskMetrics } = await import('./riskMetricsService.js');
  const { classifyFundIndustry } = await import('./industryService.js');

  const [navResult, typeList] = await Promise.all([
    getFundNavHistory(code, {}),
    fetchFundCodeSearchList(),
  ]);

  const navPoints = navResult.data?.items ?? [];
  const fundListItem = typeList.find(f => f.code === code);
  const name = fundListItem?.name ?? code;

  enrichmentMap.set(code, {
    fund_type: fundListItem?.type ?? null,
    industry_tag: classifyFundIndustry(name),
    ...computeRiskMetrics(navPoints.map(p => ({ date: p.date, nav: p.nav }))),
    updated_at: new Date().toISOString(),
  });
}

export function getEnrichment(code: string): FundEnrichment | undefined {
  return enrichmentMap.get(code);
}
