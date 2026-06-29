import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mockGetFundDetail = vi.fn()

vi.mock('../../services/api', () => ({
  fundAPI: {
    getFundDetail: (...args: unknown[]) => mockGetFundDetail(...args),
  },
  marketAPI: {},
  watchlistAPI: {},
}))

describe('fundStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockGetFundDetail.mockReset()
  })

  it('fetches fund detail and caches it', async () => {
    mockGetFundDetail.mockResolvedValue({ data: { fund_code: '000001', fund_name: 'Test' } })
    const { useFundStore } = await import('../../stores/fundStore')
    const store = useFundStore()
    const result = await store.fetchFund('000001')
    expect(result.fund_code).toBe('000001')
    expect(mockGetFundDetail).toHaveBeenCalledTimes(1)
  })

  it('returns cached data without API call within 60s', async () => {
    mockGetFundDetail.mockResolvedValue({ data: { fund_code: '000001' } })
    const { useFundStore } = await import('../../stores/fundStore')
    const store = useFundStore()
    await store.fetchFund('000001')
    // Simulate cache hit with a recent timestamp
    store.cache['000001'] = { data: { fund_code: '000001', cached: true }, ts: Date.now() }
    const result = await store.fetchFund('000001')
    expect(result.cached).toBe(true)
    expect(mockGetFundDetail).toHaveBeenCalledTimes(1)
  })

  it('forced fetch ignores cache', async () => {
    mockGetFundDetail.mockResolvedValue({ data: { fund_code: '000001' } })
    const { useFundStore } = await import('../../stores/fundStore')
    const store = useFundStore()
    await store.fetchFund('000001', true)
    store.cache['000001'] = { data: { fund_code: '000001', cached: true }, ts: Date.now() }
    mockGetFundDetail.mockResolvedValue({ data: { fund_code: '000001', forced: true } })
    const result = await store.fetchFund('000001', true)
    expect(result.forced).toBe(true)
    expect(mockGetFundDetail).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent requests', async () => {
    let resolvePromise: ((value: { data: { fund_code: string } }) => void) | undefined
    mockGetFundDetail.mockReturnValue(new Promise<{ data: { fund_code: string } }>(resolve => { resolvePromise = resolve }))
    const { useFundStore } = await import('../../stores/fundStore')
    const store = useFundStore()
    const p1 = store.fetchFund('000001')
    const p2 = store.fetchFund('000001')
    resolvePromise!({ data: { fund_code: '000001' } })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.fund_code).toBe('000001')
    expect(r2.fund_code).toBe('000001')
    expect(mockGetFundDetail).toHaveBeenCalledTimes(1)
  })

  it('handles API errors gracefully', async () => {
    mockGetFundDetail.mockRejectedValue(new Error('API error'))
    const { useFundStore } = await import('../../stores/fundStore')
    const store = useFundStore()
    await expect(store.fetchFund('000001')).rejects.toThrow('API error')
  })

  it('clearCache empties the cache', async () => {
    const { useFundStore } = await import('../../stores/fundStore')
    const store = useFundStore()
    store.cache['000001'] = { data: {}, ts: Date.now() }
    store.clearCache()
    expect(Object.keys(store.cache)).toHaveLength(0)
  })
})
