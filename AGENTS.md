# GoFundBot — Agent Guide

## Architecture

> **权威说明看文档**：`docs/architecture/node-core.md`（分层 / 存储 / 共享内核 / 数据流 / 踩坑）与
> `docs/architecture/pi-tools.md`（工具面）。这里只留 agent 动手前必须知道的事实。

1. **service**（8310）— Node/Express/TS：数据获取（ProviderChain）+ SQLite 存储 + 计算（`packages/core`）+ 工具面 `/api/agent/*` + 策略代码沙箱。**不做 LLM、不持密钥**，只绑 `127.0.0.1`。
2. **frontend**（8517）— Vue 3 + Vite，只做展示与工作台（计算归 service / `packages/core`）；`/api` 走 Vite 代理。dev 服务**故意绑所有网卡**（用户要求保留局域网访问，见 node-core §7「有意接受的风险」）。
3. **Electron 桌面壳**（外部项目，可选）— 解禁 CORS 的浏览器窗口，加载运行中的前端 dev 服务；前端同一份代码、无运行时分支。
4. **Python**（`python/`）— 只做数据补全（akshare/eastmoney），无 HTTP 服务，由 service `child_process.spawn()` 调（stdin/stdout JSON）。

**User data lives in the service's SQLite**（P2，2026-10-07）；前端**已无 Dexie/IndexedDB**（2026-10-08 加固删掉）：
- 用户数据（归 service）：watchlist(+groups)、positions、strategies、strategy_scripts（`service/src/db/migrations/002_user_data.ts`）
- 缓存（**P3.4 起都在 service SQLite**）：净值序列（`nav_history`，覆盖度判断 + 10 年保留 / 300 万行上限）、筛选库（`screening_funds`）
- 记录形状（原 Dexie 接口）在 `frontend/src/types/records.ts`

## Data flow

> 完整链路见 `docs/architecture/node-core.md` §5 与 `docs/architecture/data-flow.md`。

- 实时行情/板块/资金流：ProviderChain → service → 前端（内存缓存，TTL 见 `/api/health`）。
- 用户数据与缓存**都在 service SQLite**（迁移 001~006）；前端只走 HTTP，**没有 IndexedDB**。
- 回测：页面在浏览器 Worker 跑、pi 走 `/api/agent/call` 的服务端沙箱，**同一份 `packages/core` 引擎**；净值都从 `/api/funds/:code/nav-history`（SQLite 切片）取。
- 筛选：`/api/screening/sync`（快照 + 4433 排名，**立即返回**）→ 前端/pi 循环 `/api/screening/compute` 分批富化风险指标。
- pi 工具面：`.pi/extensions/gofund` 通用桥 → `GET /api/agent/tools` → `POST /api/agent/call`；写/执行类要确认令牌。
- 搜索：`POST /api/search`（Exa → DuckDuckGo，无 key）；**AI 只在终端 pi**，service 不做 LLM。

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
bun run test             # vitest run

# frontend
cd frontend && bun install
bun run dev              # port 8517, proxy /api → localhost:8310
bun run lint             # ESLint (max-lines 500, Vue/TS)
bunx vue-tsc --noEmit    # TypeScript typecheck
bun run test             # vitest run
bun run build            # output in frontend/dist/

# Desktop (Electron shell — external project, CORS-free). 需先启动 Node + 前端 dev 服务：
cd frontend && bun run dev    # 前端 dev 服务 :8517
# 用 Electron 浏览器壳打开 http://localhost:8517

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

GitHub Actions 已移除（`.github/workflows/ci.yml` 已删）。**改完直接跑一条命令**（含 docs 构建，约 1 分钟）：

```bash
bun run check            # service lint/typecheck/test + frontend lint/vue-tsc/test/build + docs build
bun run gen:tools        # 改了 service/src/agent/ 必须重跑（否则漂移单测会失败）
```

单文件 ≤500 行（超限直接 lint 失败）；python 侧单独跑（ruff 配置在 `python/pyproject.toml`）：

```bash
# 分步（需要定位时）
cd service && bun run lint && bun run typecheck && bun run test
cd frontend && bun run lint && bunx vue-tsc --noEmit && bun run test && bun run build
cd docs && bun run build
python/.venv/bin/ruff check python/ && python/.venv/bin/ruff format python/ --check
python/.venv/bin/python python/cli/check_file_length.py
```

