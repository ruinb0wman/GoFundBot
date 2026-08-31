import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BSwitch from '../BSwitch.vue'
import BCard from '../BCard.vue'
import SkeletonCard from '../SkeletonCard.vue'

describe('BSwitch', () => {
  it('renders with aria-checked state', async () => {
    const wrapper = mount(BSwitch, { props: { modelValue: true } })
    expect(wrapper.classes()).toContain('b-switch--checked')
    expect(wrapper.attributes('aria-checked')).toBe('true')
  })

  it('emits update:modelValue on click', async () => {
    const wrapper = mount(BSwitch)
    await wrapper.trigger('click')
    const events = wrapper.emitted('update:modelValue')!
    expect(events[events.length - 1]).toEqual([true])
  })

  it('does not toggle when disabled', async () => {
    const wrapper = mount(BSwitch, { props: { disabled: true } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('BCard', () => {
  it('renders header and default slot', () => {
    const wrapper = mount(BCard, {
      props: { header: '标题' },
      slots: { default: '内容' },
    })
    expect(wrapper.find('.b-card-header').text()).toContain('标题')
    expect(wrapper.find('.b-card-body').text()).toContain('内容')
  })

  it('applies shadow mode class', () => {
    const wrapper = mount(BCard, { props: { shadow: 'hover' } })
    expect(wrapper.classes()).toContain('b-card--shadow-hover')
  })
})

describe('SkeletonCard', () => {
  it('renders requested number of lines', () => {
    const wrapper = mount(SkeletonCard, { props: { lines: 4 } })
    expect(wrapper.findAll('.skeleton-line').length).toBe(4)
  })
})
