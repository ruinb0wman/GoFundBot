# GoFundBot — Agent Guide

## Architecture

**Two services**, start in order:

1. **service** (port 8310) — Node.js/Express/TypeScript **薄后端**（数据获取层）
   - All API routes (`/api/fund/*`, `/api/market/*`, `/api/screening/*`, etc.) — 业务计算已迁移前端，后端只返回原始数据（回测路由已删除）
   - ProviderChain (stock-sdk → eastmoney → baidu/cls) for real-time financial data
   - PythonRunner: spawns Python scripts for data completion (akshare)；回测已迁前端
   - 反爬(Referer)、Yahoo 走代理、速率/校验/日志；最小代理配置接口（仅 Proxy URL）
2. **frontend** (port 8517) — Vue 3 + Vite，proxies `/api` → service。**全部业务逻辑在前端**：
   - 筛选丰富化（`industryClassifier.ts` 行业分类 + `computeRiskMetricsLocal` 风险指标 + 4433 排名，`useScreeningDb`）
   - 投研看板计算（`researchComputation.ts`，从 Dexie screeningFunds + `/api/market/sectors` 聚合）
   - AI：`llm.ts`（OpenAI 兼容客户端直调）+ `fundAnalyst` / `portfolioAnalyst` / `strategyDraft` / `reflection` / `chatEngine`（对话+工具调用）；分析场景统一走 `analysis/`（场景 Skill 注册表 + 共享引擎，复用 chat 工具契约）
   - 联网搜索：`searchService.ts`（Exa→Bocha→Tavily→DuckDuckGo，key 存前端 localStorage）
   - 设置：LLM/Search key 存前端；仅 Proxy URL 下发 Node
3. **Electron 桌面壳**（外部项目，可选）— 仅解禁 CORS（壳侧禁用 Web Security）：浏览器窗口加载**运行中的前端服务** origin（dev `http://localhost:8517`，prod `http://localhost:8417` 静态托管）。前端代码与 Web 完全一致——无运行时分支，`httpClient.ts` 统一走浏览器 fetch（`/api` Vite 代理 + localhost:8310 回退）。

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
Backtest:         前端 services/backtest/ 本地计算（NAV 取自 /api/funds/:code/nav-history）→ 页面图表 + Dexie(backtestRuns)
                  Python backtest.py 与 Node /api/backtest 已于 2026-09-29 删除（黄金 fixtures 冻结在 frontend/src/services/backtest/__fixtures__/）
Data completion:  Python scripts via CLI → fetch from akshare/eastmoney → stdout JSON → Express
Screening enrichment: frontend sync raw /api/screening → 本地 computeRiskMetrics + classifyFundIndustry → Dexie
Web search:       frontend chatEngine/searchService → Exa/Bocha/Tavily/DDG（key 前端本地）
Settings:         LLM/Search key 前端 localStorage；Proxy URL → PUT /api/settings（仅 proxy 子域）
Desktop HTTP:     浏览器 fetch（Electron 壳侧解禁 CORS），与 Web 行为一致（/api 代理 + localhost:8310 回退）
```

## Commands

> 包管理器是 **bun**（`bun.lock` 是唯一锁文件，`package-lock.json` 已删）。脚本文档一律写 `bun run <script>` ——
> 注意 `bun test` 是 Bun 自带的测试器，要跑本项目的 test 脚本必须写 `bun run test`。
> 根目录 `bun dev` 一键起全部三件（service + frontend + docs）。

```bash
# service (Node >= 22.19) — THE main backend
cd service && bun install
bun run dev              # tsx watch src/index.ts (port 8310)
bun run typecheck        # tsc --noEmit
bun run lint             # ESLint (max-lines 500)
bun run test             # vitest run (96 tests)
bun run build && bun run start

# frontend
cd frontend && bun install
bun run dev              # port 8517, proxy /api → localhost:8310
bun run lint             # ESLint (max-lines 500, Vue/TS)
bunx vue-tsc --noEmit    # TypeScript typecheck
bun run test             # vitest run
bun run build            # output in frontend/dist/

