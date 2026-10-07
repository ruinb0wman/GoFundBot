# 方案：以 Node 为核心重构 GoFundBot（数据 / 计算落 service，AI 由 pi 承担）

> 状态：**进行中**。用户决策：**Node 为核心**、**service 不做 LLM（pi 是唯一 AI）**、**前端 AI 已删除**、
> **用户数据与设置落 SQLite**、**分可验收阶段逐阶段执行**、**service 绑 127.0.0.1 无鉴权**。
> 前序材料：`pi-gofund-architecture.md`（现状）、`pi-gofund-node-migration-evaluation.md`（对比）、
> `pi-gofund-framework.md`（旧 A 路线，本方案取代其桥部分）。
> 反向前提：本次要**撤销**既有迁移决策，见 §2 —— AGENTS.md 与 `docs/architecture/` 必须同步改。
> 进度：P0 ✅ · P1 ✅（已收窄为无 key 搜索）· P1.5 ✅（删前端 AI）· **下一步 P2**。

---

## 1. 目标

把 service 从「薄数据后端」升级为 GoFundBot 的**唯一核心**：

1. **数据**：用户数据（策略/持仓/自选/方案/告警…）落 SQLite，前端不再持有用户态 Dexie。
2. **计算**：回测、风险指标、行业分类、投研聚合抽成 `packages/core` 纯 TS 包，service 与前端共用。
3. **AI**：**service 不做任何 LLM 调用、不持有任何密钥**——AI 由终端 **pi** 承担（`.pi/extensions/` + `.pi/skills/`）；
   前端 AI 层（chatEngine / analysis / 两位分析师 / ChatPanel / 设置里的密钥页）已删除。
   唯一保留的服务端 AI 相关能力是**无 key 搜索** `POST /api/search`（Exa → DuckDuckGo）。
4. **pi**：只剩 HTTP 一种传输；删除 `gofund-app` 扩展与 `window.__gofund` 桥。
5. **统一工具注册表**：Node 成为工具契约的唯一真源（`/api/agent/tools`），pi 的工具由它派生。

**产品形态变化（必须让用户知情）**：前端没有聊天/AI 分析入口，页面只做数据展示与工作台；
AI 交互全部由 pi（或以后任何 HTTP 客户端）承担。

---

## 2. 要撤销的既有决策（先记账，避免文档自相矛盾）

| 既有决策 | 出处 | 本方案如何处置 |
|---|---|---|
| 回测从 Python/Node 迁到前端 | `docs/architecture/backtest-engine.md:23-33` | 撤回「计算留前端」，改为 `packages/core` 共享，前端与 service 都引 |
| 风险指标从 Node 迁到前端 | `frontend/src/__tests__/utils/goldenRiskMetrics.test.ts:2-4`（"pre-frontend-migration"） | 同 core；黄金测试继续当回归锚 |
| 用户数据纯前端 CRUD 不经服务端 | `docs/architecture/data-flow.md:75-81` | 改为经 `/api`，Dexie 只留缓存 |

**曾经的候选、现已作废**：`AI 基金分析迁回 Node`、`LLM/Search key 迁回 service`——
因为 service 不做 LLM（pi 是唯一 AI），这两项不再存在（P1 曾实现过一半，已按 §9「路线修正」删除）。

同步更新：`AGENTS.md` 的 Architecture / Data flow / Monorepo hot spots / Key details；
`docs/architecture/{index,data-flow,ai-overview,ai-chat,ai-fund-analysis,ai-memory,backtest-engine}.md`；
VitePress 侧边栏。

---

## 3. 目标架构

```
                  ┌──────────────────────── service :8310（唯一核心，绑 127.0.0.1）────────────────────────┐
   pi ─HTTP──────▶│  routes/                                                          packages/core        │
   前端 ─HTTP────▶│   settings · userData · strategies · agent · compute · search        回测引擎/风险指标/  │
                  │  ai/        search（Exa→DDG，无 key）—— **不做 LLM**                行业分类/聚合/抽样  │
                  │  sandbox/   node:worker_threads（策略代码隔离，供 compute 用）        ↑ frontend 也用同一份 │
                  │  db/        SQLite：用户数据 + 缓存 + settings + 迁移器                                   │
                  │  services/  ProviderChain 行情 · pythonRunner · logService                                │
                  └───────────────────────────────────────────────────────────────────────────────────────┘
```

- 前端仍然是 Vue 3 SPA，但**用户数据经 HTTP**、**无 AI**、**计算调 HTTP（或引 core 本地跑，按延迟择优）**。
- pi 的工具由 service 的注册表派生（§4 P4），扩展里不再有业务映射副本。

---

## 4. 分阶段实施

每个阶段独立可验收、可回滚；每阶段结束跑对应回归（frontend lint/tsc/test/build、service lint/typecheck/test）。

### P0 —— 地基与安全（最小但不可省）

**目标**：service 有状态化的底座 + 不再对局域网裸露。

| 文件 | 改动 |
|---|---|
| `service/src/index.ts` | `server.listen(port, '127.0.0.1')`（当前 `listen(port)` 绑 0.0.0.0） |
| `service/src/db/index.ts`（新） | SQLite 连接、`PRAGMA journal_mode=WAL`、`schema_version` 迁移器 |
| `service/src/db/migrations/001_init.ts`（新） | `settings(key,value)` 表 + `schema_version` |
| `service/src/services/settingsService.ts` | 保留内存缓存，落库 SQLite；`proxy` 子域先迁（行为不变） |
| `service/package.json` | 加 DB 依赖（见 §7 实验 1 的选型结论） |

**验证**：`curl http://127.0.0.1:8310/api/settings` 正常；同机另一台设备访问 8310 失败；
重启 service proxy 设置仍在；`bun run lint && bun run typecheck && bun run test` 绿。
**回滚**：删 `db/`、还原 `settingsService`、还原 listen。

---

### P1 —— 搜索网关（无 key）（2026-10-07 ✅）

**原计划**是把密钥与 LLM/搜索能力落 service。执行到一半时用户明确 **pi 是唯一 AI**，
因此只保留了搜索部分，LLM 部分整块删除（详见 §9「路线修正」）。

| 文件 | 结果 |
|---|---|
| `service/src/ai/search.ts` | 保留，简化为 **Exa（免费）→ DuckDuckGo**（无 key） |
| `service/src/routes/search.routes.ts` | `POST /api/search`（body `{query, max_results?}`） |
| `service/src/ai/llm.ts`、`routes/llm.routes.ts`、`__tests__/routes/llm.test.ts` | **已删** |
| `service/src/services/settingsService.ts`、`routes/settings.routes.ts` | 回到 **proxy-only**（落 SQLite） |
| 前端 `services/{llm,searchService}.ts`、`useLLMConfig`、`useAppSettings`、两个密钥设置页 | **已删**（随前端 AI 一起） |

**验证**：service 116 tests / frontend 259 tests / 两端 lint+tsc / build 全绿；
`POST /api/search` 经代理真实返回结果（走 Exa 免费链）。

---

### P1.5 —— 删前端 AI（2026-10-07 ✅，原 P5 提前）

**动机**：service 不做 LLM 后，前端 AI 没有后端可依赖；用户要求「现在就删」。

