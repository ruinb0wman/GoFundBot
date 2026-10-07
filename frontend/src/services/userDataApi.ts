/**
 * 用户数据 HTTP 客户端（策略 / 持仓 / 自选 / 回测方案）。
 *
 * Node 核心化（P2）后这些数据的唯一真源在 service 的 SQLite；
 * `db/*.ts` 模块保留原导出签名、内部改为调这里，所以既有调用点无需改动。
 */
import { api } from './api'
import type { HttpResponse } from './httpClient'
import type {
  StrategyRecord as DbStrategyRecord,
  StrategyScriptRecord as DbStrategyScriptRecord,
  UserPosition,
  WatchlistGroup as DbWatchlistGroup,
  WatchlistItem,
} from '../db'

interface Envelope<T> {
  success?: boolean
  data?: T
  error?: { message?: string } | string
}

export interface PositionInput {
  id?: number
  fundCode: string
  fundName?: string | null
  purchaseDate?: string | null
  purchaseTime?: string | null
  shares: number
  cost: number
}

export interface StrategyInput {
  title: string
  content: string
  tags: string[]
  active?: number
  source?: 'manual' | 'ai-draft'
}

export interface StrategyScriptInput {
  name: string
  code: string
  source?: 'manual' | 'ai'
}

export type PositionRecord = UserPosition & { id: number }
/** 服务端返回的记录一定有 id（Dexie 版本里 id 是可选的）。 */
export type StrategyRecord = Omit<DbStrategyRecord, 'id'> & { id: number }
export type StrategyScriptRecord = Omit<DbStrategyScriptRecord, 'id'> & { id: number }
export type WatchlistGroup = Omit<DbWatchlistGroup, 'id'> & { id: number }
export type { WatchlistItem }

function failureMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

/** 解包 `{success, data}` 信封；失败抛出带服务端文案的错误。 */
function unwrap<T>(res: HttpResponse<Envelope<T>>, fallback: string): T {
  const envelope = res.data
  if (!envelope || envelope.success === false || envelope.data === undefined) {
    throw new Error(failureMessage(envelope?.error, fallback))
  }
  return envelope.data
}

// ── positions ────────────────────────────────────────────────────────────────

export async function listPositionsApi(): Promise<PositionRecord[]> {
  const res = await api.get<Envelope<{ items: PositionRecord[] }>>('/positions')
  return unwrap(res, '获取持仓失败').items
}

export async function addPositionApi(input: PositionInput): Promise<PositionRecord> {
  const res = await api.post<Envelope<PositionRecord>>('/positions', input)
  return unwrap(res, '新增持仓失败')
}

export async function updatePositionApi(id: number, patch: Partial<PositionInput>): Promise<void> {
  const res = await api.put<Envelope<{ items: PositionRecord[] }>>(`/positions/${id}`, patch)
  unwrap(res, '更新持仓失败')
}

export async function removePositionApi(id: number): Promise<void> {
  const res = await api.delete<Envelope<{ items: PositionRecord[] }>>(`/positions/${id}`)
  unwrap(res, '删除持仓失败')
}

export async function replaceAllPositionsApi(items: PositionInput[]): Promise<PositionRecord[]> {
  const res = await api.put<Envelope<{ items: PositionRecord[] }>>('/positions', { items })
  return unwrap(res, '保存持仓失败').items
}

// ── strategies ───────────────────────────────────────────────────────────────

export async function listStrategiesApi(): Promise<StrategyRecord[]> {
  const res = await api.get<Envelope<{ items: StrategyRecord[] }>>('/strategies')
  return unwrap(res, '获取策略失败').items
}

export async function addStrategyApi(input: StrategyInput): Promise<StrategyRecord> {
  const res = await api.post<Envelope<StrategyRecord>>('/strategies', input)
  return unwrap(res, '新增策略失败')
}

export async function updateStrategyApi(id: number, patch: Partial<StrategyInput>): Promise<StrategyRecord> {
  const res = await api.put<Envelope<StrategyRecord>>(`/strategies/${id}`, patch)
  return unwrap(res, '更新策略失败')
}

export async function removeStrategyApi(id: number): Promise<void> {
  const res = await api.delete<Envelope<{ items: StrategyRecord[] }>>(`/strategies/${id}`)
  unwrap(res, '删除策略失败')
}

// ── backtest scripts ─────────────────────────────────────────────────────────

export async function listScriptsApi(): Promise<StrategyScriptRecord[]> {
  const res = await api.get<Envelope<{ items: StrategyScriptRecord[] }>>('/backtest-scripts')
  return unwrap(res, '获取回测方案失败').items
}

