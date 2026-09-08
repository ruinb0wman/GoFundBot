import { describe, expect, it } from 'vitest'
import {
  TOOL_REGISTRY,
  listToolSpecs,
  getToolSpec,
  toolLabel,
  toolSpecToOpenAI,
  toolSpecsToXml,
  validateToolCall,
  escapeXml,
  TOOL_CALL_RULES,
} from '../../services/chatEngine/toolContract'

/** The 25 chat tools known to the system (kept in sync with skills.ts toolNames). */
const EXPECTED_TOOLS = [
  'search_funds', 'get_fund_detail', 'get_fund_estimate', 'get_fund_nav_history',
  'get_market_indices', 'get_market_news', 'get_hot_sectors', 'get_concept_sectors',
  'get_north_flow', 'get_market_breadth', 'get_main_flow', 'get_flash_news',
  'get_watchlist', 'screen_funds_by_4433', 'run_backtest', 'suggest_strategy',
  'get_stock_quote', 'get_market_anomaly', 'get_gold_realtime', 'get_fund_holdings',
  'get_fund_managers', 'get_funds_by_industry', 'get_industry_performance',
  'search_news', 'get_index_kline',
]

describe('tool registry', () => {
  it('contains exactly the expected 25 tools with full metadata', () => {
    const names = listToolSpecs().map((t) => t.name)
    expect(names.sort()).toEqual([...EXPECTED_TOOLS].sort())
    for (const spec of listToolSpecs()) {
      expect(spec.label, spec.name).toBeTruthy()
      expect(spec.description, spec.name).toBeTruthy()
      expect(spec.parameters.type, spec.name).toBe('object')
      expect(Object.keys(spec.parameters.properties ?? {}), `${spec.name} params`).toBeTruthy()
      expect(getToolSpec(spec.name), spec.name).toBe(spec)
    }
  })

  it('required params are declared in properties', () => {
    const backtest = getToolSpec('run_backtest')!
    expect(backtest.parameters.required).toEqual(['fund_code', 'start_date', 'end_date'])
    for (const req of backtest.parameters.required as string[]) {
      expect((backtest.parameters.properties as Record<string, unknown>)[req]).toBeTruthy()
    }
  })

  it('provides labels for UI chips and falls back to the raw name', () => {
    expect(toolLabel('search_funds')).toBeTruthy()
    expect(toolLabel('does_not_exist')).toBe('does_not_exist')
  })
})

describe('validateToolCall', () => {
  it('accepts valid arguments and strips nothing', () => {
    const r = validateToolCall('get_fund_nav_history', { code: '110022' })
    expect(r).toEqual({ ok: true, args: { code: '110022' } })
  })

  it('allows optional params and tolerates extra props', () => {
    expect(validateToolCall('get_hot_sectors', { limit: 10, extra: 'x' }).ok).toBe(true)
    expect(validateToolCall('get_hot_sectors', {}).ok).toBe(true)
  })

  it('rejects unknown (hallucinated) tool names with UNKNOWN_TOOL and lists available tools', () => {
    const r = validateToolCall('get_industry_spot', { industries: ['半导体'] })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('UNKNOWN_TOOL')
    expect(r.error).toContain('工具不存在: get_industry_spot')
    expect(r.error).toContain('可用工具')
    expect(r.error).toContain('get_hot_sectors')
  })

  it('rejects missing required args and wrong types with INVALID_ARGS', () => {
    const missing = validateToolCall('search_funds', {})
    expect(missing.ok).toBe(false)
    expect(missing.code).toBe('INVALID_ARGS')
    expect(missing.error).toContain('参数无效')

    const badType = validateToolCall('run_backtest', { fund_code: 110022, start_date: '2026-01-01', end_date: '2026-06-01' })
    expect(badType.ok).toBe(false)
    expect(badType.code).toBe('INVALID_ARGS')
  })

  it('validates enums (investment_type / period)', () => {
    expect(validateToolCall('run_backtest', { fund_code: '110022', start_date: '2026-01-01', end_date: '2026-06-01', investment_type: 'weekly' }).ok).toBe(true)
    expect(validateToolCall('run_backtest', { fund_code: '110022', start_date: '2026-01-01', end_date: '2026-06-01', investment_type: 'yearly' }).ok).toBe(false)
    expect(validateToolCall('get_index_kline', { code: 'sh000300', start_date: '2026-01-01', end_date: '2026-06-01', period: 'monthly' }).ok).toBe(true)
  })
})

describe('toolSpecToOpenAI', () => {
  it('produces the OpenAI-native function shape', () => {
    const tool = toolSpecToOpenAI(getToolSpec('search_funds')!)
    expect(tool.type).toBe('function')
    expect(tool.function.name).toBe('search_funds')
    expect(tool.function.description).toContain('搜索基金')
    expect((tool.function.parameters.properties as Record<string, unknown>).keyword).toBeTruthy()
    expect((tool.function.parameters.required as string[])).toEqual(['keyword'])
    // no TypeBox bookkeeping keys
    expect(JSON.stringify(tool)).not.toContain('$schema')
  })
})

describe('toolSpecsToXml', () => {
  it('emits a well-formed <available_tools> spec with required markers', () => {
    const xml = toolSpecsToXml([getToolSpec('get_fund_detail')!, getToolSpec('get_market_indices')!])
    expect(xml).toContain('<available_tools>')
    expect(xml).toContain('</available_tools>')
    expect(xml).toContain('<tool name="get_fund_detail"')
    expect(xml).toContain('<parameter name="code" type="string" required="true">')
    expect(xml).toContain('<tool name="get_market_indices"')
    // escapes descriptions
    expect(escapeXml('a<b>&"c')).toBe('a&lt;b&gt;&amp;&quot;c')
  })

  it('lists enums in the parameter type column', () => {
    const xml = toolSpecsToXml([getToolSpec('get_index_kline')!])
    expect(xml).toContain('type="daily|weekly|monthly"')
  })
})

describe('TOOL_CALL_RULES', () => {
  it('defines the XML invocation contract', () => {
    expect(TOOL_CALL_RULES).toContain('<ai_tool_calls>')
    expect(TOOL_CALL_RULES).toContain('<invoke name=')
    expect(TOOL_CALL_RULES).toContain('<parameter name=')
    expect(TOOL_CALL_RULES).toContain('禁止编造工具名')
  })
})