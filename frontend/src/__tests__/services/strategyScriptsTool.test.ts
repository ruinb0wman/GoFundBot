import { describe, it, expect, vi, beforeEach } from 'vitest'

const { savedRunMock, findByNameMock, listMock, createMock } = vi.hoisted(() => ({
  savedRunMock: vi.fn(),
  findByNameMock: vi.fn(),
  listMock: vi.fn(),
  createMock: vi.fn(),
}))

vi.mock('../../services/backtest/scriptRun', () => ({
  runSavedScriptSampled: savedRunMock,
  runCodeSampled: vi.fn(),
}))

vi.mock('../../db/strategyScripts', () => ({
  findStrategyScriptsByName: findByNameMock,
  listStrategyScripts: listMock,
  createStrategyScript: createMock,
}))

import { executeTool } from '../../services/chatEngine/toolHandlers'

const CODE = "function prepare(){ return { assets: ['110022'] } }\nfunction onDay(){ return {} }"

function script(id: number, name: string) {
  return {
    id,
    name,
    code: CODE,
    source: 'ai' as const,
    createdAt: 0,
    updatedAt: 0,
  }
}

beforeEach(() => {
  savedRunMock.mockReset().mockResolvedValue({ summary: { total_invested: 1 }, spec: 'saved' })
  findByNameMock.mockReset().mockResolvedValue([])
  listMock.mockReset().mockResolvedValue([])
  createMock.mockReset().mockResolvedValue(7)
})

describe('saved-scheme tool handlers', () => {
  it('runs a saved scheme by name', async () => {
    findByNameMock.mockResolvedValue([script(1, '均线加仓')])
    const result = (await executeTool('run_strategy_code', { script_name: '均线加仓' }, {})) as Record<string, unknown>
    expect(savedRunMock).toHaveBeenCalledTimes(1)
    expect((result.summary as Record<string, unknown>).total_invested).toBe(1)
  })

  it('reports an unknown scheme name', async () => {
    findByNameMock.mockResolvedValue([])
    const result = (await executeTool('run_strategy_code', { script_name: '不存在' }, {})) as Record<string, unknown>
    expect(String(result.error)).toContain('未找到')
    expect(savedRunMock).not.toHaveBeenCalled()
  })

  it('asks the model to disambiguate duplicate names', async () => {
    findByNameMock.mockResolvedValue([script(1, 'x'), script(2, 'x')])
    const result = (await executeTool('run_strategy_code', { script_name: 'x' }, {})) as Record<string, unknown>
    expect(String(result.error)).toContain('同名')
    expect((result.candidates as unknown[]).length).toBe(2)
  })

  it('lists saved schemes compactly', async () => {
    listMock.mockResolvedValue([{ ...script(3, '四资产'), lastRunAt: 1000, lastSummary: { return_rate: 5, max_drawdown: -3 } }])
    const result = (await executeTool('list_strategy_scripts', {}, {})) as Record<string, unknown>
    expect(result.count).toBe(1)
    const rows = result.scripts as Array<Record<string, unknown>>
    expect(rows[0].name).toBe('四资产')
    expect(rows[0].last_summary).toMatchObject({ return_rate: 5 })
  })

  it('saves a scheme with source ai and validates required args', async () => {
    const ok = (await executeTool('save_strategy_script', { name: '新方案', code: CODE }, {})) as Record<string, unknown>
    expect(ok.ok).toBe(true)
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ name: '新方案', code: CODE, source: 'ai' }))

    const missingName = (await executeTool('save_strategy_script', { code: CODE }, {})) as Record<string, unknown>
    expect(String(missingName.error)).toContain('name')
    const missingCode = (await executeTool('save_strategy_script', { name: 'x' }, {})) as Record<string, unknown>
    expect(String(missingCode.error)).toContain('code')
  })
})
