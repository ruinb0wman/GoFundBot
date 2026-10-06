/**
 * Holdings (MyPositions) CRUD over IndexedDB.
 *
 * Why this file exists: the portfolio page and the `/user/portfolio/positions`
 * service route are stubs returning `[]`, so positions used to live only in memory
 * and vanished on reload — and no chat tool could read them. Persisting them here
 * (the Dexie `positions` table was already declared but unused) is what makes both
 * the page durable and `get_portfolio_holdings` possible.
 *
 * `purchaseTime` is a plain non-indexed field, so extending it needs no schema bump.
 */

import { db, type UserPosition } from './index'

export interface PositionInput {
  id?: number
  fundCode: string
  fundName?: string | null
  purchaseDate?: string | null
  purchaseTime?: string | null
  shares: number
  cost: number
}

export interface PositionRecord extends UserPosition {
  id: number
}

function toRecord(input: PositionInput): UserPosition {
  return {
    fundCode: String(input.fundCode ?? '').trim(),
    fundName: input.fundName ?? null,
    purchaseDate: input.purchaseDate ?? null,
    purchaseTime: input.purchaseTime ?? null,
    shares: Number(input.shares) || 0,
    cost: Number(input.cost) || 0,
    createdAt: Date.now(),
  }
}

export async function listPositions(): Promise<PositionRecord[]> {
  const rows = await db.positions.toArray()
  return rows as PositionRecord[]
}

export async function addPosition(input: PositionInput): Promise<PositionRecord> {
  const record = toRecord(input)
  const id = await db.positions.add(record)
  return { ...record, id }
}

export async function updatePosition(id: number, patch: Partial<PositionInput>): Promise<void> {
  const record: Partial<UserPosition> = { ...patch } as Partial<UserPosition>
  delete (record as { id?: number }).id
  await db.positions.update(id, record)
}

export async function removePosition(id: number): Promise<void> {
  await db.positions.delete(id)
}

export async function clearPositions(): Promise<void> {
  await db.positions.clear()
}

/**
 * Rewrite the whole table from the in-memory list (used after an operation that
 * mutates several rows in place). Existing ids are preserved via `put`, new rows get
 * ids written back via `id`, and rows absent from `rows` are deleted.
 */
export async function replaceAllPositions(rows: PositionInput[]): Promise<void> {
  await db.transaction('rw', db.positions, async () => {
    const keep = new Set<number>()
    for (const row of rows) {
      const record = toRecord(row)
      if (row.id != null) {
        await db.positions.put({ ...record, id: row.id })
        keep.add(row.id)
      } else {
        const id = await db.positions.add(record)
        row.id = id
        keep.add(id)
      }
    }
    const existing = await db.positions.toArray()
    for (const record of existing) {
      if (record.id != null && !keep.has(record.id)) await db.positions.delete(record.id)
    }
  })
}
