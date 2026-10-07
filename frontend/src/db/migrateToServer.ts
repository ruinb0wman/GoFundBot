/**
 * 一次性迁移：把浏览器 Dexie 里的用户数据搬到 service 的 SQLite（P2）。
 *
 * 安全约束：
 * - 只在「本地有数据」且「尚未迁移过」（localStorage flag）时执行；
 * - **只有 service 明确确认导入成功后才清空本地**，失败则保留本地数据下次再试；
 * - 幂等：本地 flag + 服务端「表为空才写入」双重保证。
 */
import { db } from './index'
import { importUserDataApi, type ImportSummary } from '../services/userDataApi'

const MIGRATED_FLAG = 'gofund:userdata-migrated:v1'

export interface MigrationResult {
  skipped: boolean
  migrated?: ImportSummary
}

function markMigrated(): void {
  try {
    localStorage.setItem(MIGRATED_FLAG, String(Date.now()))
  } catch {
    // 隐私模式等场景写不了 storage：下次启动会重跑，服务端幂等保证不会重复写入
  }
}

function dispatchLocalChange(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('gofund:strategies-changed'))
  window.dispatchEvent(new CustomEvent('watchlist-updated', { detail: { action: 'migrated' } }))
}

export async function migrateLocalUserDataToServer(): Promise<MigrationResult> {
  try {
    if (localStorage.getItem(MIGRATED_FLAG)) return { skipped: true }
  } catch {
    // 读不到 flag 也继续（服务端幂等）
  }

  const [positions, strategies, strategyScripts, watchlist, watchlistGroups] = await Promise.all([
    db.positions.toArray(),
    db.strategies.toArray(),
    db.strategyScripts.toArray(),
    db.watchlist.toArray(),
    db.watchlistGroups.toArray(),
  ])

  const total =
    positions.length + strategies.length + strategyScripts.length + watchlist.length + watchlistGroups.length
  if (total === 0) {
    markMigrated()
    return { skipped: true }
  }

  const summary = await importUserDataApi({
    positions: positions.map((p) => ({
      fundCode: p.fundCode,
      fundName: p.fundName,
      purchaseDate: p.purchaseDate,
      purchaseTime: p.purchaseTime,
      shares: p.shares,
      cost: p.cost,
    })),
    strategies: strategies.map((s) => ({
      title: s.title,
      content: s.content,
      tags: s.tags,
      active: s.active,
      source: s.source,
    })),
    strategyScripts: strategyScripts.map((s) => ({
      name: s.name,
      code: s.code,
      source: s.source,
      lastRunAt: s.lastRunAt ?? null,
      lastSummary: s.lastSummary ?? null,
    })),
    watchlist: watchlist.map((w) => ({
      fundCode: w.fundCode,
      fundName: w.fundName,
      fundType: w.fundType,
      groupId: w.groupId,
      sortOrder: w.sortOrder,
      addedAt: w.addedAt,
    })),
    watchlistGroups: watchlistGroups.map((g) => ({ id: g.id, name: g.name, sortOrder: g.sortOrder })),
  })

  // 服务端已确认写入 → 清空本地用户表（缓存表 fundCache/marketCache/screeningFunds/navHistory 保留）
  await Promise.all([
    db.positions.clear(),
    db.strategies.clear(),
    db.strategyScripts.clear(),
    db.watchlist.clear(),
    db.watchlistGroups.clear(),
  ])
  markMigrated()
  dispatchLocalChange()

  return { skipped: false, migrated: summary }
}
