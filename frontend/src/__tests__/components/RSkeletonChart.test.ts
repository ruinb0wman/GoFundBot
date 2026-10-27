import { RSkeletonChart } from '@ruinb0w/ui'
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'

describe('RSkeletonChart', () => {
  it('renders with default props', () => {
    const wrapper = mount(RSkeletonChart)
    expect(wrapper.find('.skeleton-chart').exists()).toBe(true)
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('applies height prop as inline style', () => {
    const wrapper = mount(RSkeletonChart, { props: { height: 200 } })
    expect(wrapper.attributes('style')).toContain('height: 200px')
  })

  it('renders legend skeleton lines', () => {
    const wrapper = mount(RSkeletonChart)
    const legends = wrapper.findAll('.skeleton-line')
    expect(legends).toHaveLength(2)
  })
})
