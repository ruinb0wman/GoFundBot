import { describe, expect, it } from 'vitest'
import { compileStrategyModule, filterScreenRows, handlePlanRequest, MAX_POOL, type ScreenRow } from '../../services/backtest/strategySandbox'

const ROWS: ScreenRow[] = [
  { code: '110022', name: '易方达消费行业', type: '股票型', return_1y: 12, sharpe_ratio_1y: 1.4, max_drawdown_1y: -15, nav_date: '2026-10-03' },
  { code: '510300', name: '沪深300ETF', type: '指数型', return_1y: 8, sharpe_ratio_1y: 0.9, max_drawdown_1y: -18, nav_date: '2026-10-03' },
  { code: '000217', name: '华安黄金ETF联接', type: '商品型', return_1y: 20, sharpe_ratio_1y: 1.8, max_drawdown_1y: -11, nav_date: '2026-10-03' },
]

const DEFAULTS = { start: '2023-10-06', end: '2026-10-06' }

describe('compileStrategyModule', () => {
  it('extracts prepare/onDay from a module (function or arrow)', () => {
    const mod = compileStrategyModule('function prepare(){return {}} function onDay(){return {}}')
    expect(typeof mod.prepare).toBe('function')
    expect(typeof mod.onDay).toBe('function')
    const arrow = compileStrategyModule('const prepare = () => ({}); const onDay = () => ({})')
    expect(typeof arrow.prepare).toBe('function')
    expect(typeof arrow.onDay).toBe('function')
  })

  it('requires onDay and rejects empty code', () => {
    expect(() => compileStrategyModule('function prepare(){return {}}')).toThrow(/onDay/)
    expect(() => compileStrategyModule('   ')).toThrow(/为空/)
  })
})

describe('filterScreenRows', () => {
  it('filters by equality and substring', () => {
    expect(filterScreenRows(ROWS, { type: '指数型' }).map((r) => r.code)).toEqual(['510300'])
    expect(filterScreenRows(ROWS)).toHaveLength(3)
    expect(filterScreenRows(ROWS, { name: '黄金' }).map((r) => r.code)).toEqual(['000217'])
  })
})

describe('handlePlanRequest', () => {
  it('normalizes a plan and fills default dates', () => {
    const res = handlePlanRequest({
      code: "function prepare(sdk){ return { assets: ['110022', 'CASH:0.02'], initialAmount: 1000, feeRate: 0.001 } } function onDay(){ return {} }",
      defaults: DEFAULTS,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.plan.assets).toEqual(['110022', 'CASH:0.02'])
      expect(res.plan.start).toBe(DEFAULTS.start)
      expect(res.plan.end).toBe(DEFAULTS.end)
      expect(res.plan.initialAmount).toBe(1000)
      expect(res.plan.feeRate).toBe(0.001)
    }
  })

  it('lets prepare() use the local fund database', () => {
    const code = [
      'function prepare(sdk) {',
      "  const pool = sdk.screen({ type: '指数型' }).slice(0, 1).map((r) => r.code);",
      '  return { assets: pool };',
      '}',
      'function onDay() { return {} }',
    ].join('\n')
    const res = handlePlanRequest({ code, screenRows: ROWS, defaults: DEFAULTS })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.plan.assets).toEqual(['510300'])
  })

  it('rejects bad plans: empty assets, too many legs, multiple cash legs, reversed dates', () => {
    const wrap = (body: string) => `function prepare(){ return ${body} } function onDay(){ return {} }`
    expect(handlePlanRequest({ code: wrap('{ assets: [] }') }).ok).toBe(false)
    expect(handlePlanRequest({ code: wrap(`{ assets: ${JSON.stringify(Array.from({ length: MAX_POOL + 1 }, (_, i) => String(i).padStart(6, '0')))} }`) }).ok).toBe(false)
    expect(handlePlanRequest({ code: wrap("{ assets: ['CASH', 'CASH:0.02'] }") }).ok).toBe(false)
    expect(handlePlanRequest({ code: wrap("{ assets: ['110022'], start: '2026-01-01', end: '2020-01-01' }") }).ok).toBe(false)
  })

  it('surfaces prepare() runtime errors and missing prepare', () => {
    const throwing = handlePlanRequest({ code: 'function prepare(){ throw new Error("nope") } function onDay(){ return {} }' })
    expect(throwing.ok).toBe(false)
    if (!throwing.ok) expect(throwing.error).toContain('nope')
    const noPrepare = handlePlanRequest({ code: 'function onDay(){ return {} }' })
    expect(noPrepare.ok).toBe(false)
    if (!noPrepare.ok) expect(noPrepare.error).toContain('prepare')
  })
})
