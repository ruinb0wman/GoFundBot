# 评估：浏览器为中心 vs Node 为中心 —— 面向 pi 集成的架构路线对比

> 状态：决策文档（未实现）。用户已定前提：若搬 Node，则**前端不存用户数据**、**持久化用 SQLite**。
> 依据：本仓库 `service/src/**`、`frontend/src/{db,services,views,composables}/**`、`docs/architecture/*.md`、
> `.pi/extensions/**`、bow `src/main/mcp.ts`。每条结论都标了出处；标注「估」的是我的相对判断。
> 落点建议：定稿后移到 `docs/architecture/pi-integration-roadmap.md`。

---

## 0. 结论（TL;DR）

1. **对 pi 而言，Node 为中心确实方便得多**：通道 B（bow 桥）整条可以删掉，pi 只剩 HTTP 一种传输，
   headless / CI / 其它 MCP 客户端都能用。
2. **但这不是「逻辑太浏览器」，而是「数据宿主是浏览器」**：真正只能在浏览器跑的代码只有
   Dexie 用户数据、Web Worker 沙箱、localStorage 密钥三样；约 3.7k 行纯 TS 计算可以直接搬。
3. **推荐分阶段 B → C**：先只把**用户数据**搬 Node（收益最大频率、风险可控），
   再把纯计算按模块搬（有黄金 fixtures 兜底）。一次性做 C 的风险主要在前端行为回归与进程资源争用。
4. **A（维持现状 + bow 桥框架）不是错，但它是给既有架构打补丁**：pi 的脆弱点（依赖浏览器、profile 绑定、
   DEV-only、无 headless）一个都不会消失，只是被抽象得好看一点。
5. 顺带发现一个**安全前置**：`service/src/index.ts` 的 `server.listen(port)` 没指定 host（绑 0.0.0.0）。
   一旦 service 承载用户数据与写路由，局域网内任何人都能读写——上 B/C 前必须先做 bind 127.0.0.1 或加 token。

---

## 1. 问题陈述

### 1.1 pi 现在怎么接的

| 通道 | 实现 | 数据 | 写 |
|---|---|---|---|
| A 数据 | `.pi/extensions/gofund/` → HTTP `:8310` | 行情/基金/资讯 | 无 |
| B 应用 | `.pi/extensions/gofund-app/` → bow MCP → `window.__gofund` → Dexie | 策略记忆等 | 有（确认门禁） |

（详见 `pi-gofund-architecture.md`。）

### 1.2 浏览器为中心是怎么来的（有文档的决策）

- `docs/architecture/backtest-engine.md:23-33`「为什么迁移」：① 回测是纯算术，Python 子进程只带来延迟与故障面；
  ② AI 工具输出预算靠抽样解决；③ 与 AGENTS.md「业务计算已迁移前端」保持一致。
- `frontend/src/__tests__/utils/goldenRiskMetrics.test.ts:4` 注释直接写「Golden reference: Node backend
  `computeRiskMetrics` (pre-frontend-migration)」——风险指标也是从 Node 搬到前端的。
- `docs/architecture/data-flow.md:75-81`：「用户数据（纯前端 CRUD，**不经过服务端**）」。

**结论**：这是三次有意识的迁移（Python/Node → 前端）。当时唯一的消费者是浏览器 UI，所以「数据在浏览器」
是合理的；现在多了个 headless agent，性质变了。

### 1.3 这套设计对 pi 的具体代价

| 代价 | 出处/现象 |
|---|---|
| 依赖浏览器与 MCP，脆弱 | bow 工具名需后缀解析 + 命名空间代理兜底（`.pi/extensions/gofund-app/browser.ts:66-96`） |
| 4 个 bow 坑（顶层 await / `waitUntil:'load'` / 信封形状 / 代理） | `pi-strategy-control.md §9` 偏差记录 |
| DEV-only | `frontend/src/main.ts:26-28` + `grep __gofund dist` 自检 |
| 数据绑 profile | bow 建窗无 `partition`（`bow/src/main/index.ts`） |
| 前置条件多 | 必须开着 `:8517` 标签页；`pi -t` 白名单会挡掉 MCP 工具 |
| 无 headless | CI / 定时任务 / 远程 pi 都做不了 |
| 写权限靠软约束 | `gofund_strategy_save` 的 `promptGuidelines`（无服务端校验） |