**已删（≈40 文件）**：`services/chatEngine/`(11) · `services/analysis/`(4) ·
`services/{llm,searchService,chatApi,opencodeSession,fundAnalyst,portfolioAnalyst,strategyDraft,reflection}.ts` ·
`stores/chatStore.ts` · `db/analysisMemory.ts` ·
`composables/{useFundAIAnalysis,usePortfolioAIAnalysis,useLLMConfig,useAppSettings}.ts` ·
`components/{ChatPanel.vue,ChatPanel.css,ChatBubble.vue,CodeApprovalCard.vue,FundAIAnalysis.vue,FundAIAnalysis.css,PortfolioAIAnalysis.vue}` ·
`views/{SettingsLLM,SettingsSearch}.vue` · 19 个测试。
**保留**：`truncateJson` → `utils/json.ts`（回测抽样测试仍用）。
**修引用**：`App.vue` / `router` / `StrategyView` / `BacktestView` / `useBacktestWorkspace` /
`FundDetail` / `FundRealtime` / `FundBasicInfo` / `LogsViewer`（改调规则式 `POST /api/logs/analyze`）/ `httpClient`。

**验证**：见 §9「路线修正」（bundle 4074 → 3859 kB；真浏览器四个页面正常、无 AI 入口）。

---

### P2 —— 用户数据落 SQLite（2026-10-07 ✅）

**目标**：`userData.routes.ts` 的桩填实；前端用户态 CRUD 走 HTTP；pi 可用 HTTP 读写。

| 文件 | 改动 |
|---|---|
| `service/src/db/migrations/00x_userdata.ts`（新） | 表：`strategies`、`positions`、`watchlist`、`watchlist_groups`、`strategy_scripts`、`alert_rules`（`portfolio`/`trade_records` 视 UI 实况定） |
| `service/src/services/userDataService.ts`（新） | 各表 CRUD（含 `updatedAt`、排序字段语义与 Dexie 对齐） |
| `service/src/routes/userData.routes.ts` | 填实 watchlist/portfolio/alerts 桩 + Zod 校验 |
| `service/src/routes/strategies.routes.ts`（新） | `GET/POST/PUT/DELETE /api/strategies`、`/api/backtest-scripts` |
| `frontend/src/services/api.ts`（或新 `userDataApi.ts`） | 用户数据 HTTP 客户端 |
| 前端 14 处 `from '../db'` 调用点 | `useMyPositions` / `useFundWatchlist` / `watchlistStore` / `StrategyView` / `BacktestView` / `dataBroker` / `useScreeningDb` 等改走 HTTP |
| `frontend/src/db/index.ts` | 用户表停用（保留 schema 供一次性迁移）；缓存表保留 |
| 一次性导入 | 首启检测 Dexie 有用户数据 → `POST /api/user/import` → 成功后清空本地（幂等、可重跑） |

> pi 的用户数据工具（HTTP 读写）属于 **P4 工具面**，不在本阶段。

**验证**
- 前端功能逐个对照：自选增删排序、持仓增删改、策略保存/启用、方案保存/重命名/删除 —— 与迁移前一致。
- 断网（service 停）时的表现明确报错，不是静默丢数据。
- pi 不启浏览器即可读写策略/持仓/自选/方案（需 P4 的工具面就位后）。
- 一次性导入在「有数据/无数据/重复运行」三种情况下都幂等。

**回滚**：上一阶段的前端代码 + 保留的 Dexie schema；service 新表不影响旧路径。

---

### P3 —— 计算抽包 `packages/core`（3.1 ✅ 3.2 ✅ 3.3 ✅；3.4 ① ② ③ 全部 ✅）

**目标**：纯 TS 计算两端共用；service 提供计算路由；缓存搬 SQLite。

| 文件 | 改动 |
|---|---|
| `packages/core/`（新） | 从 `frontend/src/services/backtest/*`（引擎/组合/规则/对比/抽样/pyCompat/toolArgs/backtestTypes）、`industryClassifier.ts`、`researchComputation.ts`、`utils/number.ts` 抽出；无 DOM/Dexie/Worker 依赖 |
| `frontend/vite.config.ts` + `tsconfig` | 加 `@gofund/core` 别名（照 `@gofund/ui` 的做法） |
| `service/tsconfig.json` + `package.json` | 同法引用 `@gofund/core` |
| `service/src/db/migrations/00x_cache.ts`（新） | `nav_history`、`screening_funds`（原 Dexie 缓存） |
| `service/src/services/computeService.ts` + `routes/compute.routes.ts`（新） | `/api/backtest/*`、`/api/screening/compute`、`/api/research/*`；富化与限并发搬过来 |
| `service/src/sandbox/`（新） | `strategySandbox.ts` + `strategyWorker.ts` 移植到 `node:worker_threads`（隔离强度见 §7 实验 4）；供 `run_strategy_code` 类工具用 |
| `frontend/src/services/backtest/dataBroker.ts` | 缓存读写改调 service（或保留本地缓存 —— 用户已选「前端不存用户数据」，故走 service） |
| `frontend/src/composables/useScreeningDb.ts` | 富化改调 `/api/screening/compute` |

**验证（关键）**
- 黄金 fixtures（`frontend/src/services/backtest/__fixtures__/{engine,pyround,isoweek}.json`）在 **service 侧**逐值通过。
- `computeRiskMetricsLocal` 的既有黄金测试继续通过（core 版本）。
- 前端页面数字与迁移前一致（回测曲线、筛选指标、投研看板）。
- 实测富化耗时与限流（§7 实验 3），必要时加队列。

**回滚**：core 是新增包；service 路由新增；前端可暂留原实现（先双跑对比再切换）。

---

### P4 —— 服务端工具面（`/api/agent/tools`）（2026-10-07 ✅）

**目标**：Node 成为工具契约的唯一真源，pi 的工具由它派生（清偿 AGENTS.md 记的「刻意抄一份映射」的债）。
**注意**：不再包含任何「把 chatEngine / 分析场景搬到 Node」的工作——那些已随前端 AI 删除（P1.5）。

| 文件 | 改动 |
|---|---|
| `service/src/agent/tools.ts`（新） | 工具注册表：name / description / JSON Schema / annotations（readOnly / destructive）/ 处理器（**直接调 service 内部函数**，不走 HTTP 自调用） |
| `service/src/routes/agent.routes.ts`（新） | `GET /api/agent/tools`（清单）、`POST /api/agent/call`（校验 + 执行 + 截断与口径映射） |
| `.pi/extensions/gofund/index.ts` | 改为**异步工厂**：`await fetch('/api/agent/tools')` → 逐个 `pi.registerTool()`（pi 文档支持异步工厂） |
| 降级 | service 未启动 → 静态清单 `.pi/extensions/gofund/tools.manifest.json`（`bun run gen:tools` 生成）；再无清单 → 只注册一个 `gofund_call(tool, args)` |
| 写入/执行类 | 服务端返回 `CONFIRM_REQUIRED`，pi 侧展示确认后再带令牌调用 |

**验证**：`/api/agent/tools` 清单与 pi 实际工具一致；`gofund_call` 与类型化工具结果一致；service 停掉时降级可读。

---

### P5 —— 删桥 + pi 走纯 HTTP（2026-10-07 ✅）