## Key details

- **Rate limiting**: `express-rate-limit` (300/15min)；**`/api/agent/*` 例外**（3000/15min）—— pi 一次分析会连着调十几个工具。
- **监听地址**: 默认 `127.0.0.1`（`HOST` 覆盖）。service 承载用户数据后不再默认暴露局域网。
- **策略代码沙箱（3.4③，2026-10-07）**: `node:worker_threads`，与浏览器 Worker 同款全局遮蔽 + 5s 超时 `terminate()`。**不是硬沙箱**（动态 `import()` 关不掉，见 `sandbox/strategyWorker.ts` 说明），所以 `run_strategy_code` 属**执行类**工具，需确认令牌。
- **pi 工具面（P4，2026-10-07；2026-10-08 加固 + 补全到 55 个）**: service 是工具契约唯一真源 —— `GET /api/agent/tools`（**55 个工具**：市场/基金/快讯 15 + 自选 7 + 告警 6 + 实时组合 9 + 回测 3 + 筛选 3 + 投研 1 + 用户数据 11（策略 3 + 方案 4 + 持仓 4））、`POST /api/agent/call`（Zod 校验 → 执行 → 截断 30k 字符）。写/执行类（共 25 个：自选 6 + 告警 3 + 实时组合 8 + 持仓 3 + 策略/方案 4 + 代码回测 1）第一次只回 `CONFIRM_REQUIRED` + 令牌，参数一致才能落库（`agent/confirm.ts`）。扩展端不再抄任何映射。静态清单用 `bun run gen:tools` 重新生成。
- **服务端计算（P3.2，2026-10-07）**: `POST /api/backtest/fixed-investment` · `/portfolio` · `/compare-strategies` ——
  用 `packages/core` 的引擎（与前端同源同值），参数沿用**聊天时代的 snake_case**（`toolArgs.ts` 映射），
  净值走 `/api/funds/:code/nav-history` 的 provider 链 + 24h 缓存。语义：结构错误 → 400，取数/数据不足 → 200 + `data.error`。
- **共享计算内核**: `packages/core`（`@gofund/core`）—— 两边直连源码，service **用相对路径** import（别名只对 tsx/类型检查生效，`tsc` 产物会保留别名 specifier）。
- **SQLite**: `service/src/db/`（`node:sqlite`）。首次 `getDb()` 执行迁移；`transaction()` 为手工 BEGIN/COMMIT 包装（不支持嵌套）。
- **Input validation**: Zod schemas on key POST routes.
- **Security headers**: service uses `helmet` (CSP/COEP disabled).
- **Structured logging**: JSON via `core/logger.ts` (service) with `requestId` per request. Daily files `dataservice-YYYY-MM-DD.jsonl` under `python/Data/logs`.
- **Health check**: `GET /api/health` — includes cache stats.
- **Cache TTLs**: fund estimates 30s, market quotes 15s, history 24h, dividends 7d；**筛选整表**（进程内，写库即失效）与**投研看板**（60s + 数据版本）另算。
- **启动自检（2026-10-08）**: `service/src/index.ts` 启动时探测 `node:sqlite`（`new DatabaseSync(':memory:')`），不可用就打印人话并 `exit(1)`。
  运行时下限 `engines: >=22.19.0`（由 `undici@8` 决定）；`node:sqlite` 自 22.13 起免 flag。
- **净值缓存容量（2026-10-08）**: `navCacheService` 写入时裁掉 10 年以前（`NAV_RETENTION_DAYS`），全库 >300 万行按 `fetched_at` LRU 整只淘汰（`NAV_MAX_POINTS`）；
  `/api/health` 的 `nav_cache` 报 `maxPoints` / `retentionDays` / `trimmed` / `evicted`。
