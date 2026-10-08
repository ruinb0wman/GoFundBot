# 筛选数据流

## 一次完整的刷新

```
页面 onMounted
  └─ 判断 localStorage.lastSyncTime 是否过期（当天 9AM 前算过期）→ 过期则 force=true
     └─ GET /api/screening/sync?force=true
        ├─ 拉基金快照（东方财富，按类型分页，limitPerType=500）
        ├─ 事务写 screening_funds（保留已有富化列；删掉快照里消失的基金）
        ├─ 算行业标签（classifyFundIndustry）
        ├─ recomputeRanks()：按 fund_type 分组算百分位 → rank_pct_* + pass_4433
        └─ **默认不富化**（enrich_limit=0）→ 立即返回 total + risk_metrics_pending
     └─ 列表先渲染（POST /api/screening/query）
     └─ 后台 while (pending > 0) POST /api/screening/compute { limit: 300 }   ← 不阻塞首屏
        └─ 每批：取净值（getFundNavBatch，SQLite 缓存优先）→ computeRiskMetricsLocal → 写回
```

- `/sync` 不再绑定首批富化：冷启动首屏从「等 3 分钟」变成「等一次快照（几秒）」；
  富化期间 `syncing` 保持 true，状态条显示「正在计算风险指标...」且计数每 2s 刷新。

- 富化是**幂等且可续**的：中断后再次 `/compute` 会接着做剩下的（`risk_metrics_pending` 减少）；
  取不到净值的基金被标记 `risk_attempted=1`，不会无限重试（循环因此会收敛）。
- 全量首次富化约 3 分钟；**结果落库后，下次访问只需补新增基金**（不重算）。

## 查询

```
POST /api/screening/query { filters, sort_by, sort_order, page, page_size }
  → screeningService.queryScreening()
     ├─ 读全表（约 3300 行，**进程内缓存**；同步/富化/排名后失效）
     ├─ 过滤（语义与迁移前的前端实现逐条对齐，见 筛选面板）
     ├─ 排序（null 恒排最后）
     └─ 分页切片
```

筛选页、投研看板、pi 的 `screen_funds` 都走这一个入口，所以「页面看到的」与「模型看到的」是同一份数据。

## 状态与缓存位置

| 数据 | 位置 | 说明 |
|---|---|---|
| 基金清单 + 富化结果 | SQLite `screening_funds` | 唯一真源 |
| 同步时间 / 排名时间 | SQLite `screening_meta` | `sync_time`、`ranks_computed_at` |
| 净值得以算指标 | SQLite `nav_history` | 见 [数据流向](/architecture/data-flow) |
| 「上次同步时间」 | 浏览器 `localStorage` | 只是一个「要不要 force」的提示，不是数据 |

## 之前的问题（为什么改）

- 富化在浏览器：用户开着页面才能算；关掉页面就停；换台机器/换浏览器要重算。
- Dexie 与 service 两处都在「存基金」：口径容易分叉（例如 4433 算法、行业标签规则）。
- 全量指标重算要靠浏览器逐只发请求，页面关了就丢。