| 文件 | 动作 |
|---|---|
| `.pi/extensions/gofund-app/` | 整体删除（含 `browser.ts`、`tools/strategy.ts`） |
| `frontend/src/services/devBridge.ts` | 删除 |
| `frontend/src/main.ts` | 去掉 `installDevBridge` |
| `.pi/skills/gofund-strategy/` | 删除（策略改走 HTTP） |
| `frontend/src/db/strategyMemory.ts` | 去掉变更事件（无页面监听者） |

**验证（终局）**：`grep -rn "__gofund" frontend/src frontend/dist` 为空；
pi 不启动 bow/浏览器即可查行情、读写策略/持仓/自选/方案、跑回测。

---

### P6 —— 文档与仓库收口（2026-10-08 ✅）

- `AGENTS.md`：Architecture / Data flow / Commands / hot spots / Known issues 全量改写（Node 核心、无桥）。
- `docs/architecture/`：改 `index`、`data-flow`、`ai-*`、`backtest-engine`（撤销「为什么迁移」）；
  新增 `node-core.md`（本方案）。
- 把 `pi-gofund-architecture.md`（改成现状+新架构）、`pi-gofund-node-migration-evaluation.md`（保留为决策记录）
  移入 `docs/architecture/` 并挂 VitePress 侧边栏。
- 删除 `.pi/skills/gofund-strategy/`（策略不再走桥）、更新 `gofund-data` 技能到新工具面。
- `service/package.json`：删掉无人引用的 `openai` 依赖（`ai/llm.ts` 已删，服务端不用任何 LLM SDK）。

---

## 5. 验收标准（整体）

1. service 是数据与计算的唯一真源；**应用不含任何 LLM 调用与密钥**；前端不含用户态数据。
2. pi 全程 HTTP，不需要浏览器；headless/CI 可用。
3. 现有数字口径零回归：黄金 fixtures 在 service 侧通过；筛选/回测/投研页面数字不变。
4. 工具契约一处定义（`/api/agent/tools`），pi 侧不再有第二份映射逻辑。
5. `127.0.0.1` 绑定生效；应用不持有任何密钥。
6. 每阶段单独可回滚，回滚不需要数据恢复。

---

## 6. 风险与未知

| 风险 | 处理 |
|---|---|
| **产品面收窄**：前端已无 AI 入口，AI 交互全在 pi | 已告知用户；若日后要在页面上展示分析结论，只加「渲染服务端/pi 结果的只读面板」，不恢复 chatEngine |
| **一次性导入丢数据** | 导入前自动导出 JSON 备份；导入幂等；保留 Dexie schema 一个版本 |
| **沙箱语义变化**（`node:worker_threads` 能否等强度隔离） | §7 实验 4；不达标就上 `vm`/`isolated-vm`，并把「执行策略代码」的确认门禁写成硬要求 |
| **筛选富化限流**（3000+ 基金 × NAV，service 限流 300/15min） | §7 实验 3；加队列/缓存/提内部限额 |
| **前端在线性下降**（用户已选不存用户数据） | 本机 HTTP 通常可接受；慢页面（筛选/投研）允许保留只读内存缓存（非 Dexie 持久化） |
| **文档/认知成本**（反向迁移与已删的前端 AI） | P6 集中改文档；每阶段在 AGENTS.md 标注进展 |
| **异步工厂在 service 未启动时的 pi 启动** | 静态 manifest + 泛化工具三级降级 |
| **P4/P5 体量** | 已变小：AI 引擎搬迁取消（P1.5 直接删除）；P4 只建注册表，P5 只删桥 |

---

## 7. 动手前必须做的实验（P0 内完成 1，其余各阶段前完成）

1. ~~**SQLite 选型**~~ **已完成**：选 `node:sqlite`（本机 Node 26 免 flag；WAL/事务实测通过；零依赖）。
2. **回测端到端耗时**：service 侧复用 `nav-history` 缓存后，3 年日频一次回测的端到端时间；
   若 > 现有前端体验，考虑计算走 core 在 Node、结果缓存（`lastSummary` 已有字段）。
3. **富化限流**：用真实 `screeningFunds`（约 3000+）跑一次 service 侧富化，测耗时、内存、
   与 300/15min 限流的冲突，决定是否给内部调用开白名单或排队。
4. **沙箱等价性**：`node:worker_threads` 复现 `BLOCKED_GLOBALS`（fetch/fs/child_process 不可达）的能力；
   不达标就评估 `vm` / `isolated-vm`（后者引入原生依赖）。
5. **前端 CRUD 回归清单**：把 14 处 `from '../db'` 逐条列出「页面行为 → 迁移后断言」，
   P2 用它做验收脚本。

---

## 8. 待确认（评审时回复；不回复按推荐走）

1. **页面展示位**：pi 的分析结论要不要在页面上有个只读展示位？（推荐：先不做，需要时再加一个薄面板）
2. ~~**聊天历史**~~ **已随 P1.5 废弃**：`chatSessions`/`chatMessages` 已无写入方（表声明暂留，P6 清理）。
3. **pi 工具形态**：manifest 动态注册（推荐，类型化）vs 单一 `gofund_call` 泛化工具（更省 token，模型更易用错）。
4. **`packages/core` 消费方式**：前端引 core 本地算（低延迟）vs 一律调 service（单一真源）——
   推荐「本地算 + service 兜底」，但用户已选「前端不存用户数据」，此项只影响**计算**不影响数据。

---

## 9. 执行记录

### P0 —— 地基与安全（2026-10-07 完成）

**选型实验结论**：本机 Node **v26.10.0**，`node:sqlite` **免 flag** 可用（WAL + 事务实测通过），
且 `@types/node` 22.19.21 已带 `sqlite.d.ts` → **选 `node:sqlite`，零依赖、无原生编译**。
（engines 仍写 `>=22.19.0`；22.x 需 `--experimental-sqlite`，若将来要兼容 22 需在启动脚本补 flag。）

**落地文件**
| 文件 | 作用 |
|---|---|
| `service/src/core/dbPaths.ts` | `resolveDbPath()`，默认 `service/data/gofund.db`，`GOFUND_DB_PATH` 覆盖 |
| `service/src/db/index.ts` | `getDb()` 单例 + `transaction()` + `closeDb()` + `resetDbForTests()`；迁移执行器 |
| `service/src/db/migrations/{types,001_init,index}.ts` | `settings(key,value,updated_at)` + `schema_version` |
| `service/src/services/settingsService.ts` | 改写为 SQLite 持久化（缓存 + upsert），对外 API 不变 |
| `service/src/index.ts` | `listen(port, host)`，`host` 默认 `127.0.0.1`（`HOST` 覆盖）；shutdown 时 `closeDb()` |
| `service/.gitignore` | 加 `data/` |
| `service/.env.example` | 加 `HOST`、`GOFUND_DB_PATH` |
| `service/src/__tests__/db/migrations.test.ts`、`__tests__/services/settingsService.test.ts` | 迁移幂等、事务回滚、跨连接持久化、损坏行容错 |

**验证证据（真跑）**
- `service`: `bun run lint` ✓、`bun run typecheck` ✓、`bun run test` → **108 passed**（原 101，+7）。
- 独立端口 8399 + 临时库：启动日志 `host:127.0.0.1`；`GET /api/settings` 无行时回落 env 代理；
  `PUT` 后 GET 返回新值；**杀进程重启后 GET 仍是新值**（持久化成立）。