- **Vite proxy**: `frontend/vite.config.ts` proxies `/api` → `localhost:8310`, `/docs` → `localhost:8574`.
- **用户数据/缓存都在 service**：`service/src/db/`（SQLite，迁移 001~006）+ `services/{userDataService,screeningService,navCacheService,researchService,backtestService,alertService,portfolioService}.ts` +
  `routes/{watchlist,positions,strategies,backtest,research,alert,portfolio}.routes.ts`；前端 `db/*.ts` 只是 HTTP 薄封装（导出签名不变）。
  **Dexie 依赖与 `db/index.ts` / `db/migrateToServer.ts` 已删除**（2026-10-08），旧 IndexedDB 数据留在浏览器里但不再被读。
- **实时页组合/告警（2026-10-08）**：`/api/user/portfolio/*`（组合基金/分组/映射/交易）与 `/api/alerts`（规则 CRUD + 真评估 + 异动配置）**已从桩换成真 SQLite CRUD**（迁移 005/006）。持仓（share/cost）不落表，由已结算交易推导。
- **已知缺口**：实时页的「清除持仓」只改前端内存（不调接口）；异动检测的 `north_*` 阈值无数据可判（北向净流入已停止披露）。
- **Settings endpoint**: `GET/PUT /api/settings` — **仅 proxy 子域**（落 SQLite）。应用不持有 LLM/搜索密钥（pi 是唯一 AI）。
- **搜索网关**: `POST /api/search`（Exa 免费 → DuckDuckGo 降级；`service/src/ai/search.ts`）——无 key，留给需要 HTTP 搜索的服务端调用方。
- **AI 定位（2026-10-07）**: 前端 AI 层（chatEngine / analysis / 两位分析师 / ChatPanel / 设置里的密钥页）**已全部删除**；AI 由**终端 pi** 承担（`.pi/extensions/` + `.pi/skills/`）。service 不做任何 LLM 调用。
- **Search chain（service）**: Bocha → Tavily → Exa（免费无 Key）→ DuckDuckGo（自动降级）；`service/src/ai/search.ts`。
- **投研看板（P3.4）**: `GET /api/research/dashboard`（core `buildDashboard`，读 SQLite 筛选行）。payload 里**不再带全量基金行**（曾经 1.6MB），汇总口径（`pass_4433` / `risk_ready`）由 core 算好，前端与 pi 工具共用紧凑版（`compactDashboard`）。进程内缓存 60s，key 含 `screeningDataVersion()`（同步/富化/排名后自动失效）。
- **Screening（P3.3 起在 service）**: `/api/screening/sync`（快照 + 行业标签 + 4433 排名；**默认 `enrich_limit=0`，不再阻塞首屏**）、`/compute`（分批富化风险指标，默认 300/批）、`/ranks`、`/query`（筛选/排序/分页，读进程内整表缓存）、`/status`、`/industry-tags`、`/screen-rows`（沙箱 `sdk.screen()` 的 7 列）。数据落 SQLite `screening_funds`；前端 `useScreeningDb` 只是薄客户端（本地 `screeningFunds` 表已删），同步后**后台**分批富化并把 `syncing` 保持到追平。`/query` 的过滤语义与迁移前逐条对齐（含 `max_drawdown_*_max` 都读 `max_drawdown_1y` 这类历史口径）。
- **Proxy**: 国内 API（东方财富）用 `proxy: 'never'` 直连；Yahoo Finance（被封）走 `proxy: 'auto'` 随代理配置。`eastmoneyRequest.ts` 统一添加 `Referer` 头防止反爬。
- **Docs**: VitePress 构建的文档站，配置在 `docs/.vitepress/config.ts`（nav + sidebar）。模块级详细文档按功能目录组织（如 `docs/fund-screening/`），在侧边栏对应分组。文档通过 frontend `/docs/*` 代理访问。

> 模块级详细文档见 `docs/` 目录（VitePress 构建），每个功能模块对应独立的 `.md` 文件或目录，侧边栏分组见 `docs/.vitepress/config.ts`。

## Monorepo hot spots

