/**
 * 基金筛选（服务端版）—— P3.3 起筛选数据的唯一真源在 **service SQLite**
 * （`service/src/services/screeningService.ts`），前端不再持有 `screeningFunds` 表。
 *
 * 这里保持迁移前的公开签名（`syncFromServer` / `compute4433` / `getStatus` / `queryFunds`
 * + `syncing` / `lastSyncTime` / `computed`），所以 `useFundScreening.ts` 一行未改。
 *
 * 富化（风险指标）由服务端**分批**完成，这里循环调到追平为止（每批 300，单请求 ≤ ~15s）。
 */
import { ref } from 'vue'
import { screeningAPI } from '../services/api'
import { check4433Rule } from '@gofund/core/screeningEnrich'
import type { ScreeningFund } from '../db'

export interface QueryResult {
  funds: ScreeningFund[]
  total: number
  page: number
  page_size: number
}

export interface ScreeningStatus {
  basic_count: number
  complete_count: number
  pass_4433_count: number
  risk_metrics_count: number
  type_counts: Record<string, number>
  latest_update: string | null
  sync_time: string | null
  syncing: boolean
  computed: boolean
}

/** 每批富化的基金数：与服务端 `DEFAULT_ENRICH_LIMIT` 一致。 */
const ENRICH_BATCH = 300
const STORAGE_KEY = 'screening-last-sync'

const syncing = ref(false)
const lastSyncTime = ref<string | null>(localStorage.getItem(STORAGE_KEY) || null)
const computed = ref(false)

function isBefore9am(time: string | null): boolean {
  if (!time) return true
  const nineAM = new Date()
  nineAM.setHours(9, 0, 0, 0)
  return new Date(time) < nineAM
}

function persistSyncTime(time: string): void {
  lastSyncTime.value = time
  localStorage.setItem(STORAGE_KEY, time)
}

/** 服务端信封 → data；失败一律当空对象，不抛给页面。 */
function unwrap<T>(response: { data?: unknown }): T {
  const body = response?.data as { data?: T } | undefined
  return (body?.data ?? {}) as T
}

interface SyncPayload {
  total?: number
  sync_time?: string | null
  computed?: boolean
  risk_metrics_pending?: number
}

export function useScreeningDb() {
  async function syncFromServer(since?: string, force = false): Promise<number> {
    syncing.value = true
    try {
      if (!force && isBefore9am(lastSyncTime.value)) force = true

      const params: Record<string, unknown> = {}
      if (since && !force) params.since = since
      if (force) params.force = 'true'

      const data = unwrap<SyncPayload>(await screeningAPI.sync(params))
      if (data.sync_time) persistSyncTime(data.sync_time)
      computed.value = Boolean(data.computed)

      // 风险指标分批富化到追平；没有进展就停下，避免空转。
      let pending = Number(data.risk_metrics_pending ?? 0)
      while (pending > 0) {
        const batch = unwrap<{ risk_metrics_pending?: number }>(
          await screeningAPI.compute({ limit: ENRICH_BATCH }),
        )
        const next = Number(batch.risk_metrics_pending ?? 0)
        if (next >= pending) break
        pending = next
      }

      return Number(data.total ?? 0)
    } finally {
      syncing.value = false
    }
  }

  /** 重算 4433 排名（服务端同步后已算过一次，这里供手动触发）。 */
  async function compute4433(): Promise<void> {
    await screeningAPI.ranks()
    computed.value = true
  }

  async function getStatus(): Promise<ScreeningStatus> {
    const data = unwrap<Partial<ScreeningStatus>>(await screeningAPI.getStatus())
    return {
      basic_count: data.basic_count ?? 0,
      complete_count: data.complete_count ?? 0,
      pass_4433_count: data.pass_4433_count ?? 0,
      risk_metrics_count: data.risk_metrics_count ?? 0,
      type_counts: data.type_counts ?? {},
      latest_update: data.latest_update ?? null,
      sync_time: data.sync_time ?? lastSyncTime.value,
      syncing: syncing.value,
      computed: data.computed ?? computed.value,
    }
  }

  async function queryFunds(
    filters: Record<string, unknown>,
    sortByField: string = 'return_1y',
    sortOrder: 'asc' | 'desc' = 'desc',
    page: number = 1,
    pageSize: number = 20,
  ): Promise<QueryResult> {
    const data = unwrap<QueryResult>(
      await screeningAPI.query({
        filters,
        sort_by: sortByField,
        sort_order: sortOrder,
        page,
        page_size: pageSize,
      }),
    )
    return {
      funds: data.funds ?? [],
      total: data.total ?? 0,
      page: data.page ?? page,
      page_size: data.page_size ?? pageSize,
    }
  }

  return { syncFromServer, compute4433, getStatus, queryFunds, syncing, lastSyncTime, computed }
}

export { check4433Rule }
