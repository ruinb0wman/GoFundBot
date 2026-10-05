import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ChatPanel from '../../components/ChatPanel.vue'
import { useChatStore, type DisplayMessage } from '../../stores/chatStore'

/**
 * The tool chips are the only place the "no data" state surfaces to the user,
 * so this guards the icon/class/hint wiring end to end (store status → chip).
 */
function mountPanel(toolCalls: NonNullable<DisplayMessage['toolCalls']>) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useChatStore()
  vi.spyOn(store, 'init').mockResolvedValue(undefined)
  store.messages = [{ id: 'a1', role: 'assistant', content: '大盘概览', toolCalls }]
  return mount(ChatPanel, {
    global: {
      plugins: [pinia],
      // @lucide/vue needs an app-level icon context; we only care about the
      // icon *name* chosen per status, so stub the wrapper.
      stubs: { LucideIcon: { props: ['name'], template: '<i :data-icon="name" />' } },
    },
  })
}

/** Rendered icon name per chip. */
function iconNames(wrapper: ReturnType<typeof mountPanel>): string[] {
  return wrapper.findAll('.tool-call-item i').map((i) => i.attributes('data-icon') ?? '')
}

describe('ChatPanel tool call chips', () => {
  beforeEach(() => {
    // jsdom has no scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('renders one chip per tool call with the matching status class', () => {
    const wrapper = mountPanel([
      { name: 'get_market_indices', params: {}, status: 'empty', durationMs: 220 },
      { name: 'get_north_flow', params: {}, status: 'done', durationMs: 600 },
      { name: 'get_hot_sectors', params: {}, status: 'error', durationMs: 900 },
      { name: 'get_concept_sectors', params: {}, status: 'running' },
    ])

    const items = wrapper.findAll('.tool-call-item')
    expect(items.map((i) => i.classes().filter((c) => c !== 'tool-call-item').join(','))).toEqual([
      'empty',
      'done',
      'error',
      'running',
    ])
    // Labels come from the tool registry
    expect(items[0].text()).toContain('获取指数行情')
    expect(items[3].text()).toContain('获取概念板块')
  })

  it('marks an empty result with a warning icon and a 暂无数据 hint', () => {
    const wrapper = mountPanel([
      { name: 'get_market_indices', params: {}, status: 'empty', durationMs: 220 },
      { name: 'get_north_flow', params: {}, status: 'done', durationMs: 600 },
    ])

    const [empty, done] = wrapper.findAll('.tool-call-item')
    expect(empty.find('.tool-call-hint').text()).toBe('暂无数据')
    expect(iconNames(wrapper)).toEqual(['TriangleAlert', 'CheckCircle'])

    // A successful call keeps the green check and shows no hint
    expect(done.find('.tool-call-hint').exists()).toBe(false)
  })

  it('hides the duration for non-done chips', () => {
    const wrapper = mountPanel([
      { name: 'get_market_indices', params: {}, status: 'empty', durationMs: 220 },
    ])
    expect(wrapper.find('.tool-call-duration').exists()).toBe(false)
  })
})