| Directory | What |
|-----------|------|
| `service/src/` | Express app with ProviderChain, all routes |
| `service/src/app.ts` | App bootstrap — route registration, middleware |
| `service/src/routes/` | All Express route handlers (fund, market, screening, backtest, research, agent, settings, etc.) |
| `service/src/services/` | 数据层与计算服务（fundService, marketService, pythonRunner, settingsService（SQLite）, **userDataService**（用户数据 CRUD）, **backtestService**（core 回测引擎）, **screeningService**（筛选存储+富化+查询）, **navCacheService**（净值缓存 + 覆盖度）, **researchService**（投研看板聚合））|
| `service/src/ai/` | 搜索网关（`search.ts`，Exa→DDG，无 key）。service **不做 LLM 调用** |
| `service/src/providers/` | ProviderChain implementations (stock-sdk, eastmoney, tencent, yahoo)；eastmoney 的涨跌家数/北向资金实现在 `eastmoney/marketBreadth.ts`、`eastmoney/marketNorthFlow.ts` |
| `service/src/core/` | Infrastructure (logger, cache, errors, response, providerChain) |
| `service/src/db/` | **SQLite 连接与迁移**（Node 内置 `node:sqlite`，零依赖）。用户数据/设置/缓存的唯一真源；文件路径由 `core/dbPaths.ts` 决定（`GOFUND_DB_PATH`，默认 `service/data/gofund.db`，测试用 `:memory:`）。迁移只追加不改，`schema_version` 记版本 |
| `service/src/types/` | DTO interfaces (fund.ts, common.ts) |
| `python/cli/` | Python CLI scripts (data_complete, fetch_fund) |
| `python/cli/shared/` | Shared Python utilities (file_cache) |
| `frontend/src/services/backtest/` | **回测的「取数/执行」胶水**（计算本体在 `packages/core`）：`runBacktestForFund.ts`（取 NAV + 调 core 引擎）、`runPortfolioBacktest.ts`、`dataBroker.ts`（向 service 要净值 + 限并发/每轮预算）、`runStrategyCode.ts` + `strategyWorker.ts`（Worker 两段调用 plan/run，5s 超时）、`scriptRun.ts`、`backtestTypes.ts`（兼容性转出 core）。持久化在 service SQLite（`/api/backtest-scripts`）；净值缓存在 service `nav_history` 表 |
| `frontend/src/composables/useScreeningDb.ts` | 筛选的**薄 HTTP 客户端**（P3.3）：`syncFromServer`（/sync → 循环 /compute 富化到底）/ `getStatus` / `queryFunds` / `compute4433`，签名与迁移前一致；4433 算法已移到 `@gofund/core/screeningEnrich` |
| `frontend/src/services/screeningRows.ts` | 沙箱 `screen()` 的基金池（`GET /api/screening/screen-rows`，进程内缓存 10min） |
| `frontend/src/services/researchComputation.ts` | 投研看板聚合计算（市场统计/基金看板/ETF/板块/行业表现） |
| `frontend/src/services/httpClient.ts` | HTTP 适配器（统一浏览器 fetch；Electron 壳侧解禁 CORS，无运行时分支） |
| `frontend/src/db/` | **服务端数据客户端的薄封装**：`positions.ts` / `strategyMemory.ts` / `strategyScripts.ts` 内部转发到 `services/userDataApi.ts`（保留原签名）。Dexie schema 与一次性导入已删除（2026-10-08） |
| `frontend/src/types/records.ts` | 用户数据 / 筛选结果的记录形状（原 `db/index.ts` 的类型定义） |
| `frontend/src/db/positions.ts` | 持仓 CRUD（**内部走 `/api/positions`**）：`useMyPositions` 使用 |
| `frontend/src/composables/` | Vue composables (useFundScreening, useResearchDashboard, useFundDetail, useAppSettings, etc.) |
| `frontend/src/stores/` | Pinia stores (watchlistStore 内部走 `/api/watchlist`) |
| `frontend/src/services/` | API client（api.ts 基于 httpClient 环境路由、portfolioApi.ts、docLink.ts） |
| `docs/` | VitePress 文档站（`docs/.vitepress/config.ts` 导航/侧边栏配置） |
| `service/src/agent/` | **工具注册表（工具契约的唯一真源）**：`tools.ts`（清单组装）+ `toolsMarket/toolsFund/toolsWatchlist/toolsAlert/toolsPortfolio/toolsPositions/toolsCompute.ts`（55 个工具，Zod 参数 + 直接调 service 内部函数）+ `fundLookup.ts`（按代码补名称）+ `confirm.ts`（写操作确认令牌）。参数用 **Zod**，`z.toJSONSchema()` 派生成 pi/OpenAI 的 JSON Schema |
| `service/src/routes/agent.routes.ts` | `GET /api/agent/tools`（清单）、`POST /api/agent/call`（校验 + 执行 + 结果截断 + 写操作确认门） |
| `service/src/sandbox/` | **策略代码沙箱（Node）**：`strategyWorker.ts`（worker 入口，抹掉宿主全局）+ `runStrategyCode.ts`（宿主：plan → 取净值 → portfolio，5s 超时 `terminate()`）。隔离是 **best-effort**：`new Function` 里关不掉动态 `import()`（浏览器里是语法错误，Node 不是）→ 真正边界是「用户确认令牌」。worker 文件后缀按当前模块推断（dev `.ts` / dist `.js`） |
| `.pi/extensions/gofund/` | **pi 通用桥**（不再定义具体工具）：启动时拉 `/api/agent/tools`（**55 个工具**）逐个 `registerTool`；服务离线 → 用 `tools.manifest.ts`（`bun run gen:tools` 生成）；都没有 → 只注册 `gofund_call(tool, args)`。配套 skill `.pi/skills/gofund-data/SKILL.md` |
| `.pi/skills/gofund-strategy/SKILL.md` | 策略读写工作流（`list_strategies` / `save_strategy` + 确认门），以及「给用户看页面就调 bow 的 `browser_*`」 |
| `packages/core/` | **共享计算内核 `@gofund/core`**（纯 TS，仅依赖 decimal.js）：回测引擎、组合引擎、策略沙箱、CPython 兼容、风险指标（`computeRiskMetricsLocal`）、行业分类、投研聚合。**前端与 service 同源同值**（前端走 vite alias/vitest alias 直连 src；service 用相对路径引 `packages/core/src`，不做 dist）；core 内相对 import 必须带 `.js` 后缀。黄金 fixtures 两侧各跑一次（`frontend/src/__tests__` + `service/src/__tests__/services/core-golden.test.ts`）。见 `packages/core/README.md` |
| `packages/ui/` | **UI 组件库 `@gofund/ui`** — B* 系列表单控件与浮层/反馈组件、设计 token（明暗双主题）、composables；Vite lib mode 构建（组件级 chunk + dts）；frontend 经 vite/tsconfig 别名直连 `packages/ui/src/index.ts`（`@gofund/ui`），开发 HMR 与构建均从源；`file:../packages/ui` 仅为发布用依赖声明 |
| `docs/fund-screening/` | 基金筛选模块细分文档（概览/数据流/筛选面板/指标丰富化/4433法则） |
| `docs/market-*.md` | 市场数据各功能模块说明文档 |
| `docs/architecture/` | 技术架构文档（数据源/数据流/回退策略/AI分析等） |
| `docs/strategy/` | 策略板块文档（概览/策略记忆与AI注入） |
| `frontend/src/db/strategyMemory.ts` | 策略记忆 CRUD（**内部走 `/api/strategies`**）+ `buildStrategyContext()` 上下文格式化 |
| `frontend/src/views/StrategyView.vue` | 策略板块 UI（记忆列表/编辑表单；供 pi 通过 dev 桥读写） |

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
- **概念板块只有 API/pi 工具，没有页面**：`GET /api/market/concept-sectors`（`getMarketConceptSectorsFromAkshare`）→ `data_complete.py --type concept_spot` = 同花顺 `stock_fund_flow_concept('即时')` 行情主表（387 个概念，按涨跌幅降序，每次现取 ~2s）+ `stock_board_concept_summary_ths()` 驱动事件（约 10s，单独 `file_cache` 24h，失败即忽略）。**不走 EastMoney**。
- **踩过的坑（2026-09-29 修复）**：`toolHandlers.get_concept_sectors` 曾误按 `unpack(res)?.data?.items` 解析，而该路由的 `data` 是**扁平数组**（和 `/market/sectors` 同款信封），所以恒返回空 `items`；并且它早期直接复用了**行业**板块端点（`m:90+t:2`），契约里写的「驱动事件/成分股数量」从未接通。

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