# Desktop (Electron shell — external project, CORS-free). 需先启动 Node + 前端服务：
cd frontend && bun run build && bun run preview   # prod 静态托管 localhost:8417
# 用 Electron 浏览器壳打开 http://localhost:8417

# Python scripts (standalone, no HTTP server)
cd python
# 数据补全（argparse CLI）
python/.venv/bin/python cli/data_complete.py --source akshare --type stocks
python/.venv/bin/python cli/fetch_fund.py --code 019667

# Docs (VitePress)
cd docs && bun install
bun run dev              # port 8574, proxied via frontend /docs/*
bun run build            # output in docs/.vitepress/dist/
```

## 本地校验（无 CI）

GitHub Actions 已移除（`.github/workflows/ci.yml` 已删），改动后请在本地跑对应检查。
两者都强制单文件 ≤500 行（超限直接 lint 失败）：

```bash
# service
cd service && bun run lint && bun run typecheck && bun run test

# frontend
cd frontend && bun run lint && bunx vue-tsc --noEmit && bun run test && bun run build

# python（ruff 配置在 python/pyproject.toml）
python/.venv/bin/ruff check python/ && python/.venv/bin/ruff format python/ --check
python/.venv/bin/python python/cli/check_file_length.py
```

## Key details

- **Rate limiting**: `express-rate-limit` (300/15min).
- **Input validation**: Zod schemas on key POST routes.
- **Security headers**: service uses `helmet` (CSP/COEP disabled).
- **Structured logging**: JSON via `core/logger.ts` (service) with `requestId` per request. Daily files `dataservice-YYYY-MM-DD.jsonl` under `python/Data/logs`.
- **Health check**: `GET /api/health` — includes cache stats.
- **Cache TTLs**: fund estimates 30s, market quotes 15s, history 24h, dividends 7d.
- **Graceful shutdown**: service handles `SIGTERM`/`SIGINT` — 10s wait, then force exit.
- **Vite proxy**: `frontend/vite.config.ts` proxies `/api` → `localhost:8310`, `/docs` → `localhost:8574`.
- **Dexie.js**: All persistent data in IndexedDB, 14 tables in `frontend/src/db/index.ts` (含 strategies / analysisMemory / backtestRuns).
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
| `service/src/providers/` | ProviderChain implementations (stock-sdk, eastmoney, tencent, yahoo)；eastmoney 的涨跌家数/北向资金实现在 `eastmoney/marketBreadth.ts`、`eastmoney/marketNorthFlow.ts` |
| `service/src/core/` | Infrastructure (logger, cache, errors, response, providerChain) |
| `service/src/types/` | DTO interfaces (fund.ts, common.ts) |
| `python/cli/` | Python CLI scripts (data_complete, fetch_fund) |
| `python/cli/shared/` | Shared Python utilities (file_cache) |
| `frontend/src/services/llm.ts` | OpenAI 兼容 LLM 客户端（浏览器 fetch，JSON+流式） |
| `frontend/src/services/fundAnalyst.ts` | AI 基金分析（4 分析师+总监）——内部经 `analysis/analysisEngine` runTask：每分析师/总监都是可工具子调用（子集工具/全集），输出经 Schema 校验；公开签名（analyzeFund/analyzeFundStream）与阶段语义不变 |
| `frontend/src/services/portfolioAnalyst.ts` | 组合诊断分析（前端直调）——经 `analysis/` 引擎 + `portfolio_diagnosis` 场景（市场面工具子集），Schema 校验，注入策略上下文 |
| `frontend/src/services/analysis/` | **分析场景框架**：`analysisScenarios.ts`（3 场景 Skill 注册表：fund_analysis/portfolio_diagnosis/log_analysis）、`scenarioTypes.ts`（TypeBox 输出 Schema，字段与 DTO 一致）、`analysisEngine.ts`（runTask/runScenario 共享引擎：工具循环+结构化收尾+INVALID_OUTPUT 纠错重试≤2+fallback 降级）、`logAnalysis.ts`（AI 日志分析适配器，规则引擎 `/api/logs/analyze` 为降级源，service 零改动） |
| `frontend/src/services/backtest/` | **定投回测引擎（前端）**：`backtestEngine.ts`（与 `python/cli/backtest.py` 逐值对齐，黄金 fixtures 见 `__fixtures__/`；新增可选 `hooks.decide` 支持自定义策略）、`strategyRules.ts`（定投日/价值平均/均线偏离）、`pyCompat.ts`（CPython round/ISO 周）、`strategyCompare.ts`（多策略推荐，回测页「智能推荐策略」）、`timelineSample.ts`（工具输出抽样，避开 4000 字符截断）、`runBacktestForFund.ts`、`toolArgs.ts`；**`strategySandbox.ts` + `strategyWorker.ts` + `runStrategyCode.ts`**（LLM 自写 JS 策略的 Worker 沙箱，`run_strategy_code` 工具，需用户确认，5s 超时）；持久化在 `frontend/src/db/backtestRuns.ts`。详见 `docs/architecture/backtest-engine.md` |
| `frontend/src/services/chatEngine/` | AI 对话引擎（skills.ts 技能 / toolContract.ts 工具契约* / toolCallParser.ts 调用解析与净化 / toolHandlers.ts 实现 / **toolLoop.ts 共享工具循环**（归一化+信封+重试/裁剪，chat 与分析场景复用）/ toolResultStatus.ts（空结果判定 → 工具条黄色感叹号）/ index.ts 编排）<br>*ToolSpec（TypeBox Schema）单一数据源：派生 OpenAI tools 参数、`<available_tools>` XML 清单与运行时校验；原生 tool_calls 与 `<ai_tool_calls>` XML 归一化为统一契约，未知工具名纠错回喂，正文永不出现工具标记 |
| `frontend/src/services/searchService.ts` | 前端搜索链（Exa → Bocha → Tavily → DuckDuckGo） |
| `frontend/src/services/industryClassifier.ts` | 行业/基金类型分类（筛选丰富化 + 聊天工具共用） |
| `frontend/src/services/researchComputation.ts` | 投研看板聚合计算（市场统计/基金看板/ETF/板块/行业表现） |
| `frontend/src/services/httpClient.ts` | HTTP 适配器（统一浏览器 fetch；Electron 壳侧解禁 CORS，无运行时分支） |
| `frontend/src/db/` | Dexie schema (index.ts) — all IndexedDB table definitions |
| `frontend/src/composables/` | Vue composables (useDexieCache, useFundWatchlist, useAppSettings, etc.) |
| `frontend/src/stores/` | Pinia stores (watchlistStore updated with Dexie sync) |
| `frontend/src/services/` | API client（api.ts 基于 httpClient 环境路由、portfolioApi.ts、chatApi.ts + chatEngine） |
| `docs/` | VitePress 文档站（`docs/.vitepress/config.ts` 导航/侧边栏配置） |
| `packages/ui/` | **UI 组件库 `@gofund/ui`** — B* 系列表单控件与浮层/反馈组件、设计 token（明暗双主题）、composables；Vite lib mode 构建（组件级 chunk + dts）；frontend 经 vite/tsconfig 别名直连 `packages/ui/src/index.ts`（`@gofund/ui`），开发 HMR 与构建均从源；`file:../packages/ui` 仅为发布用依赖声明 |
| `docs/fund-screening/` | 基金筛选模块细分文档（概览/数据流/筛选面板/指标丰富化/4433法则） |
| `docs/market-*.md` | 市场数据各功能模块说明文档 |
| `docs/architecture/` | 技术架构文档（数据源/数据流/回退策略/AI分析等） |
| `docs/strategy/` | 策略板块文档（概览/策略记忆与AI注入） |
| `frontend/src/services/strategyDraft.ts` | AI 策略起草（LLM JSON + 模板降级，前端直调） |
| `frontend/src/db/strategyMemory.ts` | 策略记忆 CRUD + `buildStrategyContext()` 上下文格式化 |
| `frontend/src/views/StrategyView.vue` + `frontend/src/components/ChatPanel.vue` | 策略板块 UI（记忆列表/编辑表单 + 复用主聊天窗口，channel='strategy'） |

## Testing

```bash
# service (Vitest)
cd service && bun run test

