# 数据源

> 详细 Provider 能力对照见 [`data-sources-and-runtime.md`](../data-sources-and-runtime)。

## 基金数据 (FundProviders)

| Provider | 实现文件 | 数据来源 | 提供的能力 |
|----------|----------|---------|-----------|
| **stock-sdk** (主) | `service/src/providers/stock-sdk/stockSdkFundProvider.ts` | npm `stock-sdk` 包 | `estimate`, `navHistory`, `rankHistory`, `dividends` |
| **eastmoney** (备) | `service/src/providers/eastmoney/eastmoneyFundProvider.ts` | `fund.eastmoney.com` `fundgz.1234567.com.cn` | 同上 + `search`, `basic`, `holdings`, `managers`, `assetAllocation`, `performance`, `screeningSnapshot`, `subscriptionRedemption`, `holderStructure`, `scaleFluctuation`, `positionTrend`, `totalReturnTrend` |
| **Python fetch_fund** | `python/cli/fetch_fund.py` | `fund.eastmoney.com` (requests) | 基金详情批量爬取 |

## 市场/行情数据 (MarketProviders)

| Provider | 实现文件 | 数据来源 | 提供的能力 |
|----------|----------|---------|-----------|
| **tencent** | `service/src/providers/tencent/tencentMarketProvider.ts` | `qt.gtimg.cn` `proxy.finance.qq.com` | `quotes`, `kline`（腾讯 newfqkline，含成交额） |
| **stock-sdk** (主) | `service/src/providers/stock-sdk/stockSdkMarketProvider.ts` | npm `stock-sdk` 包 | `quotes`, `kline`（`push2his`，当前被反爬切断）, `indices` |
| **eastmoney** (备) | `service/src/providers/eastmoney/eastmoneyMarketProvider.ts` | `push2.eastmoney.com` `push2his.eastmoney.com` `push2ex.eastmoney.com` `datacenter-web.eastmoney.com` | `quotes`, `kline`, `sectors`, `sectorConstituents`, `indices`, `moneyFlow`, `marketMoneyFlow`, `breadth`（`marketBreadth.ts`）, `northFlow`（`marketNorthFlow.ts`，走 datacenter）, `globalIndices` |
| **yahoo** (全球) | `service/src/providers/yahoo/yahooMarketProvider.ts` | Yahoo Finance API | 全球指数 K 线 |

## 股票数据 (StockProviders)

| Provider | 实现文件 | 数据来源 | 能力 |
|----------|----------|---------|------|
| **eastmoney** | `service/src/providers/eastmoney/eastmoneyStockProvider.ts` | `push2.eastmoney.com` | `reference` (代码/名称/行业/概念) |
| **tencent** | `service/src/providers/tencent/tencentStockProvider.ts` | `qt.gtimg.cn` (GBK) | `reference` (仅 A 股) |

## 新闻 (NewsProviders)

| Provider | 实现文件 | 数据来源 |
|----------|----------|---------|
| **eastmoney** | `service/src/providers/eastmoney/eastmoneyNewsProvider.ts` | `newsapi.eastmoney.com` |
| **baidu** | 同上 | `finance.pae.baidu.com` |
| **cls (财联社)** | 同上 | `www.cls.cn` |

## 网络搜索 (SearchService)

| 引擎 | 文件 | 来源 | 优先级 |
|------|------|------|--------|
| **Exa** | `service/src/ai/search.ts` | MCP/JSON-RPC | 1（免费、无需 key） |
| **DuckDuckGo** | 同上 | `api.duckduckgo.com` | 2（兜底） |

接口：`POST /api/search`（service 唯一的"AI 相关"能力，仍不需要任何密钥）。

## Python 脚本数据来源

| 脚本 | 文件 | 来源 | 能力 |
|------|------|------|------|
| **fetch_fund** | `python/cli/fetch_fund.py` | `fund.eastmoney.com` (requests) | 单只/批量基金 NAV 历史、基本数据 |
| ~~**backtest**~~ | ~~`python/cli/backtest.py`~~ | — | **已删除（2026-09-29）**：回测引擎现在在 `packages/core/src/backtest/`，前端与 service 共用 |
| **data_complete** | `python/cli/data_complete.py` | `akshare` Python 库 | A 股列表、行业板块映射、行业板块行情回退（`sector_spot`→同花顺）、概念板块行情+驱动事件（`concept_spot`→同花顺）、大盘资金流向回退 |
