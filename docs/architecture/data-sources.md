# 数据源

> 详细 Provider 能力对照见 [`data-sources-and-runtime.md`](../data-sources-and-runtime)。

## 基金数据 (FundProviders)

| Provider | 实现文件 | 数据来源 | 提供的能力 |
|----------|----------|---------|-----------|
| **stock-sdk** (主) | `Service/src/providers/stock-sdk/stockSdkFundProvider.ts` | npm `stock-sdk` 包 | `estimate`, `navHistory`, `rankHistory`, `dividends` |
| **eastmoney** (备) | `Service/src/providers/eastmoney/eastmoneyFundProvider.ts` | `fund.eastmoney.com` `fundgz.1234567.com.cn` | 同上 + `search`, `basic`, `holdings`, `managers`, `assetAllocation`, `performance`, `screeningSnapshot`, `subscriptionRedemption`, `holderStructure`, `scaleFluctuation`, `positionTrend`, `totalReturnTrend` |
| **Python fetch_fund** | `Scripts/cli/fetch_fund.py` | `fund.eastmoney.com` (requests) | 基金详情批量爬取 |

## 市场/行情数据 (MarketProviders)

| Provider | 实现文件 | 数据来源 | 提供的能力 |
|----------|----------|---------|-----------|
| **stock-sdk** (主) | `Service/src/providers/stock-sdk/stockSdkMarketProvider.ts` | npm `stock-sdk` 包 | `quotes`, `kline`, `indices` |
| **eastmoney** (备) | `Service/src/providers/eastmoney/eastmoneyMarketProvider.ts` | `push2.eastmoney.com` `push2his.eastmoney.com` | `quotes`, `kline`, `sectors`, `sectorConstituents`, `indices`, `moneyFlow`, `marketMoneyFlow`, `breadth`, `limitUpStocks`, `northFlow`, `globalIndices` |
| **yahoo** (全球) | `Service/src/providers/yahoo/yahooMarketProvider.ts` | Yahoo Finance API | 全球指数 K 线 |

## 股票数据 (StockProviders)

| Provider | 实现文件 | 数据来源 | 能力 |
|----------|----------|---------|------|
| **eastmoney** | `Service/src/providers/eastmoney/eastmoneyStockProvider.ts` | `push2.eastmoney.com` | `reference` (代码/名称/行业/概念) |
| **tencent** | `Service/src/providers/tencent/tencentStockProvider.ts` | `qt.gtimg.cn` (GBK) | `reference` (仅 A 股) |

## 新闻 (NewsProviders)

| Provider | 实现文件 | 数据来源 |
|----------|----------|---------|
| **eastmoney** | `Service/src/providers/eastmoney/eastmoneyNewsProvider.ts` | `newsapi.eastmoney.com` |
| **baidu** | 同上 | `finance.pae.baidu.com` |
| **cls (财联社)** | 同上 | `www.cls.cn` |

## 网络搜索 (SearchService)

| 引擎 | 文件 | 来源 | 优先级 |
|------|------|------|--------|
| **Bocha** | `Service/src/services/searchService.ts` | `api.bocha.cn/v1/web-search` | 1 (需 API Key) |
| **Tavily** | 同上 | `api.tavily.com/search` | 2 (需 API Key) |
| **DuckDuckGo** | 同上 | `api.duckduckgo.com` | 3 (免费，兜底) |

## Python 脚本数据来源

| 脚本 | 文件 | 来源 | 能力 |
|------|------|------|------|
| **fetch_fund** | `Scripts/cli/fetch_fund.py` | `fund.eastmoney.com` (requests) | 单只/批量基金 NAV 历史、基本数据 |
| **backtest** | `Scripts/cli/backtest.py` | stdin (NAV 数据由 Node.js 传入) | 定投回测（月/周/一次性）、止盈止损、夏普率计算 |
| **data_complete** | `Scripts/cli/data_complete.py` | `akshare` Python 库 | A 股列表、行业板块映射、大盘资金流向回退 |
