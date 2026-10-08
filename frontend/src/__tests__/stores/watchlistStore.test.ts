import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  getWatchlistApi: vi.fn(),
  upsertWatchlistApi: vi.fn(),
  removeWatchlistApi: vi.fn(),
  reorderWatchlistApi: vi.fn(),
  assignWatchlistGroupApi: vi.fn(),
  createWatchlistGroupApi: vi.fn(),
  renameWatchlistGroupApi: vi.fn(),
  deleteWatchlistGroupApi: vi.fn(),
  reorderWatchlistGroupsApi: vi.fn(),
}))

vi.mock('../../services/userDataApi', () => mocks)

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

function item(fund_code: string, fund_name = 'Test Fund') {
  return { fundCode: fund_code, fundName: fund_name, fundType: null, groupId: null, sortOrder: 0, addedAt: 1 }
}

function snapshot(items: ReturnType<typeof item>[] = [], groups: unknown[] = []) {
  return { items, groups }
}

describe('watchlistStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.getWatchlistApi.mockResolvedValue(snapshot())
    mocks.removeWatchlistApi.mockResolvedValue(snapshot())
    mocks.createWatchlistGroupApi.mockResolvedValue({ id: 1, name: 'My Group', sortOrder: 0 })
    mockGetEstimates.mockReset()
    mockRefreshEstimates.mockReset()
  })

  it('fetches the watchlist from the service and updates state', async () => {
    mocks.getWatchlistApi.mockResolvedValue(
      snapshot([item('000001')], [{ id: 1, name: 'Group', sortOrder: 0 }])
    )
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    expect(store.funds).toHaveLength(1)
    expect(store.funds[0].fund_code).toBe('000001')
    expect(store.groups).toHaveLength(1)
    expect(store.loading).toBe(false)
  })

  it('respects the 30s throttle', async () => {
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    await store.fetch()
    expect(mocks.getWatchlistApi).toHaveBeenCalledTimes(1)
  })

  it('force fetch ignores the throttle', async () => {
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    await store.fetch(true)
    expect(mocks.getWatchlistApi).toHaveBeenCalledTimes(2)
  })

  it('totalCount and fundMap reflect the fetched items', async () => {
    mocks.getWatchlistApi.mockResolvedValue(snapshot([item('000001', 'A'), item('000002', 'B')]))
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    expect(store.totalCount).toBe(2)
    expect(store.fundMap['000001'].fund_name).toBe('A')
    expect(store.fundMap['000002'].fund_name).toBe('B')
  })

  it('keeps state when the service call fails', async () => {
    mocks.getWatchlistApi.mockRejectedValue(new Error('service down'))
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.fetch()
    expect(store.funds).toEqual([])
    expect(store.loading).toBe(false)
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

  it('addFund upserts through the API and updates state', async () => {
    mocks.upsertWatchlistApi.mockResolvedValue(item('000001'))
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.addFund('000001', 'Test Fund', '股票型', null)
    expect(mocks.upsertWatchlistApi).toHaveBeenCalledWith(
      expect.objectContaining({ fundCode: '000001', fundName: 'Test Fund', groupId: null })
    )
    expect(store.funds).toHaveLength(1)
  })

  it('removeFund deletes through the API and updates state', async () => {
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    store.funds = [{ fund_code: '000001', fund_name: 'Test' }]
    await store.removeFund('000001')
    expect(mocks.removeWatchlistApi).toHaveBeenCalledWith(['000001'])
    expect(store.funds).toHaveLength(0)
  })

  it('batchDelete removes multiple funds', async () => {
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    store.funds = [{ fund_code: '000001' }, { fund_code: '000002' }, { fund_code: '000003' }]
    await store.batchDelete(['000001', '000003'])
    expect(mocks.removeWatchlistApi).toHaveBeenCalledWith(['000001', '000003'])
    expect(store.funds.map((f) => f.fund_code)).toEqual(['000002'])
  })

  it('checkInWatchlist reflects the served list', async () => {
    mocks.getWatchlistApi.mockResolvedValue(snapshot([item('000001')]))
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    expect(await store.checkInWatchlist('000001')).toBe(true)
    expect(await store.checkInWatchlist('999999')).toBe(false)
  })

  it('createGroup posts and returns the new id', async () => {
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    const result = await store.createGroup('My Group')
    expect(mocks.createWatchlistGroupApi).toHaveBeenCalledWith('My Group')
    expect(result.id).toBe(1)
  })

  it('reorder assigns the group then reorders', async () => {
    const { useWatchlistStore } = await import('../../stores/watchlistStore')
    const store = useWatchlistStore()
    await store.reorder(['000002', '000001'], 3)
    expect(mocks.assignWatchlistGroupApi).toHaveBeenCalledWith(['000002', '000001'], 3)
    expect(mocks.reorderWatchlistApi).toHaveBeenCalledWith(['000002', '000001'])
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
                estimatedNav: 1.24,
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
    expect(store.funds[0].estimate_value).toBe(1.24)
    expect(store.funds[0].estimate_time).toBe('2024-01-15 14:30')
  })

  it('refreshEstimates 对货币基金透传 7 日年化 / 每万份收益', async () => {
    mockGetEstimates.mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            {
              code: '000682',
              success: true,
              data: {
                code: '000682',
                name: '信澳慧管家货币C',
                navDate: '2026-10-07',
                nav: 1,
                estimatedNav: null,
                estimatedChangePercent: null,
                estimateTime: null,
                isMoneyFund: true,
                sevenDayYield: 1.324,
                unitIncome: 0.3604,
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
    store.funds = [{ fund_code: '000682', fund_name: '信澳慧管家货币C' }]
    await store.refreshEstimates()

    expect(store.funds[0].is_money_fund).toBe(true)
    expect(store.funds[0].unit_income).toBe(0.3604)
    // 涨跌位列用 7 日年化占位（组件会改标签）
    expect(store.funds[0].estimate_change).toBe(1.324)
  })
})
