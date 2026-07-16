import { ref, onMounted, onUnmounted, type Ref } from 'vue'

export interface DataPollerOptions<T> {
  fetcher: () => Promise<{ success: boolean; data: T }>
  type: string
  successInterval?: number
  failureInterval?: number
  forceInterval?: number
  immediate?: boolean
}

export interface DataPollerResult<T> {
  data: Ref<T | null>
  status: Ref<'idle' | 'success' | 'failed'>
  updateTime: Ref<string>
  loading: Ref<boolean>
  start: () => void
  stop: () => void
  refresh: () => Promise<void>
}

export function useDataPoller<T>(options: DataPollerOptions<T>): DataPollerResult<T> {
  const {
    fetcher,
    type,
    successInterval = 600_000,
    failureInterval = 60_000,
    forceInterval,
    immediate = true,
  } = options

  const data = ref<T | null>(null) as Ref<T | null>
  const status = ref<'idle' | 'success' | 'failed'>('idle')
  const updateTime = ref('')
  const loading = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null

  function getInterval(success: boolean): number {
    if (forceInterval) return forceInterval
    return success ? successInterval : failureInterval
  }

  function stop() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function execute() {
    loading.value = true
    try {
      const result = await fetcher()
      if (result.success) {
        data.value = result.data
        status.value = 'success'
      } else {
        status.value = 'failed'
      }
    } catch {
      status.value = 'failed'
    } finally {
      updateTime.value = new Date().toISOString()
      loading.value = false
      timer = setTimeout(execute, getInterval(status.value === 'success'))
    }
  }

  function start() {
    stop()
    execute()
  }

  async function refresh() {
    stop()
    await execute()
  }

  onMounted(() => {
    if (immediate) start()
  })

  onUnmounted(() => {
    stop()
  })

  return {
    data,
    status,
    updateTime,
    loading,
    start,
    stop,
    refresh,
  }
}
