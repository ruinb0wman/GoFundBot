/**
 * Frontend AI log analysis adapter（设置-日志）.
 *
 * Reads warn/error entries via `GET /api/logs/read`（limit ≤ 500）→ builds a
 * compact context → runs the `log_analysis` scenario through the analysis
 * engine（Schema 校验 + 净化 + 结构化降级）. The Node rule engine
 * (`POST /api/logs/analyze`) is kept untouched as the degradation source: on a
 * missing LLM key or LLM failure the scenario fallback returns the rule-engine
 * result plus an `llm_error` marker. LLM keys stay frontend-only.
 */

import { runScenario } from './analysisEngine'
import { LOG_ANALYSIS_SCENARIO } from './analysisScenarios'
import type { LLMConfig } from '../llm'
import type { AppSettings } from '../../composables/useAppSettings'

const MAX_LOG_ENTRIES = 500

export interface LogEntryLite {
  level: string
  message: string
  time?: string
  context?: Record<string, unknown>
}

export interface LogAnalysisResult {
  total: number
  error_count: number
  warn_count: number
  patterns: string[]
  suggestions: string[]
  critical: string[]
  llm_summary?: string
  llm_error?: string
}

interface LogReadData {
  entries: LogEntryLite[]
  counts: Record<string, number>
  totalAll: number
}

async function fetchLogRead(source: string, date: string): Promise<LogReadData> {
  const params = new URLSearchParams({ source, date, limit: String(MAX_LOG_ENTRIES), offset: '0' })
  const res = await fetch(`/api/logs/read?${params}`)
  const json = await res.json()
  if (!json.success) return { entries: [], counts: {}, totalAll: 0 }
  const data = json.data ?? {}
  const counts: Record<string, number> = data.counts ?? {}
  const totalAll = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0)
  const all = Array.isArray(data.entries) ? (data.entries as LogEntryLite[]) : []
  const warnError = all
    .filter((e) => e.level === 'warn' || e.level === 'error')
    .slice(0, MAX_LOG_ENTRIES)
  return { entries: warnError.reverse(), counts, totalAll }
}

function buildLogContext(source: string, date: string, data: LogReadData): string {
  const lines = data.entries.map((e) => {
    const ctx = e.context ? ` ${JSON.stringify(e.context)}` : ''
    return `[${e.level}] ${e.time ?? ''} ${e.message}${ctx}`
  })
  return [
    `数据源：${source}，日期：${date}，warn/error 条目 ${data.entries.length} 条（全量日志见下方 total/counts）。`,
    ...lines,
  ].join('\n')
}

function baseCounts(data: LogReadData, fallback: Partial<LogAnalysisResult>): Partial<LogAnalysisResult> {
  const preferCounts = (v: number | undefined, c: number | undefined, d: number | undefined) =>
    c != null ? c : (typeof v === 'number' && v >= 0 ? v : (d ?? 0))
  return {
    total: preferCounts(fallback.total, data.totalAll, 0),
    error_count: preferCounts(fallback.error_count, data.counts.error, 0),
    warn_count: preferCounts(fallback.warn_count, data.counts.warn, 0),
  }
}

/**
 * AI-assisted log analysis. Returns a `LogAnalysisResult` whose base fields are
 * backed by the file counts（优先）或模型输出；`llm_summary` 只在 LLM 成功时存在；
 * LLM 缺失/失败时回退规则引擎并带 `llm_error`。
 */
export async function analyzeLogsWithAI(
  source: string,
  date: string,
  llmConfig?: LLMConfig,
  searchSettings?: AppSettings,
): Promise<LogAnalysisResult> {
  let read: LogReadData = { entries: [], counts: {}, totalAll: 0 }
  try {
    read = await fetchLogRead(source, date)
  } catch {
    // continue with empty window; fallback still reports counts（0）
  }

  const context = buildLogContext(source, date, read)
  const config: LLMConfig = {
    apiKey: llmConfig?.apiKey ?? '',
    apiBase: llmConfig?.apiBase,
    model: llmConfig?.model,
  }

  const task = runScenario({
    scenario: LOG_ANALYSIS_SCENARIO,
    userPrompt: context,
    llmConfig: config,
    searchSettings,
    fallbackCtx: { source, date, counts: read.counts },
  })

  let result: Partial<LogAnalysisResult> | null = null
  for await (const ev of task) {
    if (ev.event === 'result') {
      try {
        result = JSON.parse(ev.data)
      } catch {
        // keep null
      }
    }
  }

  const counts = baseCounts(read, result ?? {})
  return {
    total: counts.total ?? 0,
    error_count: counts.error_count ?? 0,
    warn_count: counts.warn_count ?? 0,
    patterns: Array.isArray(result?.patterns) ? result.patterns! : [],
    suggestions: Array.isArray(result?.suggestions) ? result.suggestions! : [],
    critical: Array.isArray(result?.critical) ? result.critical! : [],
    ...(result?.llm_summary ? { llm_summary: result.llm_summary } : {}),
    ...(result?.llm_error ? { llm_error: result.llm_error } : {}),
  }
}
