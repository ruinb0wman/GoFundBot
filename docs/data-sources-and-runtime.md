# GoFundBot 数据来源 / 核心函数 / 运行时总览

---

## 一、运行时分布

| 运行时 | 位置 | 角色 |
|--------|------|------|
| **Node.js (TS)** | `service/src/` | Express 后端 (port 8310)，ProviderChain 编排、缓存、业务逻辑、AI 对话 |
| **Node.js (TS)** | `frontend/src/` | Vue 3 前端 (port 8517)，IndexedDB (Dexie.js) 本地持久化 |
| **Python 3** | `python/cli/` | 工具脚本，由 `pythonRunner.ts` 通过 `child_process.spawn()` 调用 |

---

## 二、数据来源一览

### 2.1 基金数据 (FundProviders)

| Provider | 文件 | 来源 API | 提供的能力 |
|----------|------|---------|-----------|
| **stock-sdk** (主) | `service/src/providers/stock-sdk/stockSdkFundProvider.ts` | npm `stock-sdk` 包 | `estimate`, `navHistory`, `rankHistory`, `dividends` |
| **eastmoney** (备) | `service/src/providers/eastmoney/eastmoneyFundProvider.ts` | `fund.eastmoney.com` `fundgz.1234567.com.cn` | 同上 + `search`, `basic`, `holdings`, `managers`, `assetAllocation`, `performance`, `screeningSnapshot`, `subscriptionRedemption`, `holderStructure`, `scaleFluctuation`, `positionTrend`, `totalReturnTrend` |
| **Python fetch_fund** | `python/cli/fetch_fund.py` | `fund.eastmoney.com` (requests) | 基金详情批量爬取 |

### 2.2 市场/行情数据 (MarketProviders)

| Provider | 文件 | 来源 API | 提供的能力 |
|----------|------|---------|-----------|
| **stock-sdk** (主) | `service/src/providers/stock-sdk/stockSdkMarketProvider.ts` | npm `stock-sdk` 包 | `quotes`, `kline`, `indices` (上证/深证/创业板/沪深300/科创50) |
| **eastmoney** (备) | `service/src/providers/eastmoney/eastmoneyMarketProvider.ts` | `push2.eastmoney.com` `push2his.eastmoney.com` | `quotes`, `kline`, `sectors`, `sectorConstituents`, `indices`, `moneyFlow`, `marketMoneyFlow`, `breadth`, `limitUpStocks`, `northFlow`, `globalIndices` |
| **yahoo** (全球) | `service/src/providers/yahoo/yahooMarketProvider.ts` | Yahoo Finance API | 全球指数 K 线 (美股/港股等) |

### 2.3 股票数据 (StockProviders)

| Provider | 文件 | 来源 API | 能力 |
|----------|------|---------|------|
| **eastmoney** | `service/src/providers/eastmoney/eastmoneyStockProvider.ts` | `push2.eastmoney.com` | `reference` (代码/名称/行业/概念) |
| **tencent** | `service/src/providers/tencent/tencentStockProvider.ts` | `qt.gtimg.cn` (GBK) | `reference` (仅 A 股，不支持港股) |

### 2.4 新闻/快讯 (NewsProviders)

| Provider | 文件 | 来源 API |
|----------|------|---------|
| **eastmoney** | `service/src/providers/eastmoney/eastmoneyNewsProvider.ts` | `newsapi.eastmoney.com` |
| **baidu** | 同上（BaiduNewsProvider） | `finance.pae.baidu.com` |
| **cls (财联社)** | 同上（ClsNewsProvider） | `www.cls.cn` |

### 2.5 网络搜索 (Chat AI 联网搜索)

| 引擎 | 文件 | 来源 | 优先级 |
|------|------|------|--------|
| **Bocha** | `service/src/services/searchService.ts` | `api.bocha.cn/v1/web-search` | 1 (需 API Key) |
| **Tavily** | 同上 | `api.tavily.com/search` | 2 (需 API Key) |
| **DuckDuckGo** | 同上 | `api.duckduckgo.com` | 3 (免费，兜底) |

### 2.6 Python 脚本数据来源