---

## 2. 事实盘点（决定「能不能搬」）

### 2.1 服务端现状：无状态、无 DB

| 事实 | 出处 |
|---|---|
| 依赖里**没有任何数据库** | `service/package.json`（仅 cors/dotenv/express/rate-limit/helmet/openai/pino/stock-sdk/undici/zod） |
| 设置只有内存里的 proxy URL | `service/src/services/settingsService.ts`（`let _cache`，注释「LLM/Search key 已迁移至前端」） |
| 用户数据路由**全是桩** | `service/src/routes/userData.routes.ts`（watchlist/portfolio 一律 `sendSuccess(res, [])`） |
| 监听未指定 host | `service/src/index.ts`（`server.listen(port)`）→ 绑 0.0.0.0 |
| Python 只做数据补全 | `python/cli/*`，经 `pythonRunner` spawn |

**含义**：HTTP 骨架（`userData.routes.ts`）当初就留了，只是没接数据层。B 是「把桩填上」，不是从零造。

### 2.2 前端数据：15 张表

`frontend/src/db/index.ts` 声明 15 张表；其中**用户数据 11 张**、**缓存 4 张**：

| 类别 | 表 | 备注 |
|---|---|---|
| 用户数据 | `watchlist`, `watchlistGroups`, `portfolio`, `tradeRecords`, `positions`, `alertRules`, `chatSessions`, `chatMessages`, `analysisMemory`, `strategies`, `strategyScripts` | pi 真正想碰的是 `strategies`/`positions`/`watchlist`/`strategyScripts` |
| 缓存 | `fundCache`, `marketCache`, `screeningFunds`, `navHistory` | `screeningFunds` 是「计算输入」，`navHistory` 是回测净值缓存 |

DB 相关代码：6 个文件、约 20.8k 字符（`index.ts` 6161 / `positions.ts` 2897 / `strategyMemory.ts` 4279 /
`strategyScripts.ts` 2625 / `navCache.ts` 1930 / `analysisMemory.ts` 2936）。
**14 处** `from '../db'` 的 import（13 个源文件 + 1 测试），即迁移时要改的 CRUD 调用面。

### 2.3 前端计算：可移植性分级

| 级别 | 模块 | 行数 | 依据 |
|---|---|---|---|
| **纯 TS，可原样跑 Node** | `backtest/`（引擎/组合/规则/对比/抽样/pyCompat） | ~2 700（估） | grep 无浏览器 API |
| | `industryClassifier.ts` | 290 | 同上 |
| | `researchComputation.ts` | 462 | 同上 |
| | `utils/number.ts`（`computeRiskMetricsLocal`） | 242 | 有对齐旧 Node 的黄金测试 |
| **需替换宿主 API** | `backtest/strategySandbox.ts` + `strategyWorker.ts` | 387 + 58 | `new Worker` + `BLOCKED_GLOBALS`（`strategyWorker.ts:29-45`） |
| | `backtest/dataBroker.ts` | 116 | Dexie `navHistory` + 限并发 |
| | `services/llm.ts` / `searchService.ts` | 12.3k+9.2k 字符 | 用 `nativeFetch`（Node 也能 fetch）+ 密钥来自 localStorage |
| **真浏览器专属** | `db/*`（Dexie）、`composables/useLLMConfig.ts:21,31` 与 `useAppSettings.ts:23,34`（localStorage 密钥） | — | — |

**含义**：搬 C 的主要工作量在「数据宿主 + 沙箱宿主」，而不是重写算法。

### 2.4 pi 侧现状

- 15 个数据工具（HTTP）、3 个应用工具（bow）；共享运行时/RPC 框架仍是**计划**（`pi-gofund-framework.md`）。
- 有验证基线：frontend 399 tests / service 101 tests / `grep __gofund dist` 空。

---

## 3. 方案定义

