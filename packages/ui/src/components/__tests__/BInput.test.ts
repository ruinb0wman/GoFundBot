import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BInput from '../BInput.vue'

describe('BInput', () => {
  it('renders input with value', () => {
    const wrapper = mount(BInput, { props: { modelValue: 'hello' } })
    const input = wrapper.find('input')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('hello')
  })

  it('emits update:modelValue on input', async () => {
    const wrapper = mount(BInput)
    await wrapper.find('input').setValue('foo')
    const events = wrapper.emitted('update:modelValue')!
    expect(events[events.length - 1]).toEqual(['foo'])
  })

  it('renders clear button when clearable and has value', () => {
    const wrapper = mount(BInput, { props: { modelValue: 'abc', clearable: true } })
    expect(wrapper.find('.b-input__clear').exists()).toBe(true)
  })

  it('clears value on clear click', async () => {
    const wrapper = mount(BInput, { props: { modelValue: 'abc', clearable: true } })
    await wrapper.find('.b-input__clear').trigger('click')
    const events = wrapper.emitted('update:modelValue')!
    expect(events[events.length - 1]).toEqual([''])
  })

  it('renders textarea variant', () => {
    const wrapper = mount(BInput, { props: { type: 'textarea' } })
    expect(wrapper.find('textarea').exists()).toBe(true)
  })

  it('appends prefix icon', () => {
    const wrapper = mount(BInput, { props: { prefixIcon: 'Search' } })
    expect(wrapper.find('.b-input__prefix').exists()).toBe(true)
  })
})
