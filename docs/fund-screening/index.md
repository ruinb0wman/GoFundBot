# 基金筛选 (Fund Screening)

## 一、概述

提供多维度的基金筛选功能，支持按基金类型、行业板块、收益指标、风险指标（夏普比率、最大回撤、卡玛比率等）进行筛选，支持 4433 法则标记和同类排名百分位展示。所有数据通过后端从东方财富接口拉取并丰富后，存储在浏览器 IndexedDB 中。

## 二、数据流概览

```
EastMoney rankhandler API
  ↓ GET https://fund.eastmoney.com/data/rankhandler.aspx
Express 后端 -> screening.routes.ts
  ↓ getFundScreeningSnapshot() 缓存到次日9AM
  ↓ 合并 enrichmentMap (若有)
GET /api/screening/sync
  ↓
前端 syncFromServer()
  ├→ bulkPut 写入 IndexedDB (基础数据)
  ├→ POST /api/funds/nav-batch → 批量 NAV 历史
  ├→ 前端 computeRiskMetricsLocal(navs) → 风险指标
  ├→ bulkPut 写回 IndexedDB (含风险指标)
  └→ compute4433() 同类排名百分位
  ↓
useFundScreening 筛选面板 → 本地 queryFunds() 过滤 + 排序 + 分页
```

## 三、关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| Route | `service/src/routes/screening.routes.ts` | 所有 `/api/screening/*` 端点 |
| Route | `service/src/routes/fund.routes.ts:50` | `POST /api/funds/nav-batch` 批量 NAV 接口 |
| service | `service/src/services/fundService.ts:136` | `getFundScreeningSnapshot()` |
| service | `service/src/services/fundService.ts:198` | `getFundNavBatch()` 批量 NAV 获取 |
| frontend 计算 | `frontend/src/services/industryClassifier.ts` | `classifyFundIndustry()`（行业分类，已前端化） |
| frontend 计算 | `frontend/src/utils/number.ts:187` | `computeRiskMetricsLocal()`（风险指标，Golden 对齐旧服务端实现） |
> 风险指标 / 行业分类已迁移前端：原始 `/api/screening/sync` → 前端 `computeRiskMetricsLocal` +
> `classifyFundIndustry` → 写入 Dexie `screeningFunds`。Node 端 `screeningEnrichment` / `riskMetricsService` /
> `industryService` / `enrichFund()` 已删除。
| service | `service/src/core/providerChain.ts:9` | `ProviderChain` 多提供商降级 |
| Provider | `service/src/providers/eastmoney/eastmoneyFundProvider.ts:230` | `screeningSnapshot()` 排行数据 |
| frontend API | `frontend/src/services/api.ts:59` | `screeningAPI` |
| frontend API | `frontend/src/services/api.ts:53` | `fundAPI.getNavBatch()` 批量 NAV 调用 |
| frontend Composable | `frontend/src/composables/useFundScreening.ts` | 筛选面板状态逻辑 |
| frontend Composable | `frontend/src/composables/useScreeningDb.ts` | IndexedDB 读写 + 风险指标补齐 + 4433 计算 |
| frontend Util | `frontend/src/utils/number.ts:188` | `computeRiskMetricsLocal()` 本地风险指标计算 |
| frontend 渲染 | `frontend/src/components/FundScreening.vue` | 页面模板 |
| Dexie 表 | `frontend/src/db/index.ts:90` | `ScreeningFund` schema |

## 四、API 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/screening/status` | enrichmentMap 状态 |
| GET | `/api/screening/sync` | 同步全量数据（`?force=true` 强制刷新） |
| GET | `/api/screening/progress` | 后台更新进度 |
| POST | `/api/screening/update` | 启动后台更新任务 |
| POST | `/api/screening/stop` | 停止后台更新 |
| POST | `/api/screening/query` | 条件查询（**deprecated**，前端已改用本地 IndexedDB 查询） |
| GET | `/api/screening/strategies` | 筛选策略列表 |
| POST | `/api/screening/available-types` | 可用基金类型列表 |
| GET | `/api/screening/industry-tags` | 行业标签分组 |
| POST | `/api/screening/fill-risk` | 补充缺失的风险指标（遗留） |
| POST | `/api/screening/update-single/:code` | 单只基金更新（遗留） |
| POST | `/api/screening/recalculate-rankings` | 重算排名（客户端侧实现） |
| POST | `/api/funds/nav-batch` | 批量 NAV 历史（前端计算风险指标用） |

## 五、IndexedDB Schema

`db.screeningFunds` 表（`frontend/src/db/index.ts:90`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `fund_code` | string | 6位基金代码 (主键) |
| `fund_name` | string | 基金名称 |
| `fund_type` | string\|null | 基金类型 |
| `return_1m..3y` | number\|null | 各区间收益率 |
| `nav` | number\|null | 单位净值 |
| `nav_date` | string\|null | 净值日期 |
| `max_drawdown_1y` | number\|null | 近1年最大回撤 |
| `sharpe_ratio_1y/3y` | number\|null | 夏普比率 |
| `volatility_1y` | number\|null | 年化波动率 |
| `calmar_ratio_1y` | number\|null | 卡玛比率 |
| `industry_tag_name` | string\|null | 行业标签 |
| `rank_pct_1m..3y` | number\|null | 同类排名百分位 |
| `pass_4433` | number | 4433法则标记 (0/1) |
| `updated_time` | string\|null | 更新时间 |

索引：`fund_code, fund_type, pass_4433, updated_time`
