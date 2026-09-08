# GoFundBot — Agent Guide

## Architecture

**Two services + optional Tauri shell**, start in order:

1. **service** (port 8310) — Node.js/Express/TypeScript **薄后端**（数据获取层）
   - All API routes (`/api/fund/*`, `/api/market/*`, `/api/screening/*`, `/api/backtest/*`, etc.) — 业务计算已迁移前端，后端只返回原始数据
   - ProviderChain (stock-sdk → eastmoney → baidu/cls) for real-time financial data
   - PythonRunner: spawns Python scripts for computation (backtest)
   - 反爬(Referer)、Yahoo 走代理、速率/校验/日志；最小代理配置接口（仅 Proxy URL）
2. **frontend** (port 8517) — Vue 3 + Vite，proxies `/api` → service。**全部业务逻辑在前端**：
   - 筛选丰富化（`industryClassifier.ts` 行业分类 + `computeRiskMetricsLocal` 风险指标 + 4433 排名，`useScreeningDb`）
   - 投研看板计算（`researchComputation.ts`，从 Dexie screeningFunds + `/api/market/sectors` 聚合）
   - AI：`llm.ts`（OpenAI 兼容客户端直调）+ `fundAnalyst` / `portfolioAnalyst` / `strategyDraft` / `reflection` / `chatEngine`（对话+工具调用）；分析场景统一走 `analysis/`（场景 Skill 注册表 + 共享引擎，复用 chat 工具契约）
   - 联网搜索：`searchService.ts`（Exa→Bocha→Tavily→DuckDuckGo，key 存前端 localStorage）
   - 设置：LLM/Search key 存前端；仅 Proxy URL 下发 Node
3. **桌面目标**（可选）— **Tauri 2 壳**（`tauri/src-tauri/`），仅解禁 CORS，不打包前端资源：WebView 加载**运行中的前端服务** origin（dev `http://localhost:8517`，prod `http://localhost:8417` 静态托管）；出站 HTTP 走 `tauri-plugin-http`（绕 CORS）。远程 origin 的 IPC 放行在 `tauri/src-tauri/capabilities/remote-webview.json` 的 `remote.urls`。前端 `httpClient.ts` 检测 `window.__TAURI_INTERNALS__` 自动路由（桌面 → Node `localhost:8310` 绝对地址；Web → `/api` Vite 代理）。

**Python** is tool-only (no HTTP server). Called via `child_process.spawn()` from Express:
```
stdin: JSON → Python compute → stdout: JSON
```

**All persistent data lives in IndexedDB** (Dexie.js) on the frontend:
- User data: watchlist, portfolio, trades, positions, alerts, chat history, strategy memory
- Cache: fund details, NAV history, market data, screening funds

## Data flow

```
Real-time data:   ProviderChain → Express → frontend → IndexedDB (Dexie)
User data CRUD:   frontend → IndexedDB (Dexie) — no server round-trip
Backtest:         Express → PythonRunner.spawn('backtest.py') → stdout JSON → frontend → Dexie
Data completion:  Python scripts via CLI → fetch from akshare/eastmoney → stdout JSON → Express
Screening enrichment: frontend sync raw /api/screening → 本地 computeRiskMetrics + classifyFundIndustry → Dexie
Web search:       frontend chatEngine/searchService → Exa/Bocha/Tavily/DDG（key 前端本地）
Settings:         LLM/Search key 前端 localStorage；Proxy URL → PUT /api/settings（仅 proxy 子域）
Desktop HTTP:     httpClient.ts → tauri-plugin-http 直连（绕 CORS），Node 用 localhost:8310 绝对地址
```

## Commands

```bash
# service (Node >= 18) — THE main backend
cd service && npm install
npm run dev              # tsx watch src/index.ts (port 8310)
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint (max-lines 500)
npm test                 # vitest run (67+ tests)
npm run build && npm start

# frontend
cd frontend && npm install
npm run dev              # port 8517, proxy /api → localhost:8310
npm run lint             # ESLint (max-lines 500, Vue/TS)
npx vue-tsc --noEmit     # TypeScript typecheck
npm test                 # vitest run
npm run build            # output in frontend/dist/

# Desktop (Tauri 2 shell — CORS-free). 需先启动 Node + 前端服务：
cd frontend && npm run build && npm run preview   # prod 静态托管 localhost:8417
cd tauri && npm run dev                           # = tauri dev（WebView 加载 devUrl）
# cargo check 需要系统库：webkit2gtk-4.1 / gtk3 / atk（Linux）

# Python scripts (standalone, no HTTP server)
cd python
echo '{"navHistory":[...]}' | python/.venv/bin/python cli/backtest.py
python/.venv/bin/python cli/fetch_fund.py --code 019667
python/.venv/bin/python cli/data_complete.py --source akshare --type stocks

# Docs (VitePress)
cd docs && npm install
npm run dev              # port 8574, proxied via frontend /docs/*
npm run build            # output in docs/.vitepress/dist/
```

