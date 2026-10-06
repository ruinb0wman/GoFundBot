import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import CodeApprovalCard from '../../components/CodeApprovalCard.vue'
import { toolApproval } from '../../services/chatEngine/toolApproval'

vi.mock('../../db/strategyScripts', () => ({
  findStrategyScriptsByName: vi.fn().mockResolvedValue([]),
}))

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
  it('shows the inline code for a custom-strategy run', () => {
    toolApproval.pending.value = {
      toolCallId: '1',
      name: 'run_strategy_code',
      params: { code: 'function onDay(s) { return {} }' },
    }
    const wrapper = mount(CodeApprovalCard, mountOpts)
    expect(wrapper.text()).toContain('自定义策略')
    expect(wrapper.text()).toContain('function onDay')
  })

  it('labels a saved-scheme run by name', () => {
    toolApproval.pending.value = {
      toolCallId: '2',
      name: 'run_strategy_code',
      params: { script_name: '均线加仓' },
    }
    const wrapper = mount(CodeApprovalCard, mountOpts)
    expect(wrapper.text()).toContain('已保存方案：均线加仓')
  })

  it('renders nothing when no approval is pending', () => {
    expect(mount(CodeApprovalCard, mountOpts).find('.code-approval').exists()).toBe(false)
  })
})