前提（用户已定）：若搬 Node，**前端不存用户数据**（服务端唯一真源）、**SQLite** 持久化。

### 3.1 A：维持现状 + bow 桥框架
只做 `.pi/lib/gofund` 共享运行时 + 前端桥 v2 资源注册表 + 泛化工具 + 能力面扩张。数据与计算不动。

### 3.2 B：用户数据搬 Node（逻辑不动）
- service 加 SQLite + 用户数据服务与路由（把 `userData.routes.ts` 的桩填实，新增 strategies/scripts 路由）。
- 前端用户数据 CRUD 全部改走 HTTP；Dexie 只留缓存表。
- pi：用户数据走 HTTP（新增数据工具），**写路径不再需要浏览器**；回测/筛选计算仍走桥（只读）。

### 3.3 C：数据 + 逻辑全搬 Node
- 在 B 之上抽 `packages/core`（纯 TS：回测族、风险指标、行业分类、投研聚合、策略对比/抽样）。
- service 引用 core 并暴露计算路由；`navHistory`/`screeningFunds` 的缓存与富化也移到 service。
- Worker 沙箱 → `node:worker_threads`；前端「执行 AI 代码」的确认门禁在 service/pi 侧重实现。
- pi：**全 HTTP**；bow 桥（`gofund-app`）删除。

### 3.4 被否掉的选项：浏览器为真源 + service 镜像
前端把 Dexie 变更 POST 给 service，pi 读镜像；pi 写回则需回推浏览器（SSE/轮询）。**双源 + 最终一致**，
在单机单用户的场景里成本高于收益，不采用（列出仅为完整）。

---

## 4. 逐方案分析

### 4.1 A：维持现状 + bow 桥框架

**改动**（见 `pi-gofund-framework.md`）：新增 `.pi/lib/gofund/`（~6 文件）、前端桥 v2、4 个泛化工具、
能力面扩张、文档/技能。

| 维度 | 评估 |
|---|---|
| pi 便利性 | 中：工具更统一，能读写更多前端数据；但 headless/profile/DEV-only/依赖浏览器**全部保留** |
| 成本 | S：纯 `.pi/` + 一个前端桥文件 |
| 回归风险 | 低 |
| 长期可维护性 | 中：多一层 bow 抽象，但双传输长期存在 |
| 安全面 | 不变（桥仅 DEV） |
| 与既有决策一致 | 完全一致 |

### 4.2 B：用户数据搬 Node

**目标架构**

```
pi ──HTTP──▶ service :8310 ──▶ SQLite(user data) + ProviderChain(行情) + python
前端 ──HTTP──▶ service :8310（用户数据 CRUD）
     └─ Dexie 仅保留缓存：fundCache / marketCache / screeningFunds / navHistory
pi ──bow───▶ 前端（仅剩：回测/筛选等计算读取）
```

**改动清单**

| 层 | 文件/模块 | 动作 |
|---|---|---|
| service | `src/db/`（新增） | SQLite 打开/迁移/事务（better-sqlite3 或 `node:sqlite`，见 §7 实验） |
| service | `src/services/userDataService.ts`（新增） | strategies / positions / watchlist(+groups) / scripts 的 CRUD |
| service | `src/routes/userData.routes.ts` | 填实桩；补 Zod 写入 schema |
| service | `src/routes/`（新增 `strategies.routes.ts` 等） | 暴露 `GET/POST/PUT/DELETE /api/strategies`、`/api/backtest-scripts` |
| service | `src/index.ts` | `listen(port, '127.0.0.1')`（安全前置） |
| frontend | `db/index.ts` | 用户数据表停用（保留 schema 以便一次性迁移与回滚） |
| frontend | 14 处 `from '../db'` 调用点 | 改走 `api.ts`（`useWatchlist`/`useMyPositions`/`StrategyView`/`BacktestView`…） |
| frontend | 一次性迁移 | 读 Dexie → `POST /api/user/import` → 标记已迁移（幂等） |
| pi | `.pi/extensions/gofund/tools/user.ts`（新增） | HTTP 读写用户数据的工具（写入带确认 guideline） |
| pi | `gofund-app` | 缩到只剩「计算读取」（回测/筛选） |