| 脚本 | 文件 | 来源 | 能力 |
|------|------|------|------|
| **fetch_fund** | `python/cli/fetch_fund.py` | `fund.eastmoney.com` (requests) | 单只/批量基金 NAV 历史、基本数据 |
| **backtest** | `python/cli/backtest.py` | stdin (NAV 数据由 Node.js 传入) | 定投回测（月/周/一次性）、止盈止损、夏普率计算 |
| **data_complete** | `python/cli/data_complete.py` | `akshare` Python 库 | A 股列表、行业板块映射 |

---

## 三、核心函数（Node.js Runtime）

### 3.1 核心架构基础设施

| 函数/类 | 文件 | 职责 |
|---------|------|------|
| `ProviderChain<P>` | `service/src/core/providerChain.ts:8` | 多 Provider 链式调用，自动降级（主→备→...→抛错） |
| `MemoryCache` / `cacheThrough` | `service/src/core/cache.ts:13` / `:133` | 内存缓存 (TTL)，缓存穿透保护 |
| `runPython<T>` | `service/src/services/pythonRunner.ts:32` | 通用 Python 脚本调用 (child_process) |
| `runBacktest<T>` | `service/src/services/pythonRunner.ts:120` | backtest.py 专用封装 |

### 3.2 基金核心服务 (`service/src/services/fundService.ts`)

| 函数 | 职责 | Provider 链 |
|------|------|-----------|
| `getFundEstimate` | 实时估值 | stock-sdk → eastmoney (TTL 30s) |
| `getFundNavHistory` | NAV 历史 | stock-sdk → eastmoney (TTL 24h) |
| `getFundRankHistory` | 同类排名历史 | stock-sdk → eastmoney (TTL 24h) |
| `getFundDividends` | 分红记录 | stock-sdk → eastmoney (TTL 7d) |
| `getFundBasic` | 基金基本信息 | eastmoney only |
| `getFundDetail` | 聚合 15 个子模块 | 混合 Provider |
| `getFundScreeningSnapshot` | 基金筛选快照 | eastmoney only |
| `searchFunds` | 基金搜索 | eastmoney only |

### 3.3 市场核心服务 (`service/src/services/marketService.ts`)

| 函数 | 职责 | Provider 链 |
|------|------|-----------|
| `getMarketQuotes` | 行情报价 | stock-sdk → eastmoney (TTL 15s) |
| `getMarketKline` | A 股 K 线 | stock-sdk → eastmoney (TTL 1h) |
| `getGlobalIndexKline` | 全球指数 K 线 | yahoo only |
| `getMarketIndices` | 主要指数 | stock-sdk → eastmoney |
| `getMarketSectors` | 板块排行 | eastmoney only |
| `getSectorConstituents` | 板块成分股 | eastmoney only |
| `getMarketBreadth` | 涨跌家数 | eastmoney (TTL 15s) |
| `getNorthFlow` | 北向资金 | eastmoney (TTL 15s) |
| `getGoldRealtime` | 黄金实时行情 | eastmoney/akshare (TTL 60s) |
| `getGoldHistory` | 黄金历史走势 | eastmoney/akshare (TTL 1h) |
| `getMoneyFlow` | 个股资金流向 | eastmoney (TTL 30s) |
| `getMarketMoneyFlow` | 大盘资金流向 | eastmoney (TTL 30s) |
| `getLimitUpStocks` | 涨停股列表 | eastmoney (TTL 30s) |

### 3.4 计算/分析模块（已迁移前端）

| 函数 | 文件 | 职责 |
|------|------|------|
| `computeRiskMetricsLocal` | `frontend/src/.../utils/number.ts` | 最大回撤、夏普比率、波动率、Calmar 比率（前端计算，Golden 对齐旧 `riskMetricsService`） |
| `classifyFundIndustry` | `frontend/src/services/industryClassifier.ts` | 正则匹配基金名称→行业标签（19 个类别） |
| 筛选丰富化 | `useScreeningDb` + `industryClassifier` | 原始 /api/screening + NAV → 风险指标 + 行业分类 → Dexie |

### 3.5 AI / 搜索模块（已迁移前端）

