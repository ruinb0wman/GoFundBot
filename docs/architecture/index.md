# 技术架构总览

```
┌────────────────────────────────────────────────────────────────────┐
│  双部署目标：Web (浏览器) / 桌面 (Tauri 2 壳，仅解禁 CORS)           │
│                                                                    │
│                    frontend (Vue 3 + Vite) 同一份 src               │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Dexie.js (IndexedDB)                                        │  │
│  │  watchlist │ portfolio │ trades │ positions │ alertRules     │  │
│  │  chatSessions │ chatMessages │ fundCache │ marketCache       │  │
│  │  screeningFunds │ analysisMemory │ strategyMemory            │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │  业务逻辑（前端化）                                           │  │
│  │  industryClassifier（行业/基金类型分类）                      │  │
│  │  researchComputation（市场统计/基金看板/ETF/板块汇总/行业表现）│  │
│  │  riskMetrics（computeRiskMetricsLocal 风险指标）＋4433 排名    │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │  AI / 搜索（前端直调）                                        │  │
│  │  fundAnalyst（4 分析师+总监）│ portfolioAnalyst（组合诊断）    │  │
│  │  strategyDraft（策略起草）│ reflection（分析反思）             │  │
│  │  chatEngine（对话 + 工具调用 skills/tools）│ searchService     │  │
│  │  llm.ts（OpenAI 兼容客户端，浏览器 fetch / tauri plugin-http） │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │  设置：LLM/Search key → localStorage；仅 Proxy URL → Node      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│    出站 HTTP 由 httpClient.ts 适配器路由：                         │
│    · Web  → 浏览器 fetch → /api Vite 代理 → Node                    │
│    · Tauri→ tauri-plugin-http 直连（绕 CORS）→ Node / 外部 API      │
└────────────────────────────────┼───────────────────────────────────┘
                                 │
┌────────────────────────────────┼───────────────────────────────────┐
│                   Node 薄后端 (localhost:8310)                       │
│  Middleware: helmet │ cors │ rate-limit (300/15min) │ logger         │
│  Routes: /api/fund │ /api/funds │ /api/market │ /api/stocks          │
│          /api/news │ /api/backtest │ /api/screening（原始数据）      │
│          /api/alerts │ /api/user/portfolio │ /api/settings（proxy）  │
│          /api/system │ /api/logs │ /api/health                       │
│  Services: fundService │ marketService │ newsService │ stockService  │
│            pythonRunner │ settingsService（proxy only）              │
│  ProviderChain + DataSourceScorer（自适应降级） + MemoryCache         │
│                              │                                      │
│                   ┌─────────┴─────────┐                             │
│                   ▼                   ▼                              │
│          Python Scripts         External APIs                         │
│          (backtest/data_complete)   (eastmoney/yahoo/...)            │
└──────────────────────────────────────────────────────────────────────┘
```

> 桌面壳详见 [Tauri 2 桌面壳](./desktop-shell)。`tauri/src-tauri/` 目录仅包含壳
> （`tauri.conf.json` + `capabilities/remote-webview.json` + Rust 入口），
> 不打包前端资源。

## 三运行时分布

| 运行时 | 位置 | 角色 |
|--------|------|------|
| **Node.js (TypeScript)** | `service/src/` | Express 薄后端 (port 8310)——数据获取、驱动 Python、本地数据代理（反爬/代理/限流/日志） |
| **Node.js (TypeScript)** | `frontend/src/` | Vue 3 前端 (port 8517)——全部业务计算、AI 分析、联网搜索、用户数据 (IndexedDB) |
| **Python 3** | `python/` | 工具脚本，由 `pythonRunner.ts` 通过 `child_process.spawn()` 调用 |

## 职责边界（业务逻辑前端化）

| 能力 | 位置 | 说明 |
|------|------|------|
| 筛选丰富化（风险指标/行业分类/排名/4433） | `frontend/src/services/industryClassifier.ts` + `useScreeningDb` | Node `/api/screening` 仅返回原始清单+NAV |
| 市场统计/基金看板/ETF/板块汇总/行业表现 | `frontend/src/services/researchComputation.ts` | 从 Dexie screeningFunds + `/api/market/sectors` 计算 |
| AI 基金分析 / 组合诊断 / 策略起草 / 反思 | `frontend/src/services/fundAnalyst.ts` 等 | 前端直调 OpenAI 兼容端点，key 存前端 |
| AI 对话 + 工具调用（基金/行情/回测/搜索） | `frontend/src/services/chatEngine/` | `skills.ts` + `tools.ts` + `toolHandlers.ts` |
| 联网搜索链 Exa→Bocha→Tavily→DDG | `frontend/src/services/searchService.ts` | key 取前端设置 |
| 设置 | LLM/Search key 存前端 localStorage；仅 Proxy URL → Node | Node `/api/settings` 只剩 proxy 子域 |
| 数据获取 / 回测（Python） / 反爬 / 代理 | `service/src/` | 保留不变 |

## 关键依赖

| 依赖 | 用途 |
|------|------|
| **Express** | Node 薄后端 HTTP 服务 + 路由 |
| **Vue 3 + Vite** | 前端框架 |
| **Dexie.js** | 浏览器 IndexedDB ORM（11 表） |
| **Pinia** | 前端状态管理 |
| **@tauri-apps/plugin-http** | 桌面端原生出站 HTTP（绕 CORS） |
| **helmet / express-rate-limit** | 安全头 / 限流 |
| **stock-sdk** | npm 包，基金净值/行情主数据源 |
| **akshare** | Python 库，A 股数据回退来源 |

## 关键设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 业务逻辑归属 | 全部前端化 | 双端共用同一套计算/AI/搜索，Node 瘦身为纯数据层 |
| 桌面部署 | Tauri 2 壳 + 前端服务分开启动 | 不打包资源，WebView 加载运行中的前端服务（绕 CORS） |
| 用户数据存储 | 浏览器 IndexedDB (Dexie.js) | 无服务端状态，零运维，隐私友好 |
| 数据源编排 | ProviderChain 链式调降 | 多数据源自动降级，业务代码无感 |
| Python 集成 | `child_process.spawn` + JSON 通信 | 无 HTTP 服务开销，类型安全 |
| AI 分析 | Multi-Agent Debate (4+1) | 多角度评估，减少单模型偏见 |
| 设置 | LLM/Search key 前端本地，仅 Proxy 下发 Node | 隐私与简化；Node 抓取走用户代理 |

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
| Tauri 2 桌面壳 | [Tauri 2 桌面壳](./desktop-shell) |

## 相关文档

| 文档 | 内容 |
|------|------|
| [`data-sources-and-runtime.md`](../data-sources-and-runtime) | 数据来源/核心函数/运行时总览 |
| [`tushare.md`](../tushare) | Tushare Pro 接入方案与定价分析 |
| [`market-money-flow.md`](../market-money-flow) | 今日资金流向数据流详解 |
| [`market-global.md`](../market-global) | 全球行情数据流详解 |