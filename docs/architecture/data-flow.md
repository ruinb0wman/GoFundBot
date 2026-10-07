# 数据流向

按「谁发起 → 经过谁 → 落在哪」描述主要链路。组件职责见 [Node 核心架构](/architecture/node-core)。

## 实时数据（行情 / 板块 / 资金流 / 快讯）

```
页面 ──HTTP──> service route ──> ProviderChain ──(全挂)──> Python/akshare
                                   │
                            service 内存缓存（TTL 见 /api/health 的 cache）
```

- ProviderChain 逐个尝试（`service/src/providers/`），第一个通过校验的结果胜出；失败信息记在响应的 `meta.provider/fallback`。
- 反爬要点：东方财富系要带 `Referer`（`eastmoneyRequest.ts`），Yahoo 走代理，国内接口直连。
- 前端不再持有这些数据的持久缓存：页面每次进来重新拉（内存里按需缓存）。

## 基金数据（详情 / 净值 / 持仓 / 经理）

```
page / pi ──> service fundService ──> ProviderChain ──> （净值）SQLite nav_history 缓存
```

净值链路（`getFundNavHistory`）：

1. 查 `nav_history_meta` 的覆盖度（`fetched_through >= min(窗口终点, 今天)`，且窗口在过去或 24h 内取过）；
2. 命中 → 直接从 `nav_history` 按窗口切片返回；
3. 未命中 → 向 provider 拉**全量**序列 → 落库（按日期 upsert，只前进）→ 再切片返回。

**为什么按实体存整条序列**：provider 本来就只能全量返回；把查询区间写进缓存 key 会让「换个窗口」变成一次全量重拉。

## 基金筛选（唯一真源在 service）

```
页面 onMounted ──> GET /api/screening/sync ──> 拉快照(约 3300 只) → 写 screening_funds
                                            → 算行业标签 + 算 4433 排名
                                            → 富化首批风险指标（默认 300 只）
                ──> 循环 POST /api/screening/compute  直到 remaining = 0
                ──> POST /api/screening/query（过滤/排序/分页）
```

- 富化 = 取净值算风险指标（`computeRiskMetricsLocal`）后写回 `screening_funds`；取不到净值的基金打 `risk_attempted`，不再重试（循环必然收敛）。
- 4433 排名在 `recomputeRanks()` 里按 `fund_type` 分组算百分位（算法唯一实现在 `packages/core/src/screeningEnrich.ts`）。
- 快照为空时**不覆盖**已有缓存（数据源故障不清库）。

## 投研看板

```
页面 / pi ──> GET /api/research/dashboard ──> core buildDashboard(读 screening_funds)
```

汇总口径（`pass_4433` / `risk_ready` 及比率）由 core 算好；payload 不再携带全量基金行（曾经 1.6MB）。

## 用户数据（自选 / 持仓 / 策略 / 回测方案）

```
页面 / pi ──> /api/{watchlist,positions,strategies,backtest-scripts} ──> SQLite
```

- 前端 `db/{positions,strategyMemory,strategyScripts}.ts` 保留原导出签名、内部转发 HTTP。
- 旧 Dexie 数据由 `db/migrateToServer.ts` 一次性导入（localStorage flag + 服务端幂等，成功才清本地）。
- 写入后派发 `gofund:strategies-changed` / `watchlist-updated`，页面监听刷新。

## 回测（两条路，同一份引擎）

```
页面   ──> 浏览器 Worker（packages/core）            ──> 图表/明细
pi/脚本 ──> POST /api/agent/call: run_strategy_code ──> service node:worker_threads 沙箱 ──> 抽样结果
```

- 净值都取自 `/api/funds/:code/nav-history`（即上面的 SQLite 缓存）。
- 固定参数回测还有 `/api/backtest/{fixed-investment,portfolio,compare-strategies}`（参数沿用 snake_case，见 `packages/core/src/backtest/toolArgs.ts`）。
- 代码沙箱的隔离强度与确认流程见 [pi 工具面#代码回测](/architecture/pi-tools)。

## 搜索

`POST /api/search`（Exa → DuckDuckGo，**无需 key**）—— service 唯一的「AI 相关」能力；service 不做 LLM 调用。
