import { describe, it, expect, vi, beforeEach } from 'vitest'

const { codeMock, savedMock } = vi.hoisted(() => ({ codeMock: vi.fn(), savedMock: vi.fn() }))

vi.mock('../../services/backtest/scriptRun', () => ({
  runCodeSampled: codeMock,
  runSavedScriptSampled: savedMock,
}))

import { executeTool } from '../../services/chatEngine/toolHandlers'

beforeEach(() => {
  codeMock.mockReset().mockResolvedValue({ summary: { total_invested: 1 }, spec: 'code' })
  savedMock.mockReset().mockResolvedValue({ summary: { total_invested: 2 }, spec: 'saved' })
})

describe('run_strategy_code handler (inline code)', () => {
  it('runs inline code and forwards the optional overrides', async () => {
    const result = (await executeTool(
      'run_strategy_code',
      { code: 'function onDay() { return {} }', start_date: '2020-01-01', initial_amount: 5000 },
      {},
    )) as Record<string, unknown>

    expect(codeMock).toHaveBeenCalledTimes(1)
    const [code, overrides] = codeMock.mock.calls[0]
    expect(code).toBe('function onDay() { return {} }')
    expect(overrides).toMatchObject({ start_date: '2020-01-01', initial_amount: 5000 })
    expect((result.summary as Record<string, unknown>).total_invested).toBe(1)
  })

  it('rejects a call with neither code nor script_name', async () => {
    const result = (await executeTool('run_strategy_code', {}, {})) as Record<string, unknown>
    expect(String(result.error)).toContain('code')
    expect(codeMock).not.toHaveBeenCalled()
    expect(savedMock).not.toHaveBeenCalled()
  })
})