# frontend (Vitest + @vue/test-utils)
cd frontend && bunx vue-tsc --noEmit && bun run test
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

### 北向资金 (market north flow)

2024-08-19 起沪深交易所调整沪深港通交易信息披露机制：**北向资金不再披露实时买入额/卖出额/净买入**，
只在每交易日收市后公布当日成交总额。因此 `push2 .../kamt.kline/get` 的净额字段恒为 `0.00`
（注意是 `0` 而不是 `null`，容易被误读成「北向零流入」），`datacenter RPT_MUTUAL_DEAL_HISTORY` 的
`FUND_INFLOW` / `NET_DEAL_AMT` 也恒为 `null`。南向（港股通沪/深）仍完整披露。

**现状**：
- 主源改为 datacenter `RPT_MUTUAL_DEAL_HISTORY`（`marketNorthFlow.ts`），只取 `DEAL_AMT`（当日成交总额）
- **`DEAL_AMT` 的单位是百万元（亿元 = 值 / 100），不是万元**——实测 2026-09-21 北向 `283911.86` / 沪股通 `133832.25` / 深股通 `150079.61`，与新闻口径「沪深股通合计成交 2839.12 亿、沪股通 1338.32 亿」完全吻合。对比：`push2 kamt/get` 的字段才是万元（它的 `dayAmtThreshold=5200000` 即 520 亿额度）。
- `NorthFlowDto` 的 `shNetInflow/szNetInflow/totalNetInflow` **恒为 null**；新增 `shDealAmount/szDealAmount/totalDealAmount`（百万元）
- 前端 `get_north_flow` 固定返回 `data_status: 'unavailable'` + note（避免模型把 null 当 0），成交总额以亿元写在字段与 note 里
- 回退：datacenter 抛错时走 `data_complete.py --source akshare --type north_flow`（同一端点，不同 client）
- `push2 .../kamt.kline/get` 已彻底不用（对本场景无任何有效字段）