- 直接读库：`sqlite_master` = `schema_version` + `settings`；`schema_version.version = 1`；
  `settings.key='app'` 的 JSON 正确。
- `ss -ltn` 显示 `127.0.0.1:8310`（用户常驻 dev 服务经 tsx watch 热重载后已按新代码绑定）。

**未做（留给后续阶段）**：settings 的 llm/search 子域、用户数据表、缓存表。

### P1 —— LLM 网关与搜索（2026-10-07 完成）

**落地文件**
| 文件 | 作用 |
|---|---|
| `service/src/ai/llm.ts`（新） | 从前端 `llm.ts` 移植的 provider 客户端：JSON + 流式、重试、超时、全局代理 dispatcher、opencode session 头 |
| `service/src/ai/search.ts`（新） | 从前端 `searchService.ts` 移植的降级链（Bocha→Tavily→Exa→DDG） |
| `service/src/routes/llm.routes.ts`（新） | `POST /api/llm/chat`（SSE/JSON）+ `POST /api/llm/search` |
| `service/src/routes/settings.routes.ts` | GET 改安全视图（打码）；新增 `PUT /llm`、`PUT /search`；`PUT /` 保持 proxy 契约 |
| `service/src/services/settingsService.ts` | 扩展 `llm`/`search` 子域 + `maskSecret`/`getMaskedSettings`；空串=不修改、`clearXxx=true`=清除 |
| `service/src/core/fetch.ts` | 导出 `getProxyDispatcher()`（与 `proxy:'auto'` 同口径） |
| `service/src/app.ts` | `/api/llm` 挂载在全局 json parser 之前，自带 4mb 限制 |
| `frontend/src/services/llm.ts` | 改为 `/api/llm/chat` 薄客户端（导出 API 不变，调用点零改动） |
| `frontend/src/services/searchService.ts` | 改为 `/api/llm/search` 薄客户端 |
| `frontend/src/composables/useLLMConfig.ts`、`useAppSettings.ts` | 改为 server-backed（只拿打码预览） |
| `frontend/src/views/SettingsLLM.vue`、`SettingsSearch.vue` | 预览占位 + 清除按钮 + 错误提示 |
| 测试 | service：`__tests__/routes/{llm,settings}.test.ts`；frontend：`__tests__/services/llm.test.ts` 重写 |

**验证证据（真跑）**
- `service`：lint / typecheck 绿、**123 tests**（原 108，+15）。
- `frontend`：lint / vue-tsc 绿、**402 tests**（原 399，+3 net）、build 绿。
- 独立端口 8399 + 临时库 + **本地假 provider（127.0.0.1:8398）** 全链路：
  `PUT /settings/llm` → `GET /settings` 打码（不含明文，preview `****`）；非流式返回 `content/reasoning/usage`；
  **SSE 流式返回 reasoning + 逐 token + `[DONE]`**；`messages:[]` → 400；清空 key 后 → 400『LLM 未配置』；
  `PUT proxy` 后 `/api/llm/search` 走 Exa 免费链真实返回结果。
- 浏览器（bow tab 9 → Vite 代理 → 用户的 8310）：`fetch('/api/settings')` 返回新结构（`hasApiKey:false`，无明文）；
  `/settings/llm` 与 `/settings/search` 页面渲染正常（新文案 + 预览占位）。

**验证中发现的真 bug**：SSE 路由原用 `req.on('close')` 判断客户端断开 —— body-parser 读完请求流后它就触发，
导致 `closed=true`、一个字节都写不出去（supertest 读不到 body 才暴露）。改为 `res.on('close')`，并把该场景写成测试。

**需要用户知晓的行为变化**：LLM/Search 密钥不再从浏览器 localStorage 读取，
所以**必须在新的设置页重新填一次**（旧 key 不会自动迁移到 service）。

### 路线修正（2026-10-07）：pi 是唯一 AI，service 不做 LLM；前端 AI 立即删除

用户明确：「不需要密钥，直接用 cli 的 pi，pi 已经设置过密钥」。于是：

1. **撤销 P1 的 LLM 部分**：删除 `ai/llm.ts`、`routes/llm.routes.ts`、`__tests__/routes/llm.test.ts`，
   以及 `settingsService` 的 `llm`/`search` 子域与打码视图（回到 **proxy-only**），
   `core/fetch.ts` 的 `getProxyDispatcher()` 也一并移除（无人使用）。
2. **只保留无 key 的搜索**：`ai/search.ts` 简化为 **Exa（免费）→ DuckDuckGo**，
   路由改为 `POST /api/search`（`routes/search.routes.ts`），设置页里的密钥字段全部删掉。
3. **前端 AI 立即删除**（原 P4/P5 的合并与提前）：
   - 删目录：`services/chatEngine/`（11）、`services/analysis/`（4）
   - 删文件：`services/{llm,searchService,chatApi,opencodeSession,fundAnalyst,portfolioAnalyst,strategyDraft,reflection}.ts`、
     `stores/chatStore.ts`、`db/analysisMemory.ts`、`composables/{useFundAIAnalysis,usePortfolioAIAnalysis,useLLMConfig,useAppSettings}.ts`、
     `components/{ChatPanel.vue,ChatPanel.css,ChatBubble.vue,CodeApprovalCard.vue,FundAIAnalysis.vue,FundAIAnalysis.css,PortfolioAIAnalysis.vue}`、
     `views/{SettingsLLM,SettingsSearch}.vue`
   - 删测试 19 个（含 chatStore / ai 引擎 / 工具契约 / 四个 tool-level 用例）
   - 修引用：`App.vue`（去 ChatBubble）、`router`（去 llm/search 设置页）、`StrategyView`（去 ChatPanel + AI 起草）、
     `BacktestView`（去 ChatPanel 与「AI 代码」横幅）、`useBacktestWorkspace`（去 chatStore 扫描）、
     `FundDetail`/`FundRealtime`/`FundBasicInfo`（去分析组件与按钮）、`LogsViewer`（改调**规则式** `POST /api/logs/analyze`）、
     `httpClient`（去掉 opencode session 注入，`nativeFetch` 简化为纯 `fetch`）
   - 保留：`truncateJson` 搬到 `utils/json.ts`（回测抽样测试仍需要它）

**P4/P5 相应简化**：「把 chatEngine/分析场景搬到 Node」不存在了；剩下的是
**给 pi 暴露数据/计算/用户数据的工具面**（含 `/api/agent/tools` 注册表与删除 `gofund-app` 符）。

**验证证据（真跑）**
- `service`：lint / typecheck 绿、**116 tests**（删 llm.test 的 15，增 search/settings 8）。
- `frontend`：lint / vue-tsc 绿、**259 tests**（原 402，删 AI 用例）、**build 绿**（bundle 4074 → 3859 kB，CSS 366 → 331 kB）。
- 浏览器（bow tab 9，真 dev 服务）：reload 后 `#app` 正常挂载；`/strategy`、`/backtest`、`/portfolio`、`/fund/110022` 渲染正常；
  `.chat-panel` 不再存在；基金页无「AI 智能分析」按钮；设置里无 LLM/搜索入口。

