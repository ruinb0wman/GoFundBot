import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mockGetOverview = vi.fn()
const mockGetFlashNews = vi.fn()
const mockGetSectorRank = vi.fn()

vi.mock('../../services/api', () => ({
  marketAPI: {
    getOverview: (...args: unknown[]) => mockGetOverview(...args),
    getFlashNews: (...args: unknown[]) => mockGetFlashNews(...args),
    getSectorRank: (...args: unknown[]) => mockGetSectorRank(...args),
  },
  fundAPI: {},
  watchlistAPI: {},
}))

describe('marketStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockGetOverview.mockReset()
    mockGetFlashNews.mockReset()
    mockGetSectorRank.mockReset()
  })

  it('fetches overview and updates state', async () => {
    mockGetOverview.mockResolvedValue({ data: { date: '2024-01-15', indices: [] } })
    const { useMarketStore } = await import('../../stores/marketStore')
    const store = useMarketStore()
    await store.fetchOverview()
    expect((store.overview as { date: string }).date).toBe('2024-01-15')
    expect(store.loading).toBe(false)
  })

  it('respects overview throttle: skips within 15s', async () => {
    mockGetOverview.mockResolvedValue({ data: { date: '2024-01-15' } })
    const { useMarketStore } = await import('../../stores/marketStore')
    const store = useMarketStore()
    await store.fetchOverview()
    const callCount = mockGetOverview.mock.calls.length
    await store.fetchOverview()
    expect(mockGetOverview).toHaveBeenCalledTimes(callCount)
  })

  it('force fetch ignores throttle for overview', async () => {
    mockGetOverview.mockResolvedValue({ data: { date: '2024-01-15' } })
    const { useMarketStore } = await import('../../stores/marketStore')
    const store = useMarketStore()
    await store.fetchOverview()
    await store.fetchOverview(true)
    expect(mockGetOverview).toHaveBeenCalledTimes(2)
  })

  it('fetches flash news with count and page params', async () => {
    mockGetFlashNews.mockResolvedValue({ data: { news: [{ title: 'News 1' }] } })
    const { useMarketStore } = await import('../../stores/marketStore')
    const store = useMarketStore()
    await store.fetchFlashNews(10, 1)
    expect(mockGetFlashNews).toHaveBeenCalledWith(10, 1)
    expect(store.flashNews).toHaveLength(1)
  })

  it('fetches sectors', async () => {
    mockGetSectorRank.mockResolvedValue({ data: [{ name: 'Tech' }] })
    const { useMarketStore } = await import('../../stores/marketStore')
    const store = useMarketStore()
    await store.fetchSectors(50)
    expect(mockGetSectorRank).toHaveBeenCalledWith(50)
    expect(store.sectors).toHaveLength(1)
  })

  it('handles empty flash news response', async () => {
    mockGetFlashNews.mockResolvedValue({ data: {} })
    const { useMarketStore } = await import('../../stores/marketStore')
    const store = useMarketStore()
    await store.fetchFlashNews()
    expect(store.flashNews).toEqual([])
  })
})
