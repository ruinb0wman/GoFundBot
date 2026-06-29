import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mockGetWatchlist = vi.fn()
const mockRefreshEstimates = vi.fn()

vi.mock('../../services/api', () => ({
  watchlistAPI: {
    getWatchlist: (...args: unknown[]) => mockGetWatchlist(...args),
    refreshEstimates: (...args: unknown[]) => mockRefreshEstimates(...args),
  },
  fundAPI: {},
  marketAPI: {},
}))

describe('watchlistStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockGetWatchlist.mockReset()
    mockRefreshEstimates.mockReset()
  })

  it('fetches watchlist and updates state', async () => {
    mockGetWatchlist.mockResolvedValue({
      data: { data: [{ fund_code: '000001', fund_name: 'Test Fund' }], groups: [{ id: 1, name: 'Group' }] },
    })
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    expect(store.funds).toHaveLength(1)
    expect(store.funds[0].fund_code).toBe('000001')
    expect(store.groups).toHaveLength(1)
    expect(store.loading).toBe(false)
  })

  it('respects throttle: skips fetch if within 30s', async () => {
    mockGetWatchlist.mockResolvedValue({ data: { data: [] } })
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    const callCount = mockGetWatchlist.mock.calls.length
    // Second fetch within 30s should be skipped
    await store.fetch()
    expect(mockGetWatchlist).toHaveBeenCalledTimes(callCount)
  })

  it('force fetch ignores throttle', async () => {
    mockGetWatchlist.mockResolvedValue({ data: { data: [] } })
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    await store.fetch(true)
    expect(mockGetWatchlist).toHaveBeenCalledTimes(2)
  })

  it('totalCount getter returns correct count', async () => {
    mockGetWatchlist.mockResolvedValue({
      data: { data: [{ fund_code: '000001' }, { fund_code: '000002' }] },
    })
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    expect(store.totalCount).toBe(2)
  })

  it('fundMap getter creates lookup by fund_code', async () => {
    mockGetWatchlist.mockResolvedValue({
      data: { data: [{ fund_code: '000001', fund_name: 'A' }, { fund_code: '000002', fund_name: 'B' }] },
    })
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    expect(store.fundMap['000001'].fund_name).toBe('A')
    expect(store.fundMap['000002'].fund_name).toBe('B')
  })

  it('clear resets state', async () => {
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    store.funds = [{ fund_code: '000001' }]
    store.groups = [{ id: 1, name: '' }]
    store.lastFetch = Date.now()
    store.clear()
    expect(store.funds).toHaveLength(0)
    expect(store.groups).toHaveLength(0)
    expect(store.lastFetch).toBe(0)
  })

  it('refreshEstimates calls API then re-fetches', async () => {
    mockRefreshEstimates.mockResolvedValue({})
    mockGetWatchlist.mockResolvedValue({ data: { data: [], groups: [] } })
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.refreshEstimates()
    expect(mockRefreshEstimates).toHaveBeenCalledTimes(1)
    expect(mockGetWatchlist).toHaveBeenCalled()
  })
})