**过程中踩到并修正的自家错误**（都是删标签时留下的）：
- 模板标签不配对：`BacktestView.vue` 删 `chat-panel-wrap` 时多删了 `</div>` 与 `<section class="workbench">`；
  `StrategyView.vue` 删面板时留下一个未闭合的 `<section>`；`vite build` 的 `Invalid end tag` / `Element is missing end tag` 才暴露（vue-tsc 不查模板配对）。
- 替换 import 时造出重复 import（`FundRealtime` / `BacktestView` / `FundDetail` 各一次）。

### P2 —— 用户数据落 SQLite（2026-10-07 完成）

**范围收敛（实测）**：数过 Dexie 表的实际引用，只有 **4 类资源**有调用点——
`watchlist`(11) / `watchlistGroups`(5) / `positions`(10) / `strategies`(5) / `strategyScripts`(7)；
`portfolio`/`tradeRecords`/`alertRules`/`chat*`/`analysisMemory`/`fundCache`/`marketCache` 均为 **0 引用**（历史遗留），
所以只搬这四类，比原计划小很多。自选调用点全集中在 `stores/watchlistStore.ts`。

**落地文件**
| 文件 | 作用 |
|---|---|
| `service/src/db/migrations/002_user_data.ts`（新） | `positions` / `strategies` / `strategy_scripts` / `watchlist` / `watchlist_groups` + 索引 |
| `service/src/services/userDataService.ts`（新） | 各表 CRUD（camelCase ↔ snake_case 映射、JSON 字段、事务、幂等导入） |
| `service/src/routes/{watchlist,positions,strategies,userImport}.routes.ts`（新） | `/api/watchlist`、`/api/positions`、`/api/strategies`、`/api/backtest-scripts`、`POST /api/user/import` |
| `service/src/routes/userData.routes.ts` | 移出 watchlist（只留 portfolio/alert 遗留桩） |
| `frontend/src/services/userDataApi.ts`（新） | HTTP 客户端（信封解包 + 错误文案） |
| `frontend/src/db/{positions,strategyMemory,strategyScripts}.ts` | **导出签名不变**，内部转发 HTTP → 调用点零改动 |
| `frontend/src/stores/watchlistStore.ts` | 17 处 Dexie 调用改为 API |
| `frontend/src/db/migrateToServer.ts`（新） | 一次性导入（localStorage flag + 服务端幂等 + 成功才清本地） |

**验证证据（真跑）**
- `service`：lint/typecheck 绿、**129 tests**（+13）；`frontend`：lint/vue-tsc 绿、**259 tests**、build 绿。
- **真实迁移**（用户浏览器，2 策略 + 1 回测方案）：`schema_version=2`、五张表就位；
  `/api/strategies` 返回 2 条、`/api/backtest-scripts` 返回 1 条；
  页面 `localStorage` flag = set、Dexie `strategies/strategyScripts/positions/watchlist*` 全部 **0**；
  重新打开标签页后 `/strategy` 通过 HTTP 渲染 2 条（`2 个启用 · 2 个总计`）。
- **写入链路**：点击页面开关 → `/api/strategies` 里 `id=1` 的 `active` 真的变成 0 → 再改回 1；
  pi 的 dev 桥（`window.__gofund.listStrategies/updateStrategy/setStrategyActive`）同样走 HTTP 正常读写。

**发现并处理的两个问题**
1. **迁移漏带 `lastRunAt`/`lastSummary`**：第一次实现只搬了 `name/code/source`，页面「上次运行」变成「尚未运行」。
   已修（create 接受这两个字段 + 迁移映射补上），但**该用户这次已落的方案丢了这个显示字段**（重新跑一次方案即可恢复）。
2. **service 不可用时首屏为空（无 UI 提示）**：`StrategyView.refresh()` / `watchlistStore.fetch()` 抛错后只走 `console`，
   页面显示空列表；碰到 `tsx watch` 重载也会出现（刷新即恢复）。已记下；后续可在列表层加一次轻量重试或一个错误条。

### P3 —— 计算抽包 `packages/core`

拆成三步：**3.1 建包并接入** → **3.2 service 计算路由** → **3.3 筛选搬 SQLite + 富化下沉**（均已完结）。

> **进度**：P0–P5、3.4 ①②③、**P6** 全部完结（整个迁移完成）
> （docs 站里的筛选/回测流程、死依赖 `openai`、Dexie 遗留表与 `useDexieCache`/`migrateToServer`）。

#### 3.1 `@gofund/core` 建成，前端与 service 同源（2026-10-07 完成）

**落地**：`packages/core/`（`package.json` + `README.md` + `src/index.ts` + 15 个 `.ts`）。
从 `frontend` 移入：回测族 11 个文件（engine/portfolio/portfolioSample/pyCompat/strategyRules/strategyCompare/
strategySandbox/strategyTemplates/timelineSample/toolArgs/backtestTypes）、`industryClassifier.ts`、`researchComputation.ts`、
以及从 `utils/number.ts` 拆出的计算一半 → `src/number.ts`。
**留在前端**（胶水）：`dataBroker`/`runBacktestForFund`/`runPortfolioBacktest`/`runStrategyCode`/`scriptRun`/`strategyWorker`。

**接入方式（都读源码，不构建 dist）**：
- 前端：`vite.config.ts` alias（带斜杠的先匹配）+ `tsconfig.json` paths + **`vitest.config.js` 里单独一份 alias**（它不读 vite.config）。
- service：`tsconfig.json` paths；运行时靠 `tsx` 解析。
- 依赖 `decimal.js` 由 core 与 service 各自声明（core 内部也 `bun install` 了一份）。

**验证**：service `bun run typecheck` / lint 绿、**144 tests**（+15，含新的黄金 fixtures 对照）；
frontend lint / vue-tsc / **259 tests** / build 全绿；service 侧 `tsx` 冒烟：engine + 组合引擎 + 风险指标 + 行业分类均返回正常。

**踩到的四个坑（都写进记忆了）**：
1. **`rootDir: "src"` 与跨目录源码冲突**（TS6059）：service 改成不设 `rootDir`，产物变为 `dist/service/src/**`，
   `start` 脚本同步改为 `node dist/service/src/index.js`。
2. **NodeNext 要求 core 内相对 import 带 `.js` 后缀**（前端 bundler 风格那么写不报错，NodeNext 报 TS2835）；
   Vite/vitest 能解析 `.js` → `.ts`，因此 core 统一加后缀。
3. **`decimal.js` 的 `.d.ts` 只有具名导出**（`export declare class Decimal`），运行时 `.mjs` 两者都有：
   NodeNext 下 default import 报「not constructable」→ 改用 `import { Decimal } from 'decimal.js'`。
4. **vitest 有自己独立的 alias 配置**（`frontend/vitest.config.js`），只改 `vite.config.ts` 不够。

#### 3.2 service 计算路由（2026-10-07 完成）

**落地**：`service/src/services/backtestService.ts` + `routes/backtest.routes.ts`（挂 `/api/backtest`）：

| 端点 | 对应旧聊天工具 | 说明 |
|---|---|---|
| `POST /api/backtest/fixed-investment` | `run_backtest` | 单基金定投/价值平均/均线偏离（`specFromToolArgs`） |
| `POST /api/backtest/portfolio` | `run_portfolio_backtest` | 多资产（含现金腿）+ 再平衡（`portfolioSpecFromToolArgs`） |
| `POST /api/backtest/compare-strategies` | `compare_backtest_strategies` / `suggest_strategy` | 多策略对比 + 推荐（`compareStrategies`） |

