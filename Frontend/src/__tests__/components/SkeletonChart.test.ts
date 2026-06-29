import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SkeletonChart from '../../components/SkeletonChart.vue'

describe('SkeletonChart', () => {
  it('renders with default props', () => {
    const wrapper = mount(SkeletonChart)
    expect(wrapper.find('.skeleton-chart').exists()).toBe(true)
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('applies height prop as inline style', () => {
    const wrapper = mount(SkeletonChart, { props: { height: 200 } })
    expect(wrapper.attributes('style')).toContain('height: 200px')
  })

  it('renders legend skeleton lines', () => {
    const wrapper = mount(SkeletonChart)
    const legends = wrapper.findAll('.skeleton-line')
    expect(legends).toHaveLength(2)
  })
})
