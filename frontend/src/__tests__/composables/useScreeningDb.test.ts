import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  compute: vi.fn(),
  query: vi.fn(),
  getStatus: vi.fn(),
  ranks: vi.fn(),
}))

vi.mock('../../services/api', () => ({
  screeningAPI: {
    sync: mocks.sync,
    compute: mocks.compute,
    query: mocks.query,
    getStatus: mocks.getStatus,
    ranks: mocks.ranks,
  },
}))

const { useScreeningDb } = await import('../../composables/useScreeningDb')

const envelope = (data: unknown) => ({ data: { success: true, data } })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useScreeningDb', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('unwraps the envelope and forwards the panel parameters', async () => {
    mocks.query.mockResolvedValue(
      envelope({ funds: [{ fund_code: '110022' }], total: 1, page: 2, page_size: 50 }),
    )
    const db = useScreeningDb()

    const result = await db.queryFunds({ fund_types: ['混合型'] }, 'sharpe_ratio_1y', 'asc', 2, 50)

    expect(mocks.query).toHaveBeenCalledWith({
      filters: { fund_types: ['混合型'] },
      sort_by: 'sharpe_ratio_1y',
      sort_order: 'asc',
      page: 2,
      page_size: 50,
    })
    expect(result).toMatchObject({ total: 1, page: 2, page_size: 50 })
    expect(result.funds[0].fund_code).toBe('110022')
  })

  it('falls back to empty results when the envelope is malformed', async () => {
    mocks.query.mockResolvedValue({ data: {} })
    const result = await useScreeningDb().queryFunds({})
    expect(result).toMatchObject({ funds: [], total: 0, page: 1, page_size: 20 })
  })

  it('returns from /sync before the background enrichment finishes', async () => {
    mocks.sync.mockResolvedValue(
      envelope({ total: 3309, risk_metrics_pending: 2, sync_time: '2026-10-08T00:00:00Z', computed: true }),
    )
    let release: ((value: unknown) => void) | null = null
    mocks.compute.mockImplementation(
      () => new Promise((resolve) => { release = resolve as (value: unknown) => void }),
    )

    const db = useScreeningDb()
    const total = await db.syncFromServer(undefined, true)

    expect(total).toBe(3309)
    expect(mocks.compute).toHaveBeenCalledWith({ limit: 300 })
    expect(db.syncing.value).toBe(true) // 列表已可用，指标还在后台补

    release!(envelope({ risk_metrics_pending: 0 }))
    await flush()
    expect(db.syncing.value).toBe(false)
  })

  it('stops the enrichment loop when a batch makes no progress', async () => {
    mocks.sync.mockResolvedValue(envelope({ total: 10, risk_metrics_pending: 5 }))
    mocks.compute.mockResolvedValue(envelope({ risk_metrics_pending: 5 })) // 取不到净值 → 不再减少

    const db = useScreeningDb()
    await db.syncFromServer(undefined, true)
    await flush()

    expect(mocks.compute).toHaveBeenCalledTimes(1)
    expect(db.syncing.value).toBe(false)
  })

  it('unwraps status and reports the local syncing flag', async () => {
    mocks.getStatus.mockResolvedValue(
      envelope({ basic_count: 3309, complete_count: 2704, risk_metrics_count: 2704, pass_4433_count: 182, type_counts: {} }),
    )
    const status = await useScreeningDb().getStatus()
    expect(status).toMatchObject({ basic_count: 3309, complete_count: 2704, syncing: false })
  })
})
