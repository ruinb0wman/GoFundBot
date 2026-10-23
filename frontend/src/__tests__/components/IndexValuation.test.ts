import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getIndexValuation: vi.fn() }))

vi.mock('../../services/api', () => ({
  marketAPI: { getIndexValuation: mocks.getIndexValuation },
}))

const { default: IndexValuation } = await import('../../components/IndexValuation.vue')

/** 与 service 的 `GET /api/market/index/:code/valuation` 同形（黄金数字来自 2026-10-22 实测）。 */
const availablePayload = {
  code: 'sh000300',
  source_code: 'SH000300',
  name: null,
  as_of: '2026-10-22',
  data_status: 'available',
  pe: 12.7291,
  percentile: 0.4961,
  bands: { opportunity: 11.7383, median: 12.737, danger: 14.1813 },
  source: 'danjuan',
  definition: '加权滚动PE(TTM) · 20/50/80 分位',
  window: { start: '2016-10-24', end: '2026-10-22', points: 516, freq: 'weekly' },
}

const ok = (data: unknown) => ({ data: { success: true, data } })

describe('IndexValuation', () => {
  beforeEach(() => {
    mocks.getIndexValuation.mockReset()
  })

  it('renders PE, percentile and the three band values', async () => {
    mocks.getIndexValuation.mockResolvedValue(ok(availablePayload))

    const wrapper = mount(IndexValuation, { props: { indexCode: 'sh000300' } })
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('12.73') // 当前 PE
    expect(text).toContain('49.6%') // 分位
    expect(text).toContain('11.74') // 机会值
    expect(text).toContain('12.74') // 中位值
    expect(text).toContain('14.18') // 危险值
    // 口径必须写在卡片上，否则用户无法判断这个数字是谁算的。
    expect(text).toContain('蛋卷')
    expect(text).toContain('加权滚动PE(TTM)')
    expect(text).toContain('2016-10-24~2026-10-22（516 点周频）')
    expect(wrapper.find('.percentile-bar').exists()).toBe(true)
    expect(mocks.getIndexValuation).toHaveBeenCalledWith('sh000300')
  })

  it('shows 暂无 instead of zeros when the index is not covered', async () => {
    mocks.getIndexValuation.mockResolvedValue(ok({
      ...availablePayload,
      data_status: 'unavailable',
      pe: null,
      percentile: null,
      bands: { opportunity: null, median: null, danger: null },
      window: null,
      error: '数据源未收录该指数',
    }))

    const wrapper = mount(IndexValuation, { props: { indexCode: 'sh000001' } })
    await flushPromises()

    expect(wrapper.text()).toContain('暂无估值数据（数据源未收录该指数）')
    expect(wrapper.find('.percentile-bar').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('0.00')
  })

  it('shows a load failure message when the request throws', async () => {
    mocks.getIndexValuation.mockRejectedValue(new Error('network down'))

    const wrapper = mount(IndexValuation, { props: { indexCode: 'sh000300' } })
    await flushPromises()

    expect(wrapper.text()).toContain('暂无估值数据（取数失败，请稍后重试）')
  })

  it('refetches when the index code changes', async () => {
    mocks.getIndexValuation.mockResolvedValue(ok(availablePayload))

    const wrapper = mount(IndexValuation, { props: { indexCode: 'sh000300' } })
    await flushPromises()
    await wrapper.setProps({ indexCode: 'sz399006' })
    await flushPromises()

    expect(mocks.getIndexValuation).toHaveBeenLastCalledWith('sz399006')
  })
})