export async function getScriptApi(id: number): Promise<StrategyScriptRecord | null> {
  const res = await api.get<Envelope<StrategyScriptRecord>>(`/backtest-scripts/${id}`)
  const envelope = res.data
  if (!envelope?.success) return null
  return envelope.data ?? null
}

export async function createScriptApi(input: StrategyScriptInput): Promise<StrategyScriptRecord> {
  const res = await api.post<Envelope<StrategyScriptRecord>>('/backtest-scripts', {
    name: input.name,
    code: input.code,
    source: input.source ?? 'manual',
  })
  return unwrap(res, '保存方案失败')
}

export async function updateScriptApi(id: number, patch: { name?: string; code?: string }): Promise<void> {
  const res = await api.put<Envelope<{ items: StrategyScriptRecord[] }>>(`/backtest-scripts/${id}`, patch)
  unwrap(res, '更新方案失败')
}

export async function deleteScriptApi(id: number): Promise<void> {
  const res = await api.delete<Envelope<{ items: StrategyScriptRecord[] }>>(`/backtest-scripts/${id}`)
  unwrap(res, '删除方案失败')
}

export async function recordScriptRunApi(id: number, summary: unknown): Promise<void> {
  const res = await api.post<Envelope<{ items: StrategyScriptRecord[] }>>(`/backtest-scripts/${id}/run`, summary ?? {})
  unwrap(res, '记录运行结果失败')
}

// ── watchlist ────────────────────────────────────────────────────────────────

export interface WatchlistSnapshot {
  items: WatchlistItem[]
  groups: WatchlistGroup[]
}

export async function getWatchlistApi(): Promise<WatchlistSnapshot> {
  const res = await api.get<Envelope<WatchlistSnapshot>>('/watchlist')
  return unwrap(res, '获取自选失败')
}

export async function upsertWatchlistApi(item: WatchlistItem): Promise<WatchlistItem> {
  const res = await api.put<Envelope<WatchlistItem>>(`/watchlist/${encodeURIComponent(item.fundCode)}`, {
    fundName: item.fundName,
    fundType: item.fundType,
    groupId: item.groupId,
    sortOrder: item.sortOrder,
    addedAt: item.addedAt,
  })
  return unwrap(res, '添加自选失败')
}

export async function removeWatchlistApi(codes: string[]): Promise<WatchlistSnapshot> {
  const res = await api.post<Envelope<WatchlistSnapshot>>('/watchlist/batch-delete', { codes })
  return unwrap(res, '删除自选失败')
}

export async function reorderWatchlistApi(codes: string[]): Promise<WatchlistItem[]> {
  const res = await api.put<Envelope<WatchlistItem[]>>('/watchlist/reorder', { codes })
  return unwrap(res, '重排自选失败')
}

export async function assignWatchlistGroupApi(codes: string[], groupId: number | null): Promise<void> {
  for (const code of codes) {
    const res = await api.put<Envelope<WatchlistItem[]>>(`/watchlist/${encodeURIComponent(code)}/group`, {
      groupId,
    })
    unwrap(res, '移动分组失败')
  }
}

export async function createWatchlistGroupApi(name: string): Promise<WatchlistGroup> {
  const res = await api.post<Envelope<WatchlistGroup>>('/watchlist/groups', { name })
  return unwrap(res, '新建分组失败')
}

export async function renameWatchlistGroupApi(id: number, name: string): Promise<WatchlistGroup[]> {
  const res = await api.put<Envelope<WatchlistGroup[]>>(`/watchlist/groups/${id}`, { name })
  return unwrap(res, '重命名分组失败')
}

export async function deleteWatchlistGroupApi(id: number): Promise<WatchlistSnapshot> {
  const res = await api.delete<Envelope<WatchlistSnapshot>>(`/watchlist/groups/${id}`)
  return unwrap(res, '删除分组失败')
}

export async function reorderWatchlistGroupsApi(ids: number[]): Promise<WatchlistGroup[]> {
  const res = await api.put<Envelope<WatchlistGroup[]>>('/watchlist/groups/reorder', { ids })
  return unwrap(res, '重排分组失败')
}

// ── 一次性导入 ───────────────────────────────────────────────────────────────

export interface UserDataDump {
  positions?: unknown[]
  strategies?: unknown[]
  strategyScripts?: unknown[]
  watchlist?: unknown[]
  watchlistGroups?: unknown[]
}

export interface ImportSummary {
  positions: number
  strategies: number
  strategyScripts: number
  watchlist: number
  watchlistGroups: number
}

export async function importUserDataApi(dump: UserDataDump): Promise<ImportSummary> {
  const res = await api.post<Envelope<ImportSummary>>('/user/import', dump)
  return unwrap(res, '导入旧数据失败')
}
