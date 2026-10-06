import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import CodeApprovalCard from '../../components/CodeApprovalCard.vue'
import { toolApproval } from '../../services/chatEngine/toolApproval'

const mountOpts = {
  global: {
    // The shared UI icon wrapper does not mount in jsdom; the test only cares about text.
    stubs: { LucideIcon: { props: ['name'], template: '<i :data-icon="name" />' } },
  },
}

beforeEach(() => {
  toolApproval.pending.value = null
})

describe('CodeApprovalCard', () => {
  it('lists the assets for a portfolio code run', () => {
    toolApproval.pending.value = {
      toolCallId: '1',
      name: 'run_strategy_code',
      params: {
        assets: [
          { fund_code: '510300', weight: 25 },
          { fund_code: '518880', weight: 25 },
          { annual_rate: 0.02, weight: 25 },
        ],
        code: 'return {}',
      },
    }
    const wrapper = mount(CodeApprovalCard, mountOpts)
    expect(wrapper.text()).toContain('510300 25%')
    expect(wrapper.text()).toContain('现金 25%')
    expect(wrapper.text()).toContain('这些资产')
  })

  it('falls back to fund_code and the single-fund note', () => {
    toolApproval.pending.value = {
      toolCallId: '2',
      name: 'run_strategy_code',
      params: { fund_code: '110022', code: 'return {}' },
    }
    const wrapper = mount(CodeApprovalCard, mountOpts)
    expect(wrapper.text()).toContain('110022')
    expect(wrapper.text()).toContain('该基金')
  })

  it('renders nothing when no approval is pending', () => {
    expect(mount(CodeApprovalCard, mountOpts).find('.code-approval').exists()).toBe(false)
  })
})