参数沿用**聊天时代的 snake_case**（core `toolArgs.ts` 映射），输出经 `sampleBacktest`/`samplePortfolioBacktest` 抽样，
与旧工具口径一致；语义：**结构错误 → 400**，**取数/数据不足 → 200 + `data.error`**。

**两个关键决定**：
1. **service 用相对路径引 core**（`../../../packages/core/src/...js`），不用 tsconfig paths 别名 ——
   别名只对 tsx/`tsc --noEmit` 生效，`tsc` **产物会保留别名 specifier**，`node dist/...` 会解析失败。
   相对路径下开发（tsx）与构建（`node dist/service/src/index.js`）都能跑，已实测。
   因此也从 service 依赖里去掉了 `@gofund/core`/`decimal.js`（core 自带 `packages/core/node_modules/decimal.js`）。
2. 净值取数复用 `getFundNavHistory`（provider 链 + 24h 缓存），不新增数据链路。

**验证（真跑）**：service lint / typecheck 绿、**154 tests**（+10，含 `__tests__/routes/backtest.test.ts`）；
`tsc` 构建产物启动正常（`dist/service/src/**` + `dist/packages/core/src/**`）；
对真实服务（8310）调三个端点：
- 单基金 110022（2023-01-01~2026-01-01，月投 1000）：36 次投入、收益率 -5.19%、回撤 -11.37%，16 个抽样点；
- 组合（110022 60% + 161725 20% + 现金 20%，季再平衡）：TWR -1.25%、7 次再平衡、资产表含 `cash:2`；
- 策略对比：推荐 weekly，各策略收益率（weekly -4.69 / value_averaging -3.12 / ma_deviation -4.92 / monthly -5.19 / lump_sum -13.9）。

#### 3.3 筛选搬 service（SQLite + 富化下沉，2026-10-07 完成）

**新增**：
- `packages/core/src/screeningEnrich.ts` —— 4433 排名算法（原前端 `useScreeningDb.ts` 的逐行移植：按 `fund_type` 分组算百分位 + `check4433Rule`），前端与 service 共用。
- `service/src/db/migrations/003_screening_cache.ts` —— `screening_funds`（29 列 + `risk_attempted`）+ `screening_meta`。
- `service/src/services/screeningService.ts` —— 快照入库（保留已有富化列 / 删除快照中消失的基金 / 空快照不覆盖）、`recomputeRanks`、**分批** `enrichScreening`、`queryScreening`、`getScreeningStatus`、`getIndustryTagCounts`、`getScreenRows`。
- 路由：`/api/screening/{sync,compute,ranks,query,status,industry-tags,screen-rows}`（同时删掉 4 个无人调用的捧路由与 8 个死客户端方法）。

**前端**：`useScreeningDb.ts` 从 400 行 Dexie+计算 → 130 行薄 HTTP 客户端（**签名不变**，`useFundScreening.ts` 视图层只改了两处直接读表的地方）；Dexie `screeningFunds` 表删除（`version(8)`）；`useFundScreening` 的行业标签面板改走 `/industry-tags`、`dataBroker.screenRows()` 改走 `/screen-rows`（新增 `services/screeningRows.ts`，内存缓存 10min）、`useResearchDashboard` 改走 `/query`。

**设计决定**：
1. 富化**分批**（默认 300/批，`/sync` 顺手跑首批，前端循环调 `/compute` 直到 `remaining === 0`）—— 避免单个“3 分钟不返回”的 HTTP 请求，且能报进度。
2. `risk_attempted` 列：取不到净值的基金不再重试，前端循环因此**必然收敛**（`{retry:true}` 可重置）。
3. `/query` 的过滤逐条对齐旧实现（含 `max_drawdown_{3m,6m,3y,all}_max` 都读 `max_drawdown_1y` 这类旧口径）、null 恒排最后。

**实验 3（富化限流/耗时，真实 3331 只）**：快照 ~15s；排名 3331 行 ~瞬时；300 只富化 14.7s（concurrency 10）≈ 取数 ~49ms/只；
全量首次富化 ~3 分钟（2704 只拿到指标，627 只历史太短/取数失败）。限流无冲突（前端富化只占 1 请求/批）。
元数据持久化后，**第二次访问只需补新增基金**（浏览器/服务重启不再重算）。

**验证（真跑）**：service lint/typecheck 绿 + **162 tests**（+8，`services/screeningService.test.ts`）；frontend lint/vue-tsc 绿 + **264 tests**（+5）+ build 绿；
bow 真浏览器（8517 + 8310）：筛选页 3331 只/2704 完整，关键词“易方达” → **162**（与 API 完全一致，首行同为 002910 +142.68%）；
投研看板 3331 只 / 2704 覆盖 / 4433 185 只（与 `/status` 一致）；代码回测 `screen-top5` → `sdk.screen()` 选出 sharpe 前 3（002377/485119/012413，与 `/query` 排序一致）、收益率 +3.76%；
Dexie 已升到 v8、`screeningFunds` 表确认消失（`indexedDB` 实测）。

**顺手清理**：`industryClassifier.ts` 290→74 行（删 4 个零引用导出：`batchClassifyIndustry`/`buildIndustryPerformanceFromScreening`/`filterFundsByIndustry`/`compute4433Ranking`，P3.1 从旧前端搬过来的死代码）。

#### 3.4 执行记录（① ② ③ 全部完成）

**① 净值缓存搬 SQLite（2026-10-07 完成）**
- `db/migrations/004_nav_cache.ts`：`nav_history(fund_code, date, nav, acc_nav)` + `nav_history_meta(code, name, first/last_date, fetched_through, fetched_at)`。
- `services/navCacheService.ts`：读写 + 覆盖度判断（`isCovered` 与前端原 `dataBroker.isFresh` 同语义）+ `navCacheStats()`（进了 `/api/health` 的 `nav_cache`）。
- `fundService.getFundNavHistory` **换成 SQLite 缓存**：命中直接按窗口切片，未命中才向 provider 全量拉一次并落库。
  换掉的是原来「把 `[start,end]` 写进 key 的内存缓存」——provider 本来就只返回全量，换个窗口就得重拉，且重启即失效。
- 前端：`dataBroker.loadNav` 只剩「向 service 要 + 限并发/预算 + 裁剪」；删 `db/navCache.ts`、Dexie `navHistory` 表（`version(9)`）；`dataBroker.test.ts` 重写。
- **验证**：真实服务上 `/api/funds/110022/nav-history` 第一次 `provider: stock-sdk`（3897 点，540ms）→ 第二次 `provider: sqlite-nav-cache`（71ms）；
  窄窗口（2026-01-01~06-30，117 点）**60ms 从缓存切片**（迁移前会重新全量拉）；SQLite 落库确认（`nav_history_meta` 6 只 / 15062 点）；
  bow 真浏览器重跑代码回测 `screen-top5` → 数字与迁移前**完全一致**（+3.76% / 22500→23345.54 / TWR +3.14% / 回撤 -0.97% / 15 次买入）。

