# Node 核心架构（现状）

> 2026-10 的「Node 核心化」迁移后的**权威架构说明**。旧文档里「业务逻辑全在前端」「AI 分析在页面里」
> 的说法均已作废（见文末「已被撤销的决策」）。
>
> 一句话：**service 是数据、计算、用户数据的唯一真源；`packages/core` 是两端共用的计算内核；AI 由终端 pi 承担。**

## 1. 三个进程 / 三层

```
┌─ frontend :8517 (Vue 3 + Vite) ─────────────────────────────┐
│  只做展示与工作台：筛选面板 / 投研看板 / 回测工作台 / 策略页   │
│  计算来自 @gofund/core；数据走 HTTP（/api 由 Vite 代理）      │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTP（浏览器 fetch / Electron 壳）
┌─ service :8310 (Node + Express + TypeScript) ───────────────┐
│  数据获取：ProviderChain（行情 stock-sdk→eastmoney；基金 joinquant→  │
│            tencent→stock-sdk→eastmoney；失败落 Python/akshare）    │
│  存储：SQLite（用户数据 / 筛选库 / 净值缓存 / 设置）           │
│  计算：调用 packages/core（回测 / 筛选富化 / 投研聚合）        │
│  工具面：/api/agent/*（27 个工具，供 pi 与脚本调用）           │
│  沙箱：node:worker_threads 跑策略代码（5s 超时 terminate）     │
│  **不做任何 LLM 调用，不持有任何密钥**                        │
└───────────────┬─────────────────────────────────────────────┘
                │ 同一份 TypeScript 源码（不构建 dist）
┌─ packages/core（纯 TS，仅依赖 decimal.js）───────────────────┐
│  回测引擎 / 组合引擎 / 策略沙箱 / CPython 兼容 / 风险指标       │
│  行业分类 / 4433 排名 / 投研聚合                              │
└──────────────────────────────────────────────────────────────┘
        ▲
        │ HTTP（/api/agent/tools + /api/agent/call）
   终端 pi（唯一 AI）：.pi/extensions/gofund 通用桥 + .pi/skills
```

- **Python** 只做数据补全（akshare/eastmoney），无 HTTP 服务：`stdin JSON → 脚本 → stdout JSON`，由 service 用 `child_process.spawn()` 调。
- **Electron 桌面壳**（外部项目，可选）只是一个解禁 CORS 的浏览器窗口，前端代码与 Web 完全一致。

## 2. 存储：service SQLite

`node:sqlite`（Node ≥22.13 起免 flag，零依赖）+ 手写迁移器（`service/src/db/migrations/`，`schema_version` 记录版本，启动时幂等执行）。

> 运行时下限以各 `package.json` 的 `engines`（`>=22.19.0`，由 `undici@8` 决定）为准；
> `node:sqlite` 本身只要求 ≥22.13（22.5~22.12 需 `--experimental-sqlite`）。
> `service/src/index.ts` 启动时会探测一次 `node:sqlite`，不可用就打印人话并退出，而不是抛栈。

| 迁移 | 表 | 用途 |
|---|---|---|
| `001_init` | `settings` | 仅 proxy URL（`clearProxy` 才清除） |
| `002_user_data` | `positions` / `strategies` / `strategy_scripts` / `watchlist` / `watchlist_groups` | 用户数据 |
| `003_screening_cache` | `screening_funds` / `screening_meta` | 基金筛选库（含富化结果） |
| `004_nav_cache` | `nav_history` / `nav_history_meta` | 净值序列 + 覆盖度 |
| `005_alerts` | `alerts` | 告警规则（前端 `AlertSettings`/`AlertBadge`） |
| `006_portfolio` | `portfolio_funds` / `portfolio_groups` / `portfolio_fund_groups` / `portfolio_holdings` / `portfolio_trades` | 实时页的组合基金/分组/映射/交易；持仓由已结算交易推导 |

> 表清单以 `service/src/db/migrations/` 为准（只追加、不改已发布迁移）。

约定：

- 所有用户数据、设置、缓存都在这里；**前端已无 Dexie/IndexedDB**（旧数据留在浏览器里但不再读）。
- 路径可用 `GOFUND_DB_PATH` 覆盖（测试用 `:memory:`），默认 `service/data/gofund.db`（`data/` 已 gitignore）。
- 净值缓存按**实体**存整条序列，查询区间只做读取过滤 —— 把区间写进缓存 key 会让「换个窗口」变成一次全量重拉。
- 净值缓存有**容量策略**（`navCacheService`）：写入时裁掉 10 年以前（`NAV_RETENTION_DAYS`）的点位，
  全库超过 300 万行（`NAV_MAX_POINTS`）时按 `fetched_at` 升序**整只淘汰**基金（LRU）。
  两个阀值可用 `GOFUND_NAV_RETENTION_DAYS` / `GOFUND_NAV_MAX_POINTS` 覆盖；
  `/api/health` 的 `nav_cache` 会报 `trimmed` / `evicted` 累计数。

## 3. 共享计算内核 `packages/core`

前端与 service **都直连源码**（前端走 vite alias，service 走相对路径），不构建 dist，所以不存在「两套实现」。

- `backtest/`：`backtestEngine`（单基金）、`portfolioBacktest`（多资产 + 再平衡 + 注水 + 现金腿）、
  `strategySandbox`（用户代码的 plan/run 两段协议）、`strategyCompare`、`timelineSample` / `portfolioSample`（给模型的抽样）、
  `pyCompat`（CPython round / ISO 周）、`toolArgs`（工具参数 → 回测参数）。
- `number.ts`：风险指标（`computeRiskMetricsLocal`）等纯计算。
- `industryClassifier.ts` / `screeningEnrich.ts`：行业分类、4433 排名（**唯一实现**）。
- `researchComputation.ts`：`buildDashboard()` 投研看板聚合。