**历史修复**：
- **2026-09-22** — 涨跌家数口径修复：`breadth()` 原来读 `f168/f169/f170`（实测是上证指数的**换手率/涨跌额/涨跌幅**，未传 `fltt=2` 时放大 100 倍），返回「68/873/22、合计 963」这种半截数据；改为 `ulist.np/get` 的 `f104/f105/f106`（上证指数=沪市全体、深证成指=深市全体），沪深合计约 5286 只，新增 `scope`/`date` 字段。涨跌停家数原来取 `f292/f293`（实测与涨跌停无关，指数与个股都返回 `3`/`-1|0`），改为 push2ex 涨/跌停池的 `tc`。详见 `service/src/providers/eastmoney/marketBreadth.ts`

### 板块数据 (market sectors)

- **`push2.eastmoney.com/api/qt/clist/get`（行业+概念板块列表）被反爬切断**：直连/代理、IPv4/IPv6、curl/undici 全部 `SSL_read: unexpected eof`（`other side closed`）；同一 host 的 `ulist.np/get`（涨跌家数）与 `push2ex`/`datacenter-web` 正常（`push2his` 的 kline 接口后来也被切断，见「K 线 / 近7日A股成交量」）。实测 2026-09-29 是当日唯一持续报错的调用（26/26）。**行业板块因此长期走 akshare 同花顺降级**（`source: 'akshare_ths'`），代价是 `code` 为空串（→ `/market/sectors/:code/constituents` 对该批数据不可用），**不打算再绕网络**。
- **概念板块只有 AI 工具，没有页面**：`GET /api/market/concept-sectors`（`getMarketConceptSectorsFromAkshare`）→ `data_complete.py --type concept_spot` = 同花顺 `stock_fund_flow_concept('即时')` 行情主表（387 个概念，按涨跌幅降序，每次现取 ~2s）+ `stock_board_concept_summary_ths()` 驱动事件（约 10s，单独 `file_cache` 24h，失败即忽略）。**不走 EastMoney**。
- **踩过的坑（2026-09-29 修复）**：`toolHandlers.get_concept_sectors` 曾误按 `unpack(res)?.data?.items` 解析，而该路由的 `data` 是**扁平数组**（和 `/market/sectors` 同款信封），所以恒返回空 `items`；并且它早期直接复用了**行业**板块端点（`m:90+t:2`），契约里写的「驱动事件/成分股数量」从未接通。
- **AI 工具状态条**：请求成功但结果无可用数据时显示黄色感叹号 + 「暂无数据」（`frontend/src/services/chatEngine/toolResultStatus.ts` → `ToolCallStatus.status = 'empty'` → `ChatPanel.vue`）。判定按**数据内容**而非 `data_status`——北向资金恒为 `unavailable` 但成交总额有效，不会误报黄色。新增数据工具请复用它，别再在组件里写状态判断。

