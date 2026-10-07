# 基金筛选

基金筛选的**数据与计算都在 service**（SQLite 表 `screening_funds`），页面只负责展示与触发刷新。
迁移前的实现（前端 Dexie + 本地算指标）已删除，见文末。

## 数据从哪来

```
GET /api/screening/sync          拉基金快照（约 3300 只）→ 写 screening_funds
                                  + 算行业标签（packages/core industryClassifier）
                                  + 算 4433 排名（packages/core screeningEnrich）
                                  + 富化首批风险指标（默认 300 只）
POST /api/screening/compute      再富化一批（前端循环调用直到 remaining = 0）
POST /api/screening/ranks        只重算 4433 排名（无副作用）
POST /api/screening/query        筛选 + 排序 + 分页（页面与 pi 的工具都走它）
GET  /api/screening/status       计数：总数 / 有风险指标数 / 待富化数 / 4433 通过数 / 类型分布
GET  /api/screening/industry-tags  行业标签计数（筛选面板的标签列表）
GET  /api/screening/screen-rows  沙箱 `sdk.screen()` 用的 7 列（代码回测的基金池）
```

## 一份数据、三个消费者

| 消费者 | 用法 |
|---|---|
| 筛选面板（`/screening`） | `useScreeningDb`（薄 HTTP 客户端）→ `/sync` → 循环 `/compute` → `/query` |
| 投研看板（`/research`） | `GET /api/research/dashboard`（core `buildDashboard` 读同一张表） |
| pi | 工具 `screen_funds` / `get_screening_status` / `get_research_dashboard` |

## SQLite 表 `screening_funds`

| 列组 | 内容 |
|---|---|
| 原始 | `fund_code` `fund_name` `fund_type` `return_1m/3m/6m/1y/2y/3y` `ytd` `since_inception` `fee` `nav` `nav_date` `source` `updated_time` |
| 富化 | `max_drawdown_1y` `sharpe_ratio_1y` `sharpe_ratio_3y` `volatility_1y` `calmar_ratio_1y` `industry_tag_name` |
| 排名 | `rank_pct_1m/3m/6m/1y/2y/3y` `pass_4433` |
| 控制 | `risk_attempted`（取过净值但没算出指标 → 1，避免反复重试） |

`screening_meta` 存 `sync_time` 与 `ranks_computed_at`。

## 更新语义（几个刻意的选择）

- **快照为空不覆盖**：数据源故障时保留旧库，前端只看到「未变化」。
- **保留已有富化列**：重复同步不会把算好的风险指标冲掉；`industry_tag_name` 用 `COALESCE` 保留旧值。
- **分批富化**：一次 300 只（≈15s）；全量首次约 3 分钟（3331 只 × ~49ms，并发 10）。分批才能报进度、不撞超时。
- **消失的基金会被删掉**：快照里没有的代码从表里移除（与迁移前「清空重写」语义一致）。

## 页面侧

- 刷新时机：`onMounted` 时看 `localStorage` 里的 `lastSyncTime`，过期（当天 9 点前）就 `force=true` 全量刷新。
- 筛选面板的过滤条件原样传给 `/query`；**过滤语义见 [筛选面板](/fund-screening/filter-system)**。
- 4433 怎么算见 [4433 法则](/fund-screening/4433-rule)；富化细节见 [指标丰富化](/fund-screening/enrichment)。

## 迁移前是什么样（历史）

前端 `useScreeningDb.ts` 自己拉快照写 Dexie、逐只算风险指标、按 `fund_type` 算 4433、本地过滤分页
（约 400 行）；4433 算法与过滤语义因此有「前端一份、可能的 service 一份」两份实现的风险，且刷新要浏览器在线。
现在算法唯一实现在 `packages/core/src/screeningEnrich.ts`，过滤语义唯一实现在 `screeningService.queryScreening()`。
