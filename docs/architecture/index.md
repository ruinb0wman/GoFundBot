# 技术架构总览

```
┌────────────────────────────────────────────────────────────┐
│                    Browser (Vue 3 + Vite)                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Dexie.js (IndexedDB) — 11 表                         │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │ watchlist │ portfolio │ trades │ positions      │  │  │
│  │  │ alertRules │ chatSessions │ chatMessages        │  │  │
│  │  │ fundCache │ marketCache │ screeningFunds        │  │  │
│  │  │ analysisMemory                                  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │  Pinia Stores │ Composables │ Vue Router               │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │ axios /api/*                     │
│                          │ SSE /api/chat                    │
└──────────────────────────┼─────────────────────────────────┘
                           │
┌──────────────────────────┼─────────────────────────────────┐
│              Express Backend (port 3100)                     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Middleware                                         │  │
│  │  helmet │ cors │ rate-limit (300/15min) │ logger    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Routes                                             │  │
│  │  /api/fund │ /api/funds │ /api/market │ /api/stocks │  │
│  │  /api/screening │ /api/backtest │ /api/chat        │  │
│  │  /api/research │ /api/settings │ /api/alerts       │  │
│  │  /api/analysis-memory │ /api/datasource-scores     │  │
│  │  /api/news │ /api/watchlist │ /api/user/portfolio  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Service Layer                                      │  │
│  │  fundService │ marketService │ screeningEnrichment  │  │
│  │  researchService │ newsService │ stockService       │  │
│  │  chatService │ aiAnalyst │ searchService            │  │
│  │  riskMetricsService │ industryService               │  │
│  │  settingsService │ memoryService                    │  │
│  │  pythonRunner                                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─────────────────────────────────┐ ┌───────────────────┐  │
│  │  ProviderChain + Providers      │ │  MemoryCache      │  │
│  │  ┌───────────────────────────┐  │ │  Max 5000 entries │  │
│  │  │ Fund: stock-sdk → eastm. │  │ │  TTL: 15s ~ 7d   │  │
│  │  │ Mkt:  stock-sdk → eastm. │  │ │  Periodic cleanup │  │
│  │  │       → yahoo             │  │ │  (5 min interval) │  │
│  │  │ Stock: eastmoney → tencent│  │ └───────────────────┘  │
│  │  │ News:  eastm. → baidu → cls│ │                        │
│  │  │ Search: Bocha → Tavily →  │  │                        │
│  │  │         DuckDuckGo         │  │                        │
│  │  └───────────────────────────┘  │                        │
│  │  DataSourceScorer (自适应排序)    │                        │
│  └─────────────────────────────────┘                        │
│                              │                               │
│                    ┌─────────┴─────────┐                    │
│                    ▼                   ▼                     │
│           Python Scripts         External APIs               │
│  ┌──────────────────────┐  ┌──────────────────────────┐     │
│  │ child_process.spawn  │  │ fund.eastmoney.com       │     │
│  │ stdin: JSON          │  │ push2.eastmoney.com      │     │
│  │ stdout: JSON         │  │ qt.gtimg.cn  (tencent)   │     │
│  │                      │  │ finance.yahoo.com        │     │
│  │ backtest.py          │  │ newsapi.eastmoney.com    │     │
│  │ fetch_fund.py        │  │ api.bocha.cn             │     │
│  │ data_complete.py     │  │ api.duckduckgo.com       │     │
│  └──────────────────────┘  └──────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

## 三运行时分布

| 运行时 | 位置 | 角色 |
|--------|------|------|
| **Node.js (TypeScript)** | `Service/src/` | Express 后端 (port 3100)，ProviderChain 编排、缓存、业务逻辑、AI 对话 |
| **Node.js (TypeScript)** | `Frontend/src/` | Vue 3 前端 (port 5173)，IndexedDB (Dexie.js，11 张表) 本地持久化 |
| **Python 3** | `Scripts/` | 工具脚本，由 `pythonRunner.ts` 通过 `child_process.spawn()` 调用 |

## 关键依赖

| 依赖 | 用途 |
|------|------|
| **Express** | HTTP 服务 + 路由 |
| **Vue 3 + Vite** | 前端框架 |
| **Dexie.js** | 浏览器 IndexedDB ORM（10+1 表） |
| **Pinia** | 前端状态管理 |
| **OpenAI SDK** | LLM 对话 + AI 分析师调用 |
| **helmet** | 安全头 |
| **express-rate-limit** | 限流（300 请求/15 分钟） |
| **stock-sdk** | npm 包，基金净值/行情主数据源 |
| **axios** | HTTP 客户端 |
| **akshare** | Python 库，A 股数据回退来源 |

## 关键设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 用户数据存储 | 浏览器 IndexedDB (Dexie.js) | 无服务端状态，零运维，隐私友好 |
| 数据源编排 | ProviderChain 链式调降 | 多数据源自动降级，业务代码无感 |
| 缓存策略 | 内存 Map + TTL + `cacheThrough` | 低延迟，无外部依赖，适合单进程 |
| Python 集成 | `child_process.spawn` + JSON 通信 | 无 HTTP 服务开销，类型安全 |
| AI 分析 | Multi-Agent Debate (4+1) | 多角度评估，减少单模型偏见 |
| API 设计 | Express + asyncHandler + ServiceResult 统一响应 | 一致的错误处理和元数据（provider/fallback/cached） |
| 限流 | express-rate-limit 300/15min | 防滥用，无 Redis 依赖 |
| 日志 | 结构化 JSON，按天文件输出 | 可检索，可分析 |

## 各架构模块导航

| 模块 | 文档 |
|------|------|
| 数据源 | [数据源](./data-sources) |
| 数据流向 | [数据流向](./data-flow) |
| 数据回退策略 | [数据回退策略](./fallback-strategy) |
| 各模块数据源映射 | [模块数据源映射](./module-data-sources) |
| 基金数据合并策略 | [基金数据合并策略](./fund-data-merge) |
| AI 分析框架总览 | [AI 分析框架总览](./ai-overview) |
| AI 对话系统 | [AI 对话系统](./ai-chat) |
| AI 基金分析与持仓分析 | [AI 基金分析与持仓分析](./ai-fund-analysis) |
| 记忆与反思系统 | [记忆与反思系统](./ai-memory) |

## 相关文档

| 文档 | 内容 |
|------|------|
| [`data-sources-and-runtime.md`](../data-sources-and-runtime) | 数据来源/核心函数/运行时总览 |
| [`tushare.md`](../tushare) | Tushare Pro 接入方案与定价分析 |
| [`market-money-flow.md`](../market-money-flow) | 今日资金流向数据流详解 |
| [`market-global.md`](../market-global) | 全球行情数据流详解 |
