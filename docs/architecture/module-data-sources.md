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
| `GET /api/market/indices/combined` | `getCombinedIndices` | [tencent → stock-sdk → eastmoney] + [eastmoney → yahoo] | 15s |
| `GET /api/market/sectors` | `getMarketSectors` | eastmoney only | 15s |
| `GET /api/market/kline/:code` | `getMarketKline` | [stock-sdk → eastmoney] | 1h |
| `GET /api/market/money-flow` | `getMarketMoneyFlow` | eastmoney → akshare python fallback | 30s |
| `GET /api/market/breadth` | `getMarketBreadth` | eastmoney only | 15s |
| `GET /api/market/north-flow` | `getNorthFlow` | eastmoney only | 15s |
| `GET /api/market/limit-up` | `getLimitUpStocks` | eastmoney only | 30s |
| `GET /api/market/gold/realtime` | `getGoldRealtime` | eastmoney → akshare python | 60s |
| `GET /api/market/gold/history` | `getGoldHistory` | eastmoney → akshare python | 1h |
| `GET /api/market/kline/global/:symbol` | `getGlobalIndexKline` | [yahoo] | 1h |

## 筛选模块

| 路由 | 服务函数 | ProviderChain | Cache TTL |
|------|---------|--------------|-----------|
| `GET /api/screening/sync` | (screening router) | eastmoney screeningSnapshot | 次日 9AM |
| `POST /api/screening/query` | (screening router) | 前端 Dexie + 富化数据（**deprecated**） | — |
| `GET /api/screening/fund/:code` | (screening router) | enrichFund(Nav + type + risk + industry) | 24h |

## 研究模块（已前端化）

> `/api/research/*` 已撤销。看板聚合在前端 `researchComputation.ts` 完成：
> 数据 = Dexie `screeningFunds`（`/api/screening/sync` 同步）+ `/api/market/sectors`。

| 目录 | 数据源 | 备注 |
|------|--------|------|
| 市场统计 / 基金看板 / ETF / 行业表现 | Dexie screeningFunds 聚合 | 前端计算 |
| 板块汇总 | `/api/market/sectors` | 前端 `buildResearchSectorSummary` |

## AI 模块（已前端化）

> `/api/chat`、`/api/fund/:code/analyze`、`/api/user/portfolio/analyze`、`/api/analysis-memory`、
> `/api/strategy/draft` 均已撤销，改为前端直调 LLM（`llm.ts`）+ 前端对话引擎（`chatEngine/`）。

| 能力 | 前端实现 | 数据源 |
|------|---------|--------|
| AI 对话 + 工具调用 | `chatEngine/`（skills/tools/toolHandlers） | Node API（基金/行情/回测）+ 本地计算 + 前端搜索 |
| 基金分析（4+1） | `fundAnalyst.ts` | Node `/api/fund*` + 前端 LLM |
| 持仓诊断 | `portfolioAnalyst.ts` | Node `/api/fund*` + 前端 LLM |
| 分析反思 | `reflection.ts` | 前端 LLM |
| 策略起草 | `strategyDraft.ts` | 前端 LLM |

## 其他模块

| 路由 | 服务函数 | ProviderChain | Cache TTL |
|------|---------|--------------|-----------|
| `GET /api/news/flash` | `getFlashNews` | [eastmoney → baidu → cls] | 30s |
| `GET /api/stocks/:code/reference` | `getStockReference` | [eastmoney → tencent] | 7d |
| `POST /api/backtest/fixed-investment` | `runBacktest` | Python backtest.py | — |
| `GET /api/settings` | (settings router) | 仅 proxy 子域 | — |
