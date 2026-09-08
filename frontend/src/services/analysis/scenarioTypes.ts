/**
 * Structured-output contracts for AI analysis scenarios.
 *
 * One TypeBox schema per scenario / sub-call. Field names strictly match the
 * existing DTOs consumed by the UI (FundAnalysisResult / PortfolioAnalysisResult
 * / LogAnalysisResult), so rendering layers need zero changes. The analysis
 * engine validates every final output with `Value.Check` before emitting the
 * `result` event; mismatches are fed back as `INVALID_OUTPUT` corrections.
 */

import { Type, type TObject } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const stringArray = () => Type.Array(Type.String())

const RATING_UNION = Type.Union([
  Type.Literal('Strong Buy'),
  Type.Literal('Buy'),
  Type.Literal('Hold'),
  Type.Literal('Underweight'),
  Type.Literal('Sell'),
])

const DASHBOARD_SCHEMA = Type.Object({
  performance_eval: Type.String(),
  manager_ability: Type.String(),
  position_analysis: Type.String(),
  market_outlook: Type.String(),
})

/** One analyst's report (4 roles × same shape). */
export const AnalystReportSchema: TObject = Type.Object({
  analyst_role: Type.String(),
  thesis: Type.String(),
  score: Type.Number({ minimum: 0, maximum: 10 }),
  key_evidence: stringArray(),
  risk_flags: stringArray(),
})

/** Fund research director's final verdict (4+1 multi-agent supervisor). */
export const SupervisorOutputSchema: TObject = Type.Object({
  rating: RATING_UNION,
  sentiment_score: Type.Number({ minimum: 0, maximum: 100 }),
  operation_advice: Type.String(),
  summary: Type.String(),
  dashboard: DASHBOARD_SCHEMA,
  highlights: stringArray(),
  risk_factors: stringArray(),
  news_intel: stringArray(),
  detailed_report: Type.String(),
})

/** Assembled fund analysis result: 4 reports + optional supervisor. */
export const FundAnalysisResultSchema: TObject = Type.Object({
  fund_code: Type.String(),
  fund_name: Type.String(),
  reports: Type.Array(AnalystReportSchema),
  supervisor: Type.Union([SupervisorOutputSchema, Type.Null()]),
})

/** Portfolio diagnosis result (same fields as the existing PortfolioAnalysisResult DTO). */
export const PortfolioAnalysisResultSchema: TObject = Type.Object({
  fund_code: Type.String(),
  fund_name: Type.String(),
  rating: Type.Union([Type.String(), Type.Null()]),
  sentiment_score: Type.Number({ minimum: 0, maximum: 100 }),
  operation_advice: Type.String(),
  summary: Type.String(),
  dashboard: DASHBOARD_SCHEMA,
  highlights: stringArray(),
  risk_factors: stringArray(),
  news_intel: stringArray(),
  detailed_report: Type.String(),
})

/**
 * Log analysis result. Base fields mirror the Node rule engine
 * (`logService.analyzeLogs`) so the rule engine stays the degradation source;
 * `llm_summary` is the optional LLM-written enhancement, `llm_error` marks a
 * fallback that skipped the LLM.
 */
export const LogAnalysisSchema: TObject = Type.Object({
  total: Type.Number(),
  error_count: Type.Number(),
  warn_count: Type.Number(),
  patterns: stringArray(),
  suggestions: stringArray(),
  critical: stringArray(),
  llm_summary: Type.Optional(Type.String()),
  llm_error: Type.Optional(Type.String()),
})

/** Runtime schema validation helper used by the engine and tests. */
export function schemaErrors(schema: TObject, value: unknown): string[] {
  if (Value.Check(schema, value)) return []
  return [...Value.Errors(schema, value)].slice(0, 12).map((e) => `${e.path || '$'}: ${e.message}`)
}