**数据迁移**：Dexie v1–v7 → SQLite 表。建议 service 侧 `schema_version` + 顺序迁移；
前端导入走一次性引导（首启检测 Dexie 有数据 → 上传 → 本地清空）。保留导出（JSON）作回滚。

**风险**
- 前端 14 处 CRUD 改写是本方案最大回归面（尤其 watchlist/positions 的乐观 UI）。
- 服务端从「无状态」变成「有状态」：备份、并发写、schema 演进要开始负责。
- 回测/筛选仍要浏览器 → **B 不能删 `gofund-app`**，pi 的「依赖浏览器」只解决一半（但覆盖了写能力与常用数据）。

### 4.3 C：数据 + 逻辑全搬 Node

**目标架构**

```
pi ──HTTP──▶ service :8310 ──▶ SQLite + packages/core(回测/指标/分类/聚合) + ProviderChain + python
前端 ──HTTP──▶ service（数据 + 计算），不再有 Worker 沙箱与用户态 Dexie
```

**改动清单（在 B 之上）**

| 模块 | 动作 | 风险 |
|---|---|---|
| `packages/core`（新增） | 从 `frontend/src/services/backtest/*`、`industryClassifier.ts`、`researchComputation.ts`、`utils/number.ts` 抽出纯函数；按 `packages/ui` 的方式给 frontend/service 各配别名 | 抽包时的 import 路径/类型边界（估 M） |
| service `routes/compute` | `/api/backtest/*`、`/api/screening/compute`、`/api/research/*` | 路由与 Zod 契约（估 M） |
| `strategyWorker.ts` | 换成 `node:worker_threads`；`BLOCKED_GLOBALS` 换成 Node 上下文隔离（vm/受限 worker） | **沙箱语义变化**，AI 代码执行的确认门禁要重新设计（估 M–L） |
| `dataBroker`/`navHistory` | 净值缓存与限并发移到 service（SQLite 表） | 与页面并发取数的资源争用 |
| `screeningFunds` 富化 | 富化（风险指标 + 行业标签 + 4433）从 `useScreeningDb` 移到 service | 3000+ 基金 × NAV 拉取的耗时与限流（估 M） |
| frontend | 各 view 改调 service；删除 Worker/沙箱/`useScreeningDb` 本地富化 | UI 加载延迟 + 无本地缓存（用户已选「前端不存用户数据」） |
| pi | 删 `gofund-app` 与 `window.__gofund`；统一走 HTTP 工具 | 需要把原「桥」能力补齐为 HTTP 工具 |

**一致性保障（这是 C 最有利的一点）**：引擎已有黄金 fixtures
（`frontend/src/services/backtest/__fixtures__/{engine,pyround,isoweek}.json`，来自 Python 实现），
`utils/number.ts` 也有对齐旧 Node 的黄金测试 → 搬迁可用同一批 fixture 做逐值回归。

**风险**
- 反向迁移的**决策成本**（要改 AGENTS.md 与 `docs/architecture/backtest-engine.md` 的既定叙述）。
- 前端在线性：用户已选「前端不存用户数据」，则每次页面加载都要等 service（本机，通常可接受）。
- 服务端承载计算后，CPU/IO 与页面请求互相影响；需要限并发/队列。
- LLM/Search 密钥：若 pi 要在 Node 跑分析，密钥需回到 service（又一次反向迁移）——**若不做 Node 侧 LLM 分析，可不动**。

---

## 5. 横向对比

评分 1–5（5 最好；「成本」列 5 = 最省）。

| 维度 | A 现状+框架 | B 数据搬 Node | C 全搬 Node |
|---|---|---|---|
| pi 便利性（headless/一致性/写能力） | 2 | 4 | **5** |
| 实现成本 | **5** | 3 | 1 |
| 回归风险（越低越好） | **5** | 3 | 1 |
| 长期可维护性（单一真源、可测） | 3 | 4 | **5** |
| 部署/安全面（越小越好） | **4**（桥仅 DEV） | 3（需 bind/鉴权） | 2（有状态 + 计算暴露） |
| 与既有文档决策一致 | **5** | 3 | 1 |
| pi 能否彻底摆脱浏览器 | 否 | 否（计算仍要） | **是** |

