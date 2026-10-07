# 我的自选 (Fund Watchlist)

## 一、概述

用户自选基金列表，支持分组管理、拖拽排序、批量操作、估值刷新。数据真源是 **service SQLite**（`watchlist` + `watchlist_groups` 表），前端走 HTTP。

## 二、数据流路径

```
用户操作（增删改查）
  → Pinia watchlistStore
    → /api/watchlist(/groups) → service SQLite (watchlist 表 + watchlist_groups 表)
    → 前端 UI 响应式更新（写成功后派发 watchlist-updated）

估值刷新
  → 用户点击刷新 / 定时自适应刷新
    → POST /api/watchlist/refresh-estimates
      → 服务端批量查询基金估值
    → 更新 watchlistStore.estimates
      → service 内存缓存（估值数据不落库）
      → 前端显示实时估值
```

### 关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| Database | `frontend/src/db/index.ts:3-16` | `WatchlistItem` / `WatchlistGroup` 接口 |
| Database | `frontend/src/db/index.ts:153` | `watchlist` 表定义 |
| Store | `frontend/src/stores/watchlistStore.ts` | Pinia store — CRUD 操作 |
| Composable | `frontend/src/composables/useFundWatchlist.ts` | 组件逻辑封装 |
| Component | `frontend/src/components/FundWatchlist.vue` | 自选列表渲染 |
| API | `frontend/src/services/api.ts:55` | `watchlistAPI.refreshEstimates()` |
| Backend Route | `service/src/routes/watchlist.routes.ts` | `POST /api/watchlist/refresh-estimates` |

## 三、数据模型

### 3.1 WatchlistItem

| 字段 | 类型 | 说明 |
|------|------|------|
| `fundCode` | string | 基金代码（主键） |
| `fundName` | string | 基金名称 |
| `fundType` | string \| null | 基金类型 |
| `groupId` | number \| null | 所属分组 ID |
| `sortOrder` | number | 排序序号 |
| `addedAt` | number | 添加时间戳 |

### 3.2 WatchlistGroup

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number (auto) | 分组 ID |
| `name` | string | 分组名称 |
| `sortOrder` | number | 排序序号 |

## 四、功能说明

| 功能 | 实现方式 |
|------|---------|
| 添加自选 | 通过搜索框 `FundSearch` 添加基金到自选 |
| 分组管理 | 创建/重命名/删除分组，支持拖拽移动 |
| 拖拽排序 | HTML5 Drag & Drop API，分组内/跨组拖拽 |
| 批量操作 | 编辑模式可选多个基金，批量删除 |
| 估值刷新 | 自适应刷新策略（`useAdaptiveRefresh`），定时/手动触发 |
| 异动提醒 | 点击铃铛图标打开该基金的异动阈值设置 |

## 五、数据持久化

数据存在 service SQLite（`service/data/gofund.db`），因此**同机不同浏览器看到的是同一份**：

```
SQLite: service/data/gofund.db
  表: watchlist        (fund_code, fund_name, fund_type, group_id, sort_order, added_at)
  表: watchlist_groups (id, name, sort_order)
```

- 接口：`GET/POST/PUT/DELETE /api/watchlist`、`/api/watchlist/groups`、`POST /api/watchlist/refresh-estimates`。
- 旧版浏览器 Dexie 数据由 `db/migrateToServer.ts` 首次启动时一次性导入（localStorage flag + 服务端幂等）。
- 估值仍走 `/api/watchlist/refresh-estimates`（实时取数，不落库）。

## 六、已知问题

1. **纯前端存储**：清除浏览器数据将丢失自选列表。
2. **估值数据非实时**：基金估值通常延时 15 分钟以上，盘中估值仅供参考。
3. **无跨设备同步**：暂时不支持多设备自选同步。
