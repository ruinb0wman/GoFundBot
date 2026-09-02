import { ref, onUnmounted, type Ref } from 'vue'
import { db } from '../db'

interface CacheOptions<T> {
  key: string
  fetcher: () => Promise<T>
  ttlMs: number
  table: 'fundCache' | 'marketCache'
}

interface CacheResult<T> {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  refresh: () => Promise<void>
}

export function useDexieCache<T = unknown>(options: CacheOptions<T>): CacheResult<T> {
  const data = ref<T | null>(null) as Ref<T | null>
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function load(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const table = db[options.table]
      const cached = await (table as DexieTable).get(options.key) as { data: T; updatedAt: number } | undefined

      const now = Date.now()
      const isStale = cached ? (now - cached.updatedAt) > options.ttlMs : true

      if (cached && !isStale) {
        data.value = cached.data
        loading.value = false
        return
      }

      if (cached && isStale) {
        data.value = cached.data
      }

      try {
        const fresh = await options.fetcher()
        data.value = fresh
        await (table as DexieTable).put({ key: options.key, data: fresh, updatedAt: now } as never)
      } catch (e) {
        if (!cached) {
          throw e
        }
        console.warn(`[DexieCache] stale fetch failed, using cache: ${options.key}`, e)
      }
    } catch (e) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  load()

  const refresh = load

  return { data, loading, error, refresh }
}

interface DexieTable {
  get(key: string): Promise<unknown>
  put(item: unknown): Promise<unknown>
}

export async function invalidateCache(key: string, table: 'fundCache' | 'marketCache'): Promise<void> {
  const t = db[table]
  try {
    await (t as DexieTable).put({ key, data: null, updatedAt: 0 } as never)
  } catch {
    // ignore
  }
}

export async function getCache<T>(key: string, table: 'fundCache' | 'marketCache'): Promise<T | null> {
  const t = db[table]
  const entry = await (t as DexieTable).get(key) as { data: T } | undefined
  return entry?.data ?? null
}

export async function setCache<T>(key: string, data: T, table: 'fundCache' | 'marketCache'): Promise<void> {
  const t = db[table]
  await (t as DexieTable).put({ key, data, updatedAt: Date.now() } as never)
}
