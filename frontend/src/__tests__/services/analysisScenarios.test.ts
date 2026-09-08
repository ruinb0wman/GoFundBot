import { describe, expect, it } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import { ANALYSIS_SCENARIOS } from '../../services/analysis/analysisScenarios'
import {
  AnalystReportSchema,
  FundAnalysisResultSchema,
  LogAnalysisSchema,
  PortfolioAnalysisResultSchema,
  SupervisorOutputSchema,
} from '../../services/analysis/scenarioTypes'
import { TOOL_REGISTRY } from '../../services/chatEngine/toolContract'

const SCENARIO_IDS = ['fund_analysis', 'portfolio_diagnosis', 'log_analysis']

function propsOf(schema: { properties: Record<string, unknown> }): string[] {
  return Object.keys(schema.properties)
}

describe('analysis scenario registry', () => {
  it('registers all three scenarios with complete Skill fields', () => {
    for (const id of SCENARIO_IDS) {
      const s = ANALYSIS_SCENARIOS[id]
      expect(s, id).toBeTruthy()
      expect(s.id).toBe(id)
      expect(typeof s.systemPrompt).toBe('string')
      expect(s.systemPrompt.length).toBeGreaterThan(50)
      expect(s.outputSchema).toBeTruthy()
      expect(['multi-analyst', 'single']).toContain(s.pipeline)
    }
  })

  it('keeps every scenario tool name inside the TOOL_REGISTRY (incl. per-analyst subsets)', () => {
    for (const id of SCENARIO_IDS) {
      const s = ANALYSIS_SCENARIOS[id]
      for (const name of s.toolNames) {
        expect(TOOL_REGISTRY[name], `${id}: scenario -> ${name}`).toBeTruthy()
      }
      for (const analyst of s.analysts ?? []) {
        for (const name of analyst.toolNames) {
          expect(TOOL_REGISTRY[name], `${id}/${analyst.role} -> ${name}`).toBeTruthy()
        }
      }
    }
  })

  it('fund_analysis keeps the 4+1 multi-analyst shape with tool subsets', () => {
    const fund = ANALYSIS_SCENARIOS.fund_analysis
    expect(fund.pipeline).toBe('multi-analyst')
    expect(fund.analysts?.map((a) => a.role)).toEqual(['performance', 'holding', 'manager', 'market'])
    // supervisor holds the full tool set
    expect(fund.toolNames.length).toBeGreaterThan(fund.analysts![3].toolNames.length)

    const roles = new Map((fund.analysts ?? []).map((a) => [a.role, a]))
    expect(roles.get('market')!.toolNames).toEqual(
      expect.arrayContaining(['get_market_news', 'get_hot_sectors', 'get_concept_sectors', 'get_index_kline', 'get_north_flow', 'get_main_flow']),
    )
    expect(roles.get('manager')!.toolNames).toContain('get_fund_managers')
    expect(roles.get('holding')!.toolNames).toContain('get_fund_holdings')
    expect(roles.get('performance')!.toolNames).toEqual(
      expect.arrayContaining(['get_fund_nav_history', 'get_fund_estimate', 'get_index_kline']),
    )
  })

  it('portfolio_diagnosis is a single task with market + fund tools', () => {
    const p = ANALYSIS_SCENARIOS.portfolio_diagnosis
    expect(p.pipeline).toBe('single')
    expect(p.toolNames).toEqual(
      expect.arrayContaining(['get_market_indices', 'get_hot_sectors', 'get_north_flow', 'get_fund_detail', 'get_fund_estimate']),
    )
  })

  it('log_analysis is a single self-contained task with no tools and a fallback', () => {
    const l = ANALYSIS_SCENARIOS.log_analysis
    expect(l.pipeline).toBe('single')
    expect(l.toolNames).toEqual([])
    expect(typeof l.fallback).toBe('function')
  })
})

describe('output schemas match existing DTO field names', () => {
  const validReport = {
    analyst_role: 'performance',
    thesis: '业绩优秀',
    score: 8,
    key_evidence: ['e1'],
    risk_flags: ['r1'],
  }

  it('AnalystReportSchema validates the DTO shape and rejects violations', () => {
    expect(Value.Check(AnalystReportSchema, validReport)).toBe(true)
    expect(Value.Check(AnalystReportSchema, { ...validReport, score: '8' })).toBe(false)
    expect(Value.Check(AnalystReportSchema, { ...validReport, key_evidence: 'nope' })).toBe(false)
  })

  it('SupervisorOutputSchema validates the 4+1 supervisor DTO shape', () => {
    const supervisor = {
      rating: 'Buy',
      sentiment_score: 70,
      operation_advice: '买入',
      summary: '综合观点',
      dashboard: { performance_eval: '优秀', manager_ability: '良好', position_analysis: '均衡', market_outlook: '乐观' },
      highlights: ['h'],
      risk_factors: ['r'],
      news_intel: ['n'],
      detailed_report: '## 报告',
    }
    expect(Value.Check(SupervisorOutputSchema, supervisor)).toBe(true)
    expect(Value.Check(SupervisorOutputSchema, { ...supervisor, rating: 'Moon' })).toBe(false)
  })

  it('FundAnalysisResultSchema mirrors the fund DTO (fund_code/fund_name/reports/supervisor)', () => {
    expect(propsOf(FundAnalysisResultSchema).sort()).toEqual(['fund_code', 'fund_name', 'reports', 'supervisor'])
    const assembled = {
      fund_code: '019667',
      fund_name: '测试基金',
      reports: [validReport],
      supervisor: null,
    }
    expect(Value.Check(FundAnalysisResultSchema, assembled)).toBe(true)
  })

  it('PortfolioAnalysisResultSchema mirrors the portfolio DTO fields', () => {
    expect(propsOf(PortfolioAnalysisResultSchema).sort()).toEqual(
      ['dashboard', 'detailed_report', 'fund_code', 'fund_name', 'highlights', 'news_intel', 'operation_advice', 'rating', 'risk_factors', 'sentiment_score', 'summary'].sort(),
    )
    expect(propsOf(PortfolioAnalysisResultSchema)).toContain('dashboard')
    expect(propsOf((PortfolioAnalysisResultSchema.properties as any).dashboard)).toEqual(
      expect.arrayContaining(['performance_eval', 'manager_ability', 'position_analysis', 'market_outlook']),
    )
  })

  it('LogAnalysisSchema mirrors the rule-engine fields and allows optional llm fields', () => {
    expect(propsOf(LogAnalysisSchema).sort()).toEqual(
      ['critical', 'error_count', 'llm_error', 'llm_summary', 'patterns', 'suggestions', 'total', 'warn_count'].sort(),
    )
    const base = { total: 10, error_count: 2, warn_count: 3, patterns: [], suggestions: [], critical: [] }
    expect(Value.Check(LogAnalysisSchema, base)).toBe(true)
    expect(Value.Check(LogAnalysisSchema, { ...base, llm_summary: '摘要', llm_error: 'x' })).toBe(true)
    expect(Value.Check(LogAnalysisSchema, { ...base, total: '10' })).toBe(false)
  })
})