**② `/api/research/dashboard`（2026-10-07 完成）**
- `services/researchService.ts` + `routes/research.routes.ts`（挂 `/api/research`）；`getResearchDashboard({limit, etfLimit})` → core `buildDashboard`。
- pi 侧新增工具 `get_research_dashboard`（工具数 23 → 24），默认走 `compactDashboard()`（去掉逐条基金列表）→ 21.7KB，不触发 30k 截断。
- **顺手修掉三处死代码**：`buildDashboard` 的 `sectors` 参数从未被使用（`buildResearchSectorSummary` 零调用）→ 删参数+函数+`SectorLike`；
  `market_stats.items`（**1.59MB** 的全量基金行）只有前端拿来做 4433 重算 → 改为 core 在 `summary`/`type_stats` 里算好
  （`pass_4433`/`pass_4433_rate`/`risk_ready`/`risk_ready_rate`），前端删掉 `compute4433FromItems` 与那份重复的 `check4433Rule`。
  看板 payload **1.65MB → 57KB**（同一次请求），页面数字逐项不变。
- **验证**：service **178 tests**（+5：research 路由 3 + navCacheService 5 已在①算过）；frontend lint/vue-tsc/254 tests/build 绿；
  bow 真浏览器 `/research` 重载后 3331 / 2704(+81.18%) / 4433 185(+5.55%) 与分类型表**与迁移前逐行一致**；
  `get_research_dashboard` 工具返回 21.7KB 未截断。

**③ 策略沙箱搬 `node:worker_threads`（2026-10-07 完成）**

*实验 4（隔离等价性，先量后写）*：在 worker 里复现前端那套全局遮蔽后 →

| 探测 | 结果 |
|---|---|
| `typeof fetch` / `process` / `require`（用户代码作用域内） | `undefined`（遮蔽生效） |
| 经典逃逸 `this.constructor.constructor('return process')()` | `undefined`（`globalThis` 也被遮蔽） |
| **动态 `import('node:fs')` / `import('node:net')`** | **可达（OPEN）** ← 关不掉 |
| 无限循环 | 宿主 `worker.terminate()` 在 ~5s 精确掐断，服务继续健康 |

结论：**不是硬沙箱**（浏览器里 `new Function` 含动态 import 是语法错误，Node 不是）。
按计划「不达标就评估」评估过 `vm`/`isolated-vm`：`vm` 挡不住 `import()` 且宿主函数泄漏会给出逃逸面，
`isolated-vm` 要引入原生依赖 —— 收益不值这个复杂度。于是**接受 best-effort + 把信任边界放到确认令牌**，
并在 `strategyWorker.ts` 顶部把结论写清楚（避免后人误以为是硬沙箱）。

*落地*
- `service/src/sandbox/strategyWorker.ts`：worker 入口（与浏览器同款 `BLOCKED_GLOBALS`），调 core 的 `handlePlanRequest` / `handleRunPortfolioStrategyRequest`。
- `service/src/sandbox/runStrategyCode.ts`：宿主三段式（worker `plan` → `fetchNavPoints` 取净值（SQLite 缓存）按窗口裁剪 → worker `portfolio`），
  5s 超时 `terminate()`、限并发 6、单轮上限 60 只；`runStrategyCodeSampled()` 给模型、`runStrategyCodeRaw()` 给完整结果。
- **worker 文件后缀按当前模块推断**（dev `import.meta.url` 以 `.ts` 结尾 / dist 以 `.js` 结尾）—— 写死任一个都会在另一种形态下找不到文件。
  vitest 下额外给 worker 加 `execArgv: ['--import', 'tsx']`（vitest 有自己的转换管线，worker 里没有）。
- 工具 23 → **27**：`list_strategy_scripts`（只读）、`run_strategy_code`（**执行类，需确认令牌**）、`save_strategy_script`（写，需确认令牌）。

*验证*
- service **185 tests**（+7：sandbox 3 + agent 工具 4）：Worker 真跑（`sdk.screen()` 过滤 + `onDay` 逐日买入 → 引擎结果）、
  死循环 700ms 超时被 terminate、代码错误变成消息而不是异常、按名跑方案并记录 `lastRunAt/lastSummary`、重名拒绝。
- **与浏览器逐值一致**：`run_strategy_code(script_name='screen-top5')` → 投入 22500 / 期末 23345.54 / +3.76% / TWR 3.14% / 回撤 -0.97% / 15 次买入，
  5 只标的与各腿收益也与页面相同；耗时 0.35s（净值全部命中 SQLite 缓存）。
- **DoS 真跑**：`prepare` 与 `onDay` 里的 `while(true)` 都在 5.0–5.1s 被终止，服务保持健康。
- **两种形态都验过**：`tsx`（dev）与 `node dist/service/src/index.js`（构建产物）各跑通一次代码回测（含 `CASH:0.02` 现金腿）。
- **真实 pi 会话**：`pi -p -t list_strategy_scripts,run_strategy_code` → 自行走完确认流程并报告 +3.76% / −0.97% / 15 次买入。

---

### P4 —— 服务端工具面（2026-10-07 完成）

**目标达成**：工具契约只有一份（service），pi 扩展不再抄任何数据映射。

**落地**
- `service/src/agent/types.ts` —— 工具类型 + `z.toJSONSchema()` 派生清单 + `unwrapServiceResult`
  （路由用 `sendSuccess` 会拆掉 ServiceResult，工具结果必须跟着拆，否则形状与以前不一致）。
- `service/src/agent/toolsMarket.ts` / `toolsFund.ts` / `toolsCompute.ts` —— **23 个工具**：
  市场 8 + 基金/快讯 7 + 回测 3 + 筛选 2 + 用户数据 3（`list_strategies` / `save_strategy` / `get_positions`）。
  参数用 **Zod**（service 已有依赖，零新依赖），handler 直接调 service 内部函数。
- `service/src/agent/confirm.ts` —— 写操作确认令牌：一次性、10 分钟过期、绑定（工具名 + 参数指纹）。
- `service/src/routes/agent.routes.ts` —— `GET /api/agent/tools`、`POST /api/agent/call`
  （校验 → 执行 → 结果超 30k 字符转「预览 + 提示缩小范围」）。
- `.pi/extensions/gofund/` —— 改成**通用桥**：async factory 拉清单逐个 `registerTool`；
  服务离线用 `tools.manifest.ts`（`bun run gen:tools` 从注册表生成）；都没有 → 只注册 `gofund_call`。
  删掉 `tools/{market,fund,news}.ts`（约 400 行映射）。
- `fundService.composeFundDetailLegacy()` —— 把 `/api/fund/:code` 的行内拼装抽出来，路由与工具共用。

**顺手收尾**：`gofund-app` 扩展从 3 个工具缩到 1 个 —— 策略读写改走 service HTTP，
这里只剩 `gofund_strategy_open`（驱动 bow 把页面切到前台）。**所以 P5 缩到最小**：
`devBridge.ts` 的读写函数已无调用方，只等决定 `open` 这一个工具的去留。

**验证（真跑）**
- service lint/typecheck 绿、**170 tests**（+8：`routes/agent.test.ts` —— 清单形状 / 未知工具 /
  参数校验 / ServiceResult 解包 / 取数失败内联错误 / 确认门一次性 + 「参数被改过」拒绝 / 按 id 更新）。