**分项结论**
- 只关心「pi 少踩 bow 坑、能读写用户数据」→ **B**。
- 关心「pi 成为一等公民 / headless / 以后服务端定时任务」→ **C**，但要接受反向迁移。
- 「不想大动、但工具要更顺手」→ **A**（且 B/C 都可先不做）。

---

## 6. 建议

**分阶段 B → C**，每阶段独立可用、可回滚：

| 阶段 | 内容 | 完成标志 |
|---|---|---|
| P0 安全前置 | `listen` 绑 127.0.0.1（或加 token）；确认 SQLite 选型（§7） | 局域网不可直连；service 起停正常 |
| P1 = B | SQLite + 用户数据路由 + 前端改 HTTP + 一次性迁移 + pi 的 HTTP 用户数据工具 | pi 不启浏览器即可读写策略/持仓/自选/方案；前端功能与数字无回归 |
| P2 | 抽 `packages/core`，service 暴露回测/筛选计算；前端切过去 | 同一批 golden fixtures 在 service 侧逐值通过 |
| P3 = C | Worker→`worker_threads` 沙箱 + 门禁重设计；删 `window.__gofund` 与 `gofund-app` | pi 纯 HTTP；`grep __gofund` 全仓库为空 |

**A 与 P1 不冲突**：`.pi/lib/gofund` 的共享运行时 + 统一注册在任何阶段都有用，可以并行做（它只碰 `.pi/`）。

---

## 7. 需要实验验证的未知（动手前先做）

1. **SQLite 选型**：service 跑在 `tsx`（Node 22.19）上——`node:sqlite` 在 22 需要 `--experimental-sqlite`；
   `better-sqlite3` 是原生依赖，需确认 bun install + Node 运行时 的编译可用性。二选一前各跑一个 5 行脚本。
2. **回测在 Node 的耗时**：3 年日频 733 点在浏览器是微秒级，Node 只快不慢；但**取数**（`nav-history` 24h 缓存）
   才是大头 → 测 service 侧复用同一缓存后的端到端时间。
3. **筛选富化在 Node 的可行性与限流**：3000+ 基金 × NAV 拉取，现由浏览器限并发执行；
   Node 化后与页面请求共用 service 限流（300/15min，`app.ts`）→ 需要队列或提额，先测。
4. **Worker 沙箱等价性**：`node:worker_threads` 能否复现 `BLOCKED_GLOBALS` 的隔离强度；
   不能的话要不要上 `vm` / `isolated-vm`（引入原生依赖）。
5. **前端 14 处 CRUD 的真实回归面**：先列出清单，重点是 watchlist/positions 的乐观更新与排序字段。

---

## 8. 附录：代码事实索引

| 事实 | 文件 |
|---|---|
| 回测迁移理由 | `docs/architecture/backtest-engine.md:23-33` |
| 风险指标「pre-frontend-migration」 | `frontend/src/__tests__/utils/goldenRiskMetrics.test.ts:2-4` |
| 用户数据不经服务端 | `docs/architecture/data-flow.md:75-81` |
| 15 张 Dexie 表 | `frontend/src/db/index.ts` |
| 用户数据路由是桩 | `service/src/routes/userData.routes.ts:15-40` |
| service 无 DB、无 host 绑定 | `service/package.json`、`service/src/index.ts` |
| 设置仅内存 proxy | `service/src/services/settingsService.ts` |
| localStorage 密钥 | `frontend/src/composables/useLLMConfig.ts:21,31`、`useAppSettings.ts:23,34` |
| Worker 沙箱 | `frontend/src/services/backtest/strategyWorker.ts:29-45`、`runStrategyCode.ts:45` |
| 黄金 fixtures | `frontend/src/services/backtest/__fixtures__/{engine,pyround,isoweek}.json` |
| pi 两通道与坑 | `.pi/plans/pi-gofund-architecture.md` |
| 框架计划（A） | `.pi/plans/pi-gofund-framework.md` |