## CI/CD

```yaml
dataservice: npm run lint → npm run typecheck → npm test
frontend:  npm run lint → npx vue-tsc --noEmit → npm test → npm run build
```

Both services enforce single-file max 500 lines. Violations block CI.

## Key details

- **Rate limiting**: `express-rate-limit` (300/15min).
- **Input validation**: Zod schemas on key POST routes.
- **Security headers**: service uses `helmet` (CSP/COEP disabled).
- **Structured logging**: JSON via `core/logger.ts` (service) with `requestId` per request. Daily files `dataservice-YYYY-MM-DD.jsonl` under `python/Data/logs`.
- **Health check**: `GET /api/health` — includes cache stats.
- **Cache TTLs**: fund estimates 30s, market quotes 15s, history 24h, dividends 7d.
- **Graceful shutdown**: service handles `SIGTERM`/`SIGINT` — 10s wait, then force exit.
- **Vite proxy**: `frontend/vite.config.ts` proxies `/api` → `localhost:8310`, `/docs` → `localhost:8574`.
- **Dexie.js**: All persistent data in IndexedDB, 11 tables in `frontend/src/db/index.ts` (含 strategies / analysisMemory).
- **Settings endpoint**: `GET/PUT /api/settings` — **仅 proxy 子域**（LLM/Search key 已迁移前端 localStorage：`useLLMConfig` / `useAppSettings`）。
- **Search chain（前端）**: Exa（MCP/JSON-RPC，免费无 Key）→ Bocha → Tavily → DuckDuckGo（自动降级）；`frontend/src/services/searchService.ts`。
- **Screening data refresh**: 筛选页 onMounted + localStorage 持久化 `lastSyncTime` → 检测过期（今日 9AM）→ 强制 `force=true` 全量刷新。AI chat `get_industry_performance` 共享同一缓存（cacheThrough TTL=次日 9AM）。
- **Proxy**: 国内 API（东方财富）用 `proxy: 'never'` 直连；Yahoo Finance（被封）走 `proxy: 'auto'` 随代理配置。`eastmoneyRequest.ts` 统一添加 `Referer` 头防止反爬。
- **Docs**: VitePress 构建的文档站，配置在 `docs/.vitepress/config.ts`（nav + sidebar）。模块级详细文档按功能目录组织（如 `docs/fund-screening/`），在侧边栏对应分组。文档通过 frontend `/docs/*` 代理访问。

> 模块级详细文档见 `docs/` 目录（VitePress 构建），每个功能模块对应独立的 `.md` 文件或目录，侧边栏分组见 `docs/.vitepress/config.ts`。

## Monorepo hot spots

