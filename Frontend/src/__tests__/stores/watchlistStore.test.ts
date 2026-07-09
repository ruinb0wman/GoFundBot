import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { WatchlistItem, WatchlistGroup } from '../../db'

const mockToArray = vi.fn()
const mockGet = vi.fn()
const mockPut = vi.fn()
const mockDelete = vi.fn()
const mockBulkDelete = vi.fn()
const mockAdd = vi.fn()
const mockUpdate = vi.fn()
const mockWhere = vi.fn()
const mockClear = vi.fn()

vi.mock('../../db', () => ({
  db: {
    watchlist: {
      toArray: (...args: unknown[]) => mockToArray(...args),
      get: (...args: unknown[]) => mockGet(...args),
      put: (...args: unknown[]) => mockPut(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
      bulkDelete: (...args: unknown[]) => mockBulkDelete(...args),
      where: (...args: unknown[]) => ({ toArray: (...a: unknown[]) => mockWhere(...args, ...a) }),
      clear: (...args: unknown[]) => mockClear(...args),
    },
    watchlistGroups: {
      toArray: (...args: unknown[]) => mockToArray(...args),
      add: (...args: unknown[]) => mockAdd(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
      clear: (...args: unknown[]) => mockClear(...args),
    },
  },
}))

const mockGetEstimates = vi.fn()
const mockRefreshEstimates = vi.fn()

vi.mock('../../services/api', () => ({
  watchlistAPI: {
    refreshEstimates: (...args: unknown[]) => mockRefreshEstimates(...args),
  },
  fundAPI: {
    getEstimates: (...args: unknown[]) => mockGetEstimates(...args),
  },
  marketAPI: {},
}))

function toWatchlistItem(f: Record<string, unknown>): WatchlistItem {
  return {
    fundCode: f.fund_code as string,
    fundName: (f.fund_name as string) ?? '',
    fundType: (f.fund_type as string | null) ?? null,
    groupId: (f.group_id as number | null) ?? null,
    sortOrder: (f.sort_order as number) ?? 0,
    addedAt: Date.now(),
  }
}

describe('watchlistStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockToArray.mockReset()
    mockGet.mockReset()
    mockPut.mockReset()
    mockDelete.mockReset()
    mockBulkDelete.mockReset()
    mockAdd.mockReset()
    mockUpdate.mockReset()
    mockWhere.mockReset()
    mockClear.mockReset()
    mockGetEstimates.mockReset()
    mockRefreshEstimates.mockReset()
  })

  it('fetches watchlist from Dexie and updates state', async () => {
    mockToArray
      .mockResolvedValueOnce([toWatchlistItem({ fund_code: '000001', fund_name: 'Test Fund' })])
      .mockResolvedValueOnce([{ id: 1, name: 'Group', sortOrder: 0 }])
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    expect(store.funds).toHaveLength(1)
    expect(store.funds[0].fund_code).toBe('000001')
    expect(store.groups).toHaveLength(1)
    expect(store.loading).toBe(false)
  })

  it('respects throttle: skips fetch if within 30s', async () => {
    mockToArray.mockResolvedValue([])
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    const callCount = mockToArray.mock.calls.length
    await store.fetch()
    expect(mockToArray).toHaveBeenCalledTimes(callCount)
  })

  it('force fetch ignores throttle', async () => {
    mockToArray.mockResolvedValue([])
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    await store.fetch(true)
    expect(mockToArray).toHaveBeenCalledTimes(4)
  })

  it('totalCount getter returns correct count', async () => {
    mockToArray
      .mockResolvedValueOnce([
        toWatchlistItem({ fund_code: '000001' }),
        toWatchlistItem({ fund_code: '000002' }),
      ])
      .mockResolvedValueOnce([])
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    expect(store.totalCount).toBe(2)
  })

  it('fundMap getter creates lookup by fund_code', async () => {
    mockToArray
      .mockResolvedValueOnce([
        toWatchlistItem({ fund_code: '000001', fund_name: 'A' }),
        toWatchlistItem({ fund_code: '000002', fund_name: 'B' }),
      ])
      .mockResolvedValueOnce([])
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

  it('addFund writes to Dexie and updates state', async () => {
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.addFund('000001', 'Test Fund', '股票型', null)
    expect(mockPut).toHaveBeenCalledTimes(1)
    expect(store.funds).toHaveLength(1)
    expect(store.funds[0].fund_code).toBe('000001')
  })

  it('removeFund deletes from Dexie and updates state', async () => {
    mockDelete.mockResolvedValue(undefined)
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    store.funds = [{ fund_code: '000001', fund_name: 'Test' }]
    await store.removeFund('000001')
    expect(mockDelete).toHaveBeenCalledWith('000001')
    expect(store.funds).toHaveLength(0)
  })

  it('batchDelete removes multiple funds', async () => {
    mockBulkDelete.mockResolvedValue(undefined)
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    store.funds = [
      { fund_code: '000001' },
      { fund_code: '000002' },
      { fund_code: '000003' },
    ]
    await store.batchDelete(['000001', '000003'])
    expect(mockBulkDelete).toHaveBeenCalledWith(['000001', '000003'])
    expect(store.funds).toHaveLength(1)
    expect(store.funds[0].fund_code).toBe('000002')
  })

  it('checkInWatchlist returns true for watched fund', async () => {
    mockGet.mockResolvedValue({ fundCode: '000001' })
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    const result = await store.checkInWatchlist('000001')
    expect(result).toBe(true)
    expect(mockGet).toHaveBeenCalledWith('000001')
  })

  it('checkInWatchlist returns false for unwatched fund', async () => {
    mockGet.mockResolvedValue(undefined)
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    const result = await store.checkInWatchlist('000001')
    expect(result).toBe(false)
  })

  it('createGroup adds to Dexie and refreshes', async () => {
    mockAdd.mockResolvedValue(1)
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    const result = await store.createGroup('My Group')
    expect(mockAdd).toHaveBeenCalled()
    expect(result.id).toBe(1)
  })

  it('refreshEstimates fetches estimates and merges into funds', async () => {
    mockGetEstimates.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            {
              code: '000001',
              success: true,
              data: {
                code: '000001',
                name: 'Test Fund',
                navDate: '2024-01-15',
                nav: 1.2345,
                estimatedNav: 1.2400,
                estimatedChangePercent: 0.45,
                estimateTime: '2024-01-15 14:30',
              },
            },
          ],
          failed: [],
          summary: { total: 1, success: 1, failed: 0 },
        },
      },
    })
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    store.funds = [{ fund_code: '000001', fund_name: 'Test Fund' }]
    await store.refreshEstimates()
    expect(mockGetEstimates).toHaveBeenCalledWith(['000001'])
    expect(store.funds[0].net_worth).toBe(1.2345)
    expect(store.funds[0].net_worth_date).toBe('2024-01-15')
    expect(store.funds[0].estimate_value).toBe(1.2400)
    expect(store.funds[0].estimate_change).toBe(0.45)
    expect(store.funds[0].estimate_time).toBe('2024-01-15 14:30')
  })
})
