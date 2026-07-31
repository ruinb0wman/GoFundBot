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

## 研究模块

| 路由 | 服务函数 | ProviderChain | Cache TTL |
|------|---------|--------------|-----------|
| `GET /api/research/dashboard` | `getDashboard` | 混合 | 1h |
| `GET /api/research/industry-performance` | `getIndustryPerformance` | 筛选缓存聚合 | 次日 9AM |
| `GET /api/research/etf-tracking` | `getEtfTracking` | eastmoney only | 24h |
| `GET /api/research/sector-summary` | `getSectorSummary` | 混合 | 1h |

## AI 模块

| 路由 | 服务函数 | 数据源 |
|------|---------|--------|
| `POST /api/chat` | `chatService.processChat` | OpenAI SDK + chatTools(基金/行情/搜索) |
| `GET /api/funds/:code/analyze` | (fund router) → `aiAnalyst.analyzeFund` | OpenAI SDK + fundService |
| `POST /api/analysis-memory/reflect` | (analysisMemory router) | OpenAI SDK + Dexie history |

## 其他模块

| 路由 | 服务函数 | ProviderChain | Cache TTL |
|------|---------|--------------|-----------|
| `GET /api/news/flash` | `getFlashNews` | [eastmoney → baidu → cls] | 30s |
| `GET /api/stocks/:code/reference` | `getStockReference` | [eastmoney → tencent] | 7d |
| `POST /api/backtest/fixed-investment` | `runBacktest` | Python backtest.py | — |
| `GET /api/settings` | (settings router) | 内存缓存 | — |
| `GET /api/datasource-scores` | (datasource-scores router) | DataSourceScorer 内存 | — |
