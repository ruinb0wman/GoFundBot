import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'

describe('useDebouncedWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls callback after debounce wait period', async () => {
    const { useDebouncedWatch } = await import('../../composables/useDebouncedWatch')
    const source = ref(0)
    const callback = vi.fn()
    useDebouncedWatch(source, callback, 300)
    source.value = 1
    await nextTick()
    expect(callback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('debounces multiple rapid changes', async () => {
    const { useDebouncedWatch } = await import('../../composables/useDebouncedWatch')
    const source = ref(0)
    const callback = vi.fn()
    useDebouncedWatch(source, callback, 300)
    source.value = 1
    source.value = 2
    source.value = 3
    await nextTick()
    vi.advanceTimersByTime(300)
    // Should only fire once (with the last value) after debounce
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
