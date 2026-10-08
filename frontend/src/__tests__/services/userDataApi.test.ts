import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../../services/api', () => ({
  default: mocks,
  api: mocks,
}))

const userDataApi = await import('../../services/userDataApi')

describe('userDataApi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('unwraps the items envelope', async () => {
    mocks.get.mockResolvedValue({ data: { success: true, data: { items: [{ id: 1, title: '核心卫星' }] } } })
    const items = await userDataApi.listStrategiesApi()
    expect(mocks.get).toHaveBeenCalledWith('/strategies')
    expect(items).toEqual([{ id: 1, title: '核心卫星' }])
  })

  it('throws the server error message on a failed envelope', async () => {
    mocks.get.mockResolvedValue({ data: { success: false, error: { message: '数据库忙' } } })
    await expect(userDataApi.listStrategiesApi()).rejects.toThrow('数据库忙')
  })

  it('maps the create-script payload (source defaults to manual)', async () => {
    mocks.post.mockResolvedValue({ data: { success: true, data: { id: 7, name: 's', code: 'c' } } })
    const created = await userDataApi.createScriptApi({ name: 's', code: 'c' })
    expect(mocks.post).toHaveBeenCalledWith('/backtest-scripts', { name: 's', code: 'c', source: 'manual' })
    expect(created.id).toBe(7)
  })

  it('returns null for a missing script instead of throwing', async () => {
    mocks.get.mockResolvedValue({ data: { success: false, error: { message: 'not found' } } })
    expect(await userDataApi.getScriptApi(99)).toBeNull()
  })
})