### K 线 / 近7日A股成交量 (market kline & volume)

2026-09-29 起 A 股 K 线链路曾整体失效，连带「近7日A股成交量」为空。

**链路**：`/api/market/volume/7days` → `getAVolume7Days()` → `getMarketKline('sh000001'|'sz399001')`
→ `ProviderChain([joinquant, tencent, stock-sdk, eastmoney])` → 失败才落 Python `data_complete.py --type kline`。

**根因（两层）**：
1. 4 个 provider 全挂：joinquant 无 key；旧的腾讯端点 `web.ifzq.gtimg.cn/app/app/kline/kline` 失效（返回 `{"code":11,"msg":"No dispatch info found"}`）；stock-sdk 与 eastmoney 的 kline 都走 `push2his.eastmoney.com`，而该 host（含 `33/63/7/91.push2his` 子域）已被反爬切断（`RemoteDisconnected` / `ERR_EMPTY_RESPONSE`），只剩 `push2ex`/`datacenter-web` 可用。
2. 唯一能用的回退 akshare（`stock_zh_index_daily`，新浪源）在 `python/cli/data_complete.py:95` 硬编码 `"amount": None`，而 `getAVolume7Days()` 只收 `amount != null` 的行 → 全部被过滤，返回 `{success:true, data:[]}`。

**修复**：
- `TencentMarketProvider.kline()` 改用腾讯新格式端点 `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?param=<code>,<period>,<start>,<end>,<count>,<fq>`（备用 `web.ifzq.gtimg.cn/appstock/app/fqkline/get`，但只有 6 列、无成交额）。行内 **`[8]` = 成交额（万元）**，写回 `KlineDto.amount` 时 `×1e4` 转**元**（与 EastMoney/akshare 对齐）；`[5]` = 成交量（手）、`[7]` = 换手率。指数 node 键为 `day/week/month`，个股复权为 `qfqday/hfqday`。`count` 才是返回条数（`start` 只是钳制），所以先取足量、再按 `[startDate,endDate]` 过滤。
- `getAVolume7Days()` 不再谎报：`allSettled` 的 rejection 与「结果为空」都会 `logger.error`，空结果返回 `success:false`。
- 同一修复也恢复了个股 K 线（`StockPopup` 走 `/api/market/kline/:code`）。

**测算/验证口径**：2026-09-29 上证 `[8]=66170429.28` 万元 == 同响应 `qt` 的 `661704292801` 元；`sz600000` `[8]=73974.10` 万元 ≈ `805097 手 × 100 × 9.18 元`。

**注意**：`market:kline:*` TTL 1h 且为内存缓存，改完需重启 service 才能即时看到新数据。

**仍存在**：`python/cli/data_complete.py` 的 akshare kline 只支持指数且无 `amount`（`stock_zh_index_daily`），个股 Python 回退会返回空；baostock 分支当前也无输出。
