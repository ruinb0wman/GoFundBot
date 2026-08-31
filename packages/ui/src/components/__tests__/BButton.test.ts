import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BButton from '../BButton.vue'

describe('BButton', () => {
  it('renders default button with label', () => {
    const wrapper = mount(BButton, { slots: { default: '提交' } })
    expect(wrapper.classes()).toContain('b-btn')
    expect(wrapper.classes()).toContain('b-btn--default')
    expect(wrapper.text()).toContain('提交')
  })

  it('applies type and size classes', () => {
    const wrapper = mount(BButton, { props: { type: 'primary', size: 'large' } })
    expect(wrapper.classes()).toContain('b-btn--primary')
    expect(wrapper.classes()).toContain('b-btn--large')
  })

  it('emits click when not disabled', async () => {
    const wrapper = mount(BButton)
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('does not emit click when disabled', async () => {
    const wrapper = mount(BButton, { props: { disabled: true } })
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toBeUndefined()
  })

  it('renders plain / round / circle variant classes', () => {
    const wrapper = mount(BButton, { props: { plain: true, round: true } })
    expect(wrapper.classes()).toContain('b-btn--plain')
    expect(wrapper.classes()).toContain('b-btn--round')
  })

  it('uses nativeType prop', () => {
    const wrapper = mount(BButton, { props: { nativeType: 'submit' } })
    expect(wrapper.attributes('type')).toBe('submit')
  })
})
