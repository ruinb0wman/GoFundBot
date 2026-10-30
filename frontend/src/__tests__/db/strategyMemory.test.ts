import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsUpdate: vi.fn(),
  listStrategiesApi: vi.fn(),
  addStrategyApi: vi.fn(),
  updateStrategyApi: vi.fn(),
  removeStrategyApi: vi.fn(),
}))

vi.mock('../../services/api', () => ({
  settingsAPI: { get: mocks.settingsGet, update: mocks.settingsUpdate },
}))

vi.mock('../../services/userDataApi', () => ({
  listStrategiesApi: mocks.listStrategiesApi,
  addStrategyApi: mocks.addStrategyApi,
  updateStrategyApi: mocks.updateStrategyApi,
  removeStrategyApi: mocks.removeStrategyApi,
}))

const memory = await import('../../db/strategyMemory')

describe('strategyMemory 文件夹配置', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the folder from /settings', async () => {
    mocks.settingsGet.mockResolvedValue({ data: { success: true, data: { strategy: { dir: '/notes/strategies' } } } })
    expect(await memory.fetchStrategyDir()).toBe('/notes/strategies')
  })

  it('defaults to an empty folder when settings has none', async () => {
    mocks.settingsGet.mockResolvedValue({ data: { success: true, data: {} } })
    expect(await memory.fetchStrategyDir()).toBe('')
  })

  it('saves the folder through /settings', async () => {
    mocks.settingsUpdate.mockResolvedValue({ data: { success: true, data: { strategy: { dir: '/notes/s' } } } })
    expect(await memory.saveStrategyDir('/notes/s')).toBe('/notes/s')
    expect(mocks.settingsUpdate).toHaveBeenCalledWith({ strategy: { dir: '/notes/s' } })
  })
})