| 函数/类 | 文件 | 职责 |
|---------|------|------|
| `SkillRouter` / `SKILL_DEFINITIONS` | `frontend/src/services/chatEngine/skills.ts` | 意图路由（关键词匹配 + LLM 路由），支持 8 种技能 |
| `TOOL_DEFINITIONS` / `toolHandlers` | `frontend/src/services/chatEngine/tools.ts` + `toolHandlers.ts` | Function Calling 工具集（查基金、行情、筛选等） |
| `searchWeb` | `frontend/src/services/searchService.ts` | 搜索引擎链（Exa→Bocha→Tavily→DDG 自动降级） |
| `analyzeFund` / `analyzeFundStream` | `frontend/src/services/fundAnalyst.ts` | AI 基金分析（前端直调 LLM） |

### 3.6 前端聚合计算（原 `researchService.ts`）

| 函数 | 职责 |
|------|------|
| `buildDashboard` | 研究仪表盘（前端 `frontend/src/services/researchComputation.ts`） |
| `buildResearchEtfTracking` | ETF 跟踪（前端） |
| `buildResearchIndustryPerformance` | 行业板块表现（前端） |
| `buildResearchSectorSummary` | 板块汇总（前端） |
| `buildResearchFundDashboard` / `buildResearchMarketStats` | 基金看板 / 市场统计（前端） |

### 3.7 新闻服务 (`service/src/services/newsService.ts`)

| 函数 | 职责 |
|------|------|
| `getFlashNews` | 聚合快讯（EastMoney → Baidu → Cls 自动降级） |

---

## 四、核心函数（Python Runtime）

### 4.1 回测 (`python/cli/backtest.py`)

| 函数 | 职责 |
|------|------|
| `main` | 从 stdin 读取输入，解析参数 |
| `_run_backtest` | 核心计算：定投模拟(月/周/一次性)、止盈止损、最大回撤、夏普率、年化收益 |

输入 (stdin): `{ fundCode, navHistory, investmentType, amount, initialAmount, feeRate, takeProfitRate, stopLossRate }`

输出 (stdout): `{ success, data: { summary, timeline } }`

### 4.2 基金爬取 (`python/cli/fetch_fund.py`)

| 函数 | 职责 |
|------|------|
| `main` | 解析 --code/--all 参数 |
| `fetch_fund` | 单只基金详情（NAV 历史、累计净值、业绩数据） |
| `fetch_fund_list` | 全市场基金列表 |
| `fetch_fund_detail_js` | 请求 pingzhongdata JS 文件 |
| `parse_js_variable` | 解析 JS 变量为 JSON |

输出 (stdout): `{ success, data: { funds: [...], total } }`

### 4.3 数据补全 (`python/cli/data_complete.py`)

| 函数 | 职责 | 来源 |
|------|------|------|
| `main` | 解析 --source/--type 参数 | - |
| `complete_stock_list` | A 股全列表 | `akshare.stock_zh_a_spot_em()` |
| `complete_industry_mapping` | 行业板块映射 | `akshare.stock_board_industry_name_ths()` |

输出 (stdout): `{ success, data: { stocks: [...], industry: [...] } }`

---

## 五、数据流核心路径

```
用户请求 → Express Route → service Layer (fund/market/research/chat)
  → ProviderChain.run(operation, provider => provider.method())
    → stock-sdk (主) 成功? → 返回 + 缓存
    → stock-sdk 失败? → eastmoney (备) → 返回 (fallback=true)
    → 全部失败? → AppError(503)

  → cacheThrough(key, TTL, loader)
    → 缓存命中? → 返回缓存数据
    → 缓存未命中? → 执行 loader → 写入缓存

Python 脚本调用（回测/数据补全）:
  → pythonRunner.runPython('backtest.py', { input: {...} })
  → child_process.spawn(python_bin, [script_path])
  → stdin ← JSON (input)
  → stdout → JSON ({ success, data })
  → 解析返回

前端持久化 (IndexedDB / Dexie.js):
  → axios /api/* → API 响应 → Dexie 11 表
  → 用户数据 (自选/持仓/交易/提醒) 纯前端 CRUD，不走后端
```

---

## 六、Provider Chain 编排一览

| 业务域 | 主 Provider | 备 Provider | 全局 Provider |
|--------|-----------|-----------|-------------|
| 基金数据 | stock-sdk | eastmoney | - |
| 行情报价 | stock-sdk | eastmoney | yahoo (全球) |
| 股票信息 | eastmoney | tencent | - |
| 新闻快讯 | eastmoney | baidu → cls | - |
| 网络搜索 | Bocha | Tavily → DuckDuckGo | - |