| Directory | What |
|-----------|------|
| `service/src/` | Express app with ProviderChain, all routes |
| `service/src/app.ts` | App bootstrap — route registration, middleware |
| `service/src/routes/` | All Express route handlers (fund, market, screening, backtest, settings, etc.) |
| `service/src/services/` | 数据层服务（fundService, marketService, pythonRunner, settingsService(proxy)）；业务计算已迁移前端 |
| `service/src/providers/` | ProviderChain implementations (stock-sdk, eastmoney, tencent, yahoo) |
| `service/src/core/` | Infrastructure (logger, cache, errors, response, providerChain) |
| `service/src/types/` | DTO interfaces (fund.ts, common.ts) |
| `python/cli/` | Python CLI scripts (backtest, fetch_fund, data_complete) |
| `python/cli/shared/` | Shared Python utilities (http_client) |
| `python/services/*.py` | Python computation modules (backtest.py, helpers.py) |
| `frontend/src/services/llm.ts` | OpenAI 兼容 LLM 客户端（浏览器 fetch / tauri plugin-http，JSON+流式） |
| `frontend/src/services/fundAnalyst.ts` | AI 基金分析（4 分析师+总监）——内部经 `analysis/analysisEngine` runTask：每分析师/总监都是可工具子调用（子集工具/全集），输出经 Schema 校验；公开签名（analyzeFund/analyzeFundStream）与阶段语义不变 |
| `frontend/src/services/portfolioAnalyst.ts` | 组合诊断分析（前端直调）——经 `analysis/` 引擎 + `portfolio_diagnosis` 场景（市场面工具子集），Schema 校验，注入策略上下文 |
| `frontend/src/services/analysis/` | **分析场景框架**：`analysisScenarios.ts`（3 场景 Skill 注册表：fund_analysis/portfolio_diagnosis/log_analysis）、`scenarioTypes.ts`（TypeBox 输出 Schema，字段与 DTO 一致）、`analysisEngine.ts`（runTask/runScenario 共享引擎：工具循环+结构化收尾+INVALID_OUTPUT 纠错重试≤2+fallback 降级）、`logAnalysis.ts`（AI 日志分析适配器，规则引擎 `/api/logs/analyze` 为降级源，service 零改动） |
| `frontend/src/services/chatEngine/` | AI 对话引擎（skills.ts 技能 / toolContract.ts 工具契约* / toolCallParser.ts 调用解析与净化 / toolHandlers.ts 实现 / **toolLoop.ts 共享工具循环**（归一化+信封+重试/裁剪，chat 与分析场景复用）/ index.ts 编排）<br>*ToolSpec（TypeBox Schema）单一数据源：派生 OpenAI tools 参数、`<available_tools>` XML 清单与运行时校验；原生 tool_calls 与 `<ai_tool_calls>` XML 归一化为统一契约，未知工具名纠错回喂，正文永不出现工具标记 |
| `frontend/src/services/searchService.ts` | 前端搜索链（Exa → Bocha → Tavily → DuckDuckGo） |
| `frontend/src/services/industryClassifier.ts` | 行业/基金类型分类（筛选丰富化 + 聊天工具共用） |
| `frontend/src/services/researchComputation.ts` | 投研看板聚合计算（市场统计/基金看板/ETF/板块/行业表现） |
| `frontend/src/services/httpClient.ts` | 环境感知 HTTP 适配器（Web fetch ↔ Tauri plugin-http，绕 CORS） |
| `tauri/src-tauri/` | Tauri 2 桌面壳（`tauri.conf.json` + `capabilities/remote-webview.json` 远程 origin IPC 放行 + Rust 入口）；不打包前端资源 |
| `frontend/src/db/` | Dexie schema (index.ts) — all IndexedDB table definitions |
| `frontend/src/composables/` | Vue composables (useDexieCache, useFundWatchlist, useAppSettings, etc.) |
| `frontend/src/stores/` | Pinia stores (watchlistStore updated with Dexie sync) |
| `frontend/src/services/` | API client（api.ts 基于 httpClient 环境路由、portfolioApi.ts、chatApi.ts + chatEngine） |
| `docs/` | VitePress 文档站（`docs/.vitepress/config.ts` 导航/侧边栏配置） |
| `packages/ui/` | **UI 组件库 `@gofund/ui`** — B* 系列表单控件与浮层/反馈组件、设计 token（明暗双主题）、composables；Vite lib mode 构建（组件级 chunk + dts）；frontend 经 vite/tsconfig 别名直连 `packages/ui/src/index.ts`（`@gofund/ui`），开发 HMR 与构建均从源；`file:../packages/ui` 仅为发布用依赖声明 |
| `docs/fund-screening/` | 基金筛选模块细分文档（概览/数据流/筛选面板/指标丰富化/4433法则） |
| `docs/market-*.md` | 市场数据各功能模块说明文档 |
| `docs/architecture/` | 技术架构文档（数据源/数据流/回退策略/AI分析/桌面壳等） |
| `docs/strategy/` | 策略板块文档（概览/策略记忆与AI注入） |
| `frontend/src/services/strategyDraft.ts` | AI 策略起草（LLM JSON + 模板降级，前端直调） |
| `frontend/src/db/strategyMemory.ts` | 策略记忆 CRUD + `buildStrategyContext()` 上下文格式化 |
| `frontend/src/views/StrategyView.vue` + `frontend/src/components/ChatPanel.vue` | 策略板块 UI（记忆列表/编辑表单 + 复用主聊天窗口，channel='strategy'） |

## Testing

```bash
# service (Vitest)
cd service && npm test

# frontend (Vitest + @vue/test-utils)
cd frontend && npx vue-tsc --noEmit && npm test
```

## Known issues

### 今日资金流向 (market money flow)

EastMoney `push2*` 子域名的 `/api/qt/stock/fflow/daykline/get` 接口被反爬封锁（SSL EOF），
无法获取分订单规模（主力/超大单/大单/中单/小单）的沪深合计资金流数据。

**现状**：
- EastMoney push2 不可用后自动走 Akshare 回退（`data_complete.py --source akshare --type money_flow`）
- Akshare 返回格式与 EastMoney 一致（`MarketMoneyFlowDto`），覆盖 5 个字段
- `getMarketMoneyFlow()` 在两种数据源均失败时返回空数据，前端显示"暂无数据"

**历史修复**：
- **2026-07-28** — 前端资金流向图表修复：`categories` 从 `['主力', '机构', '大户', '散户']` 改为 `['机构', '大户', '中户', '散户']`，values 映射从 `[mainNetInflow, superLargeNetInflow, largeNetInflow, smallNetInflow]` 改为 `[superLargeNetInflow, largeNetInflow, mediumNetInflow, smallNetInflow]`
  - 修复前：`mainNetInflow = superLargeNetInflow + largeNetInflow`，买入侧重复计算翻倍，且遗漏 `mediumNetInflow`
  - 修复后：4 栏互斥，标签与订单分类对齐，详见 `docs/market-money-flow.md`