- 真实 service（8310）：`/api/agent/tools` 23 个、destructive 只有 `save_strategy`；逐个 curl 调用 →
  北向 2079.42 亿、`screen_funds` 4433 = 185（与 SQLite 一致）、`list_strategies` 返回用户真实 2 条。
- **确认门真实跑通**：第一次调用 → `CONFIRM_REQUIRED` + 32 位令牌；带令牌同参数 → 写入 id 3；
  令牌复用 → 400 拒绝；随后 `DELETE /api/strategies/3` 清理，用户原有 2 条策略未受影响。
- **真实 pi 会话**（`pi -p --no-builtin-tools -t <tool>`）：`get_north_flow` → 1012.58 / 1066.84 / 2079.42 亿；
  `screen_funds`（嵌套 filters）→ 002910 +142.68% 等前三名；`get_market_indices` → 上证 3842.19（+0.31%）；
  **降级链路**：`GOFUND_API_BASE=http://127.0.0.1:1` → 工具仍在（静态清单），报错是
  「service 没起来…」而不是「没有这个工具」。

---

### P5 —— 删桥（2026-10-07 完成）

**决定**：`gofund_strategy_open`（唯一还需要浏览器的工具）**也删掉**。
理由：它存在的意义只是「把 /strategy 页面切到前台」，而 pi 会话里本来就有 bow 的 `browser_*` MCP 工具 ——
`browser_list_tabs` + `browser_switch_tab`（或 `browser_new_tab`）一行就能做到，
不值得为它保留一个只暴露 `openRoute` 的前端桥。所以「要开页面」从「扩展的职责」降级为「skill 里的一段说明」。

**删除**
| 文件 | 说明 |
|---|---|
| `.pi/extensions/gofund-app/`（整个目录，4 文件 ~500 行） | 应用控制扩展：`tools/strategy.ts`（3 工具 → P4 已缩到 1）、`browser.ts`（bow MCP 寻址/求值封装）、`index.ts`、`README.md` |
| `frontend/src/services/devBridge.ts` | `window.__gofund` DEV-only 桥（`installDevBridge` + 资源 CRUD + `openRoute`） |
| `frontend/src/__tests__/services/devBridge.test.ts` | 5 个用例 |
| `frontend/src/main.ts` 的安装分支 | `import.meta.env.DEV` 那段 |
| `frontend/vitest.config.js` / 其他 | 无需改（没有别名指向 devBridge） |

**保留**（不是桥的一部分）：`gofund:strategies-changed` 事件 —— 它让「UI 表单写入后列表自动刷新」，
`strategyMemory.ts` 自己派发、`StrategyView` 监听，与 pi 无关（只更新了注释）。

**文档**：`.pi/skills/gofund-strategy/SKILL.md` 改成「`list_strategies` / `save_strategy` 两个工具 +
要开页面就调 bow 的 `browser_*`」；降级段给 REST curl 片段（并强调直接打 REST 会绕过确认令牌，更要先问用户）。
`AGENTS.md` 删掉两行 hot spot（`gofund-app` / `devBridge.ts`），并把「service 是薄后端」「全部业务逻辑在前端」
这类已经过期的描述改掉，data flow 增加 `pi tools:` 一行。

**验证**
- frontend lint / `vue-tsc` 绿、**259 tests**（21 文件，-5 例：devBridge）、`bun run build` 绿；
  `grep -rl __gofund frontend/dist` → **0 个文件**（桥连产物都不再存在）。
- 真浏览器（bow）：`/strategy` 页面照常渲染「2 个启用 · 2 个总计」，`typeof window.__gofund === 'undefined'`。
- 真实 pi 会话：`pi -p --no-session --no-builtin-tools -t list_strategies` → 正确读出用户 2 条策略
  （纯 HTTP，无浏览器参与）；`.pi/extensions/` 下只剩 `gofund` 一个扩展，加载无报错。

---

### P6 —— 文档与仓库收口（2026-10-08 完成）

**文档**
- 新增两篇权威文档：
  - `docs/architecture/node-core.md` —— 分层/存储（SQLite 四张迁移表）/共享内核/数据流/沙箱/关键决策与踩坑/「已被撤销的决策」对照表/迁移记录。
  - `docs/architecture/pi-tools.md` —— 工具面（27 个、分组）、确认令牌协议、pi 通用桥与三级降级、代码回测契约、给用户看页面改用 bow。
- **删除** 4 篇整篇作废的 AI 文档（`ai-overview` / `ai-chat` / `ai-fund-analysis` / `ai-memory`）+ 侧边栏条目（先做了只读审计，逐文件列「现在写的 → 应改成」）。
- **重写**：`architecture/{index,data-flow,backtest-engine}`、`data-sources-and-runtime`（改为「运行时与配置」）、
  `fund-screening/{index,data-flow,enrichment}`、`strategy/{index,memory-injection}`。
- **修订**：`fund-screening/{filter-system,4433-rule}`（4433 从此只有一份实现）、
  `architecture/{module-data-sources,fund-data-merge,data-sources}`、`market-watchlist`、`market-sector-rank`、
  `ui/extraction-plan`（`packages/@gofund/ui` → `packages/ui`）、`docs/index.md`（首页 feature）。
- **README** 大修：架构说明/功能特性（AI 段改成「AI 由终端 pi 承担」）/技术栈三节/配置说明/目录树。
- 决策：**不**把 `.pi/plans/pi-gofund-*.md` 搬进 docs（它们是带进度日志的计划，`node-core.md` §9 指回去即可）；
  `gofund-strategy` 技能**保留**（策略改走 HTTP 后仍需工作流说明，只是内容改成两个 service 工具 + 确认令牌）。

**仓库收口**
- 删死代码：`useDexieCache.ts`（零引用）、`strategyMemory` 的注入格式化函数（`getActiveStrategies` / `buildStrategyContext` / `truncate`，
  前端 AI 删除后无调用方）+ 其测试、`StrategyView.vue` 的无用 import（`buildActiveStrategyContext`）。
- Dexie `version(10)`：掉 8 张死表（`portfolio` / `tradeRecords` / `alertRules` / `chat*` / `fundCache` / `marketCache` / `analysisMemory`），
  只留一次性导入需要的 5 张 —— 前端 IndexedDB 至此只剩「搬家」用途。
- service 依赖删掉无人引用的 `openai`（服务端不用任何 LLM SDK）。

**过程中的两次自我纠错**（值得记）：
1. 我按「只在 `*.vue` 里 grep」判定 `useFundRealtimeGroups` / `useFundRealtimeTrade` / `portfolioApi` 是死代码并删除 ——
   实际它们是 `useFundRealtime.ts` / `useFundDetail.ts`（`.ts` 文件）的依赖，属于**活代码**。已回滚，
   并顺势把「分组/交易记录走桩路由、改动不会保存」写成已知缺口（AGENTS + route 注释）。
2. 把 `alertRouter` 的桩留下（前端确实在调），只删掉 `portfolioRouter`。

**验证**：service 185 tests / frontend 247 tests（-7：删掉的注入函数测试）+ 两端 lint/tsc/build 绿；
`docs` 构建绿（VitePress）；真浏览器 `/strategy`（2 条策略）与 `/screening`（3331 只 / 2704 完整）正常。