黄金 fixtures 在 `frontend/src/services/backtest/__fixtures__/`，**两端各跑一遍**逐值校验
（`service/src/__tests__/services/core-golden.test.ts`）。

> 注意：service 引 core 必须写**相对路径**（`../../../packages/core/src/...js`）。
> tsconfig `paths` 别名只对 tsx 与类型检查生效，`tsc` 产物会原样保留别名 specifier，`node dist/...` 会解析失败。

## 4. AI：终端 pi（service 不做 LLM）

- service **没有任何 LLM 客户端、不持有密钥**；唯一「AI 相关」能力是无需 key 的搜索 `POST /api/search`（Exa → DuckDuckGo）。
- pi 的工具清单由 service 给出：`GET /api/agent/tools`（33 个），调用 `POST /api/agent/call`。
  详见 [pi 工具面](/architecture/pi-tools)。
- 页面上已没有聊天/AI 入口（原来的 `chatEngine`、两位分析师、分析场景框架等约 40 个文件已删除）。

## 5. 数据流

| 场景 | 链路 |
|---|---|
| 实时行情/板块/资金流 | ProviderChain → service → 前端（内存缓存，TTL 见 `/api/health`） |
| 筛选刷新 | 前端 `/api/screening/sync` → service 拉快照写 `screening_funds` + 算行业标签 + 算 4433 排名（**默认不富化，立即返回**）→ 前端/pi 循环 `/compute` 分批补指标 |
| 筛选查询 | 前端/pi → `POST /api/screening/query`（过滤/排序/分页都在 service，语义见 [筛选](/fund-screening/)) |
| 投研看板 | `/api/research/dashboard`（core `buildDashboard` 读 SQLite 筛选行） |
| 用户数据 | 前端/pi → `/api/{watchlist,positions,strategies,backtest-scripts}` → SQLite |
| 实时页组合/告警 | 前端 → `/api/user/portfolio/*`、`/api/alerts` → SQLite（迁移 005/006）；持仓由已结算交易推导 |
| 单基金/组合回测 | 两条路同一份 core 引擎：页面在浏览器算（净值取自 `/api/funds/:code/nav-history`）；service 侧 `/api/backtest/*` |
| 自由代码回测 | service `node:worker_threads` 沙箱（pi 工具 `run_strategy_code`）／浏览器 Worker（`/backtest` 页面） |
| 净值 | service `nav_history`：命中就按窗口切片，未命中才向 provider 全量拉一次并落库 |

## 6. 策略代码沙箱

`service/src/sandbox/`：worker 里跑用户/AI 写的代码（`prepare(sdk)` 声明标的池、`onDay(s)` 逐日决策）。

- 宿主三段式：worker `plan` → 取净值（SQLite 缓存）→ worker `portfolio`；**5s 超时后 `worker.terminate()`**（死循环杀得掉）。
- 隔离强度是 **best-effort**：worker 里抹掉 `fetch`/存储类等宿主全局，但 `new Function` 中**关不掉动态 `import()`**
  （浏览器里那是语法错误，Node 不是）。所以 `run_strategy_code` 属**执行类**工具，需要用户确认令牌。
- worker 文件后缀按当前模块推断（开发 `.ts` / 构建 `.js`），写死任一个都会在另一种形态下找不到文件。

## 7. 关键决策与踩坑

- **service 绑 `127.0.0.1`**（`HOST` 可覆盖），单机单用户、无鉴权。
- **前端 dev 服务故意监听所有网卡**（`bun run dev --host`，2026-10-08 用户确认要保留局域网访问）：
  于是局域网里任何设备都能经 Vite 的 `/api` 代理读写用户数据、跑策略代码沙箱。
  这是**有意接受的风险**（本机个人工具，不引入鉴权）；要收紧就删掉 `--host`，让前端也只绑 loopback。
- **计算归 core，缓存归 SQLite，前端只展示** —— 迁移前「业务逻辑全在前端」的决策已撤销。
- 筛选富化**分批**（默认 300/只基金一批）：全量一次性要 3 分钟（3331 只 × ~49ms），分批才不超时、能报进度。
- `screening_funds.risk_attempted`：取不到净值的基金不再重试，前端循环因此必然收敛。
- **写入/执行类工具用确认令牌**：第一次调用只回 `CONFIRM_REQUIRED` + 令牌，参数指纹一致才真正执行。
- pi 扩展里**别用 `import.meta.url` / fs 读文件**（jiti 加载）；静态清单用生成 `.ts` + 普通相对 import。

## 8. 已被撤销的决策

| 曾经 | 现在 |
|---|---|
| 业务逻辑全部前端化 | 计算在 `packages/core`，service 承载数据/用户数据/工具面 |
| 用户数据存浏览器 IndexedDB | service SQLite；前端走 HTTP |
| 前端直连 LLM、密钥存前端/服务端 | service 不做 LLM；AI 由终端 pi 承担，密钥只在 pi 侧 |
| 前端 `chatEngine` 工具循环 | `service/src/agent/` 工具注册表 + pi 通用桥 |
| 筛选富化/4433 在前端算 | service 算好落库（算法在 core） |
| `window.__gofund` 浏览器桥 | 已删除，pi 全走 HTTP |

参数与工具的实时清单以代码为准：`service/src/agent/`、`GET /api/agent/tools`。

## 9. 迁移记录

这次重构的分阶段计划、每阶段的验收证据与踩坑都记在 `.pi/plans/node-core-architecture.md`
（`packages/core` 抽取 → service 计算路由 → 筛选/净值缓存搬 SQLite → 工具面 → 删桥 → 代码沙箱）。
