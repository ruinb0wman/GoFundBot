import { ref, computed, type Ref } from 'vue'

export type DataFreshness = 'no_data' | 'stale' | 'fresh'

export interface AdaptiveRefreshOptions {
  fetcher: () => Promise<boolean>
  intervals?: {
    noData?: number
    stale?: number
    fresh?: number
  }
  overrideInterval?: number
}

export function useAdaptiveRefresh(options: AdaptiveRefreshOptions) {
  const {
    fetcher,
    intervals: rawIntervals = {},
    overrideInterval,
  } = options

  const intervals = {
    noData: rawIntervals.noData ?? 60000,
    stale: rawIntervals.stale ?? 300000,
    fresh: rawIntervals.fresh ?? 600000,
  }

  const lastSuccessTime = ref('')
  const freshness = ref<DataFreshness>('no_data')
  const loading = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  const isFresh = computed(() => freshness.value === 'fresh')
  const isStale = computed(() => freshness.value === 'stale')
  const hasData = computed(() => freshness.value !== 'no_data')

  function getInterval(): number {
    if (overrideInterval) return overrideInterval
    const key = freshness.value === 'no_data' ? 'noData' : freshness.value
    return intervals[key as keyof typeof intervals]
  }

  function scheduleNext() {
    stop()
    timer = setTimeout(execute, getInterval())
  }

  async function execute() {
    loading.value = true
    try {
      const success = await fetcher()
      if (success) {
        lastSuccessTime.value = new Date().toISOString()
        freshness.value = 'fresh'
      } else if (freshness.value === 'no_data') {
        freshness.value = 'no_data'
      } else {
        freshness.value = 'stale'
      }
    } catch {
      if (freshness.value !== 'no_data') {
        freshness.value = 'stale'
      }
    } finally {
      loading.value = false
      scheduleNext()
    }
  }

  function start() {
    if (timer === null) execute()
  }

  function stop() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function refresh() {
    stop()
    execute()
  }

  return {
    lastSuccessTime,
    freshness,
    isFresh,
    isStale,
    hasData,
    loading,
    start,
    stop,
    refresh,
  }
}
