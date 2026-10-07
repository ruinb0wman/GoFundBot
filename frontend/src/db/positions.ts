/**
 * 持仓 CRUD。
 *
 * Node 核心化（P2）后持仓存在 service 的 SQLite（`positions` 表）；
 * 本模块保留原导出签名，内部转发到 `services/userDataApi.ts`，
 * 所以页面与工具调用点无需改动。
 *
 * `purchaseTime` 是普通字段，扩展它不需要改 schema。
 */

import {
  addPositionApi,
  listPositionsApi,
  removePositionApi,
  replaceAllPositionsApi,
  updatePositionApi,
  type PositionInput,
  type PositionRecord,
} from '../services/userDataApi'

export type { PositionInput, PositionRecord }

export async function listPositions(): Promise<PositionRecord[]> {
  return listPositionsApi()
}

export async function addPosition(input: PositionInput): Promise<PositionRecord> {
  return addPositionApi(input)
}

export async function updatePosition(id: number, patch: Partial<PositionInput>): Promise<void> {
  await updatePositionApi(id, patch)
}

export async function removePosition(id: number): Promise<void> {
  await removePositionApi(id)
}

export async function clearPositions(): Promise<void> {
  await replaceAllPositionsApi([])
}

/**
 * 整表替换（UI 在内存里改多行后回写）。
 * 服务端在一个事务里完成「清空 + 重建」，返回值舍弃（调用方随后会重新拉取）。
 */
export async function replaceAllPositions(rows: PositionInput[]): Promise<void> {
  await replaceAllPositionsApi(rows)
}
