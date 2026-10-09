# 各模块数据源映射

## 基金模块

| 路由 | 服务函数 | ProviderChain | Cache TTL |
|------|---------|--------------|-----------|
| `GET /api/funds/search?q=` | `searchFunds` | eastmoney only (搜索索引内存缓存) | 24h |
| `GET /api/funds/estimates?codes=` | `getFundEstimates` | [stock-sdk → eastmoney] | 30s |
| `GET /api/funds/:code/estimate` | `getFundEstimate` | [stock-sdk → eastmoney] + validation | 30s |
| `GET /api/funds/:code/nav-history` | `getFundNavHistory` | [stock-sdk → eastmoney] | 24h |
| `GET /api/funds/:code/rank-history` | `getFundRankHistory` | [stock-sdk → eastmoney] | 24h |
| `GET /api/funds/:code/dividends` | `getFundDividends` | [stock-sdk → eastmoney] | 7d |
| `GET /api/funds/:code/basic` | `getFundBasic` | eastmoney only | 24h |
| `GET /api/funds/:code/detail` | `getFundDetail` | 混合（16 sections 并行） | 按 section |
| `GET /api/funds/:code/holdings` | `getFundHoldings` | eastmoney only | 24h |
| `GET /api/funds/:code/managers` | `getFundManagers` | eastmoney only | 24h |
| `GET /api/funds/:code/asset-allocation` | `getFundAssetAllocation` | eastmoney only | 24h |
| `GET /api/funds/:code/holder-structure` | `getFundHolderStructure` | eastmoney only | 24h |
| `GET /api/funds/:code/position-trend` | `getFundPositionTrend` | eastmoney only | 24h |
| `GET /api/funds/:code/scale-fluctuation` | `getFundScaleFluctuation` | eastmoney only | 24h |
| `GET /api/funds/:code/total-return-trend` | `getFundTotalReturnTrend` | [eastmoney → tencent → stock-sdk] | 24h |
| `GET /api/funds/:code/industry-exposure` | (fund router) | 混合 | — |

## 市场模块

| 路由 | 服务函数 | ProviderChain | Cache TTL |
|------|---------|--------------|-----------|
| `GET /api/market/overview` | `getMarketOverview` | 混合 | 15s~1h |
| `GET /api/market/indices` | `getMarketIndices` | [tencent → stock-sdk → eastmoney] | 15s |
| `GET /api/market/indices/combined` | `getCombinedIndices` | [tencent → stock-sdk → eastmoney] + [tencent → eastmoney → yahoo] | 15s |
| `GET /api/market/sectors` | `getMarketSectorsFromAkshare` | eastmoney（`push2 .../clist/get`，**直连可用但会限流**）→ akshare python fallback（同花顺行业） | 15s（eastmoney 结果） |
| `GET /api/market/concept-sectors` | `getMarketConceptSectorsFromAkshare` | akshare python only（同花顺概念资金流 + 概念简介） | 行情每次现取（~2s）；驱动事件 24h file_cache |
| `GET /api/market/kline/:code` | `getMarketKline` | [joinquant → tencent → stock-sdk → eastmoney]（现命中 tencent newfqkline） | 1h |
| `GET /api/market/money-flow` | `getMarketMoneyFlow` | eastmoney → akshare python fallback | 30s |
| `GET /api/market/breadth` | `getMarketBreadth` | eastmoney only（`ulist.np/get` 的 f104/f105/f106 沪深合计 + push2ex 涨跌停池） | 15s |
| `GET /api/market/north-flow` | `getNorthFlow` | eastmoney datacenter → akshare python fallback | 5min |
| `GET /api/market/gold/realtime` | `getGoldRealtime` | eastmoney → akshare python | 60s |
| `GET /api/market/gold/history` | `getGoldHistory` | eastmoney → akshare python | 1h |
| `GET /api/market/kline/global/:symbol` | `getGlobalIndexKline` | [tencent → yahoo] | 1h |
| `GET /api/market/breadth` | `getMarketBreadth` | eastmoney（`ulist.np/get`，端点级熔断） | 15s（仅 `data_status: 'available'` 时缓存） |
| `GET /api/market/crypto` | `getCryptoQuotes` | [binance]（Yahoo 已弃） | 15s |

## 筛选模块

| 路由 | 服务函数 | ProviderChain | Cache TTL |
|------|---------|--------------|-----------|
| `GET /api/screening/sync` | (screening router) | eastmoney screeningSnapshot | 次日 9AM |
| `POST /api/screening/query` | `screeningService.queryScreening` | SQLite `screening_funds`（过滤/排序/分页都在这里） | — |
| `GET /api/screening/fund/:code` | (screening router) | enrichFund(Nav + type + risk + industry) | 24h |

## 研究模块

`GET /api/research/dashboard` → `researchService.getResearchDashboard()` → `packages/core buildDashboard()`，
数据来自 SQLite `screening_funds`（不再需要前端聚合，也不再取板块行情 —— `buildDashboard` 的 `sectors`
参数与 `buildResearchSectorSummary()` 都是零调用死代码，已删）。

| 区块 | 数据源 |
|---|---|
| 市场统计 / 基金看板 / ETF / 行业表现 | SQLite `screening_funds` 聚合（core） |

## AI 模块 → 终端 pi

> 前端 AI（`chatEngine/`、`fundAnalyst.ts`、`portfolioAnalyst.ts`、`reflection.ts`、`strategyDraft.ts`）
> 与 service 的 LLM 网关（`/api/llm/*`）**均已删除**。AI 由终端 pi 承担，service 只提供工具面。

| 能力 | 现在怎么做 |
|---|---|
| 对话 + 工具调用 | pi 会话，工具来自 `GET /api/agent/tools`（27 个） |
| 基金/持仓分析 | pi 组合工具：`get_fund_detail` + `get_positions` + `run_backtest` + `list_strategies` |
| 策略起草/更新 | `list_strategies` → 展示方案 → 用户确认 → `save_strategy`（带确认令牌） |
| 联网搜索 | `POST /api/search`（Exa → DuckDuckGo，无需 key）；pi 侧也可用自带 `web_search` |

细节见 [pi 工具面](/architecture/pi-tools)。

## 其他模块

| 路由 | 服务函数 | ProviderChain | Cache TTL |
|------|---------|--------------|-----------|
| `GET /api/news/flash` | `getFlashNews` | [eastmoney → baidu → cls] | 30s |
| `GET /api/stocks/:code/reference` | `getStockReference` | [eastmoney → tencent] | 7d |
| `POST /api/backtest/{fixed-investment,portfolio,compare-strategies}` | `backtestService` | 走 `packages/core` 引擎 + 净值 SQLite 缓存 | 净值 24h |
| `GET /api/settings` | `settingsService` | 仅 proxy 子域（SQLite `settings`） | — |
| `POST /api/agent/call` | `agent/tools.ts` | 工具面（27 个，直接调内部函数） | — |
