import { watch, type WatchSource, type WatchCallback } from 'vue'

export function useDebouncedWatch<T>(
  source: WatchSource<T>,
  callback: WatchCallback<T>,
  wait = 300,
  options: Record<string, unknown> = {},
): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  watch(source, (...args: Parameters<WatchCallback<T>>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      callback(...args)
    }, wait)
  }, { ...options, flush: 'pre' } as any)
}
