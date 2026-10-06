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

/** The 31 chat tools known to the system (kept in sync with skills.ts toolNames). */
const EXPECTED_TOOLS = [
  'search_funds', 'get_fund_detail', 'get_fund_estimate', 'get_fund_nav_history',
  'get_market_indices', 'get_market_news', 'get_hot_sectors', 'get_concept_sectors',
  'get_north_flow', 'get_market_breadth', 'get_main_flow', 'get_flash_news',
  'get_watchlist', 'screen_funds_by_4433', 'run_backtest', 'suggest_strategy',
  'compare_backtest_strategies', 'run_strategy_code', 'run_portfolio_backtest', 'get_portfolio_holdings',
  'list_strategy_scripts', 'save_strategy_script',
  'get_stock_quote', 'get_market_anomaly', 'get_gold_realtime', 'get_fund_holdings',
  'get_fund_managers', 'get_funds_by_industry', 'get_industry_performance',
  'search_news', 'get_index_kline',
]

describe('tool registry', () => {
  it('contains exactly the expected 31 tools with full metadata', () => {
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
    // Dates became optional: the handler defaults to the last three years (same
    // window the 定投回测 page opens with), so the model need not invent dates.
    expect(backtest.parameters.required).toEqual(['fund_code'])
    for (const req of backtest.parameters.required as string[]) {
      expect((backtest.parameters.properties as Record<string, unknown>)[req]).toBeTruthy()
    }
    for (const spec of [getToolSpec('run_backtest')!, getToolSpec('compare_backtest_strategies')!]) {
      const props = Object.keys(spec.parameters.properties ?? {})
      for (const name of ['fee_rate', 'take_profit_rate', 'stop_loss_rate', 'amount']) {
        expect(props, `${spec.name}.${name}`).toContain(name)
      }
    }
  })

  it('declares the portfolio assets array and validates its items', () => {
    const tool = getToolSpec('run_portfolio_backtest')!
    expect(tool.parameters.required).toEqual(['assets'])
    expect(
      validateToolCall('run_portfolio_backtest', {
        assets: [{ fund_code: '110022', weight: 25 }, { fund_code: '000217', weight: 75 }],
      }).ok,
    ).toBe(true)
    expect(validateToolCall('run_portfolio_backtest', { assets: [{ fund_code: '110022' }] }).ok).toBe(false)
  })

  it('gates run_strategy_code behind a bounded code parameter', () => {
    const tool = getToolSpec('run_strategy_code')!
    // code is optional: `script_name` can name a saved scheme instead.
    expect(tool.parameters.required ?? []).toEqual([])
    const code = (tool.parameters.properties as Record<string, { maxLength?: number; description?: string }>).code
    expect(code.maxLength).toBe(8000)
    expect(code.description).toContain('onDay')
    // maxLength is actually enforced at the validation boundary
    expect(validateToolCall('run_strategy_code', { code: 'x'.repeat(8001) }).ok).toBe(false)
    // code and script_name are alternative modes; the handler requires one
    expect(validateToolCall('run_strategy_code', { code: 'function onDay(){ return {} }' }).ok).toBe(true)
    expect(validateToolCall('run_strategy_code', { script_name: '均线加仓' }).ok).toBe(true)
  })

  it('exposes saved-scheme list/save tools', () => {
    expect(getToolSpec('list_strategy_scripts')!.parameters.required ?? []).toEqual([])
    const save = getToolSpec('save_strategy_script')!
    expect(save.parameters.required).toEqual(['name', 'code'])
    expect(validateToolCall('save_strategy_script', { name: 'x', code: 'return {}', fund_code: '110022' }).ok).toBe(true)
    expect(validateToolCall('save_strategy_script', { code: 'return {}' }).ok).toBe(false)
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

  it('describes array item fields so XML-only models can see them', () => {
    const xml = toolSpecsToXml([getToolSpec('run_portfolio_backtest')!])
    expect(xml).toContain('type="array&lt;{fund_code:string, weight:number, annual_rate:number, name:string}&gt;"')
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
