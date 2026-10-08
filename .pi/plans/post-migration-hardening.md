# 迁移后加固（post-migration hardening）

> **给新会话执行者的第一段话**：本仓库刚做完一次「Node 核心化」大迁移（P0–P6 + 3.4 全部完成，
> 最新提交 `3e960f8`，已 push 到 `origin/master`）。迁移本身可用、测试全绿，本 plan 是**对已落地成果的
> 加固清单**：修掉几个真实风险、补齐能力缺口、做几个便宜的性能优化、把工程化收口。
>
> 每条都写了 `文件:行` 证据 —— **动手前自己再确认一次**（行号会随改动漂移）。
> 每条做完要有**真跑证据**（curl / bow / 测试输出）记到文末「执行记录」。

---

## 0. 环境与基线（先读这节）

**项目**：GoFundBot —— 本机跑的基金分析工具。
service（Node/Express + `node:sqlite`，端口 **8310**，绑 `127.0.0.1`）= 数据/存储/计算/工具面唯一真源；
`packages/core` = 前后端共用计算内核（直连源码，不构建 dist）；frontend（Vue3 + Vite，**8517**）只做展示与工作台；
AI = 终端 pi（`.pi/extensions/gofund` 通用桥 → `/api/agent/*`，27 个工具）。权威文档：`docs/architecture/node-core.md`。

**命令**（包管理器是 bun；`bun test` 是 Bun 自带测试器，必须写 `bun run test`）：

```bash
# service（用户常驻 `cd service && bun run dev`，改源码会自动热重载）
cd service && bun run lint && bun run typecheck && bun run test    # 185 tests / 25 文件
# frontend
cd frontend && bun run lint && bunx vue-tsc --noEmit && bun run test && bun run build   # 247 tests / 19 文件
# docs
cd docs && bun run build
# pi 静态工具清单（改了 service/src/agent/ 必须重跑）
bun run gen:tools
```

**独立验证**（不要打扰用户那个 dev 实例）：

```bash
cd service && PORT=8399 GOFUND_DB_PATH=/tmp/verify.db HOST=127.0.0.1 bunx tsx src/index.ts
GOFUND_API_BASE=http://127.0.0.1:8399 ...      # pi 工具指向它
```

**已知环境坑**（都踩过）：
- 用户的 service 跑在 8310；**别用 `pkill -f "PORT=8399"`**（会匹配到自己的 shell 命令行）→ 用 `ss -ltnp` 找 pid 再 kill。
- 改 service 源码会让**用户的进程热重载**：写过中间态坏文件会让它崩且不再自恢复（2026-10 发生过一次）→ 要么一次写完，要么用独立端口。
- 真浏览器验证用 bow（MCP `browser_*`）：`browser_list_tabs` → `browser_eval`（**不支持顶层 await，要 `(async()=>{})()`**；**不要在 eval 里 await `location.reload()`**）。
- HMR 残影：改坏过模块后再改回来，页面可能仍显示「页面渲染异常」→ **完整 reload 一次**即恢复，别当代码 bug 查。
- 前端 alias 有三处（`vite.config.ts` / `tsconfig.json` / `vitest.config.js`），加包别名要同时改。

**当前 DB 事实**（用于下面的容量判断）：`service/data/gofund.db` ≈ 2.5MB；
`screening_funds` 3297 行、`nav_history` 15062 行（仅 6 只基金被缓存过）、`strategies` 2、`positions` 0、`watchlist` 0。

---

## A. 必修（安全 / 正确性）

### A1. 前端 dev 服务监听了所有网卡 —— 配合无鉴权 service = 局域网可读写用户数据

**证据**：`ss -ltn` 显示 `*:8517`（IPv6 双栈；`10.255.255.254:8517` 本机可连）；`frontend/vite.config.ts:21`
的 `server` 里**没有 `host`**；proxy `/api → http://localhost:8310` 会把任何来源的请求转给 service。
service 无鉴权（有意设计，单机单用户），但迁移后它持有全部用户数据 + 能跑代码沙箱。

**做法**：`frontend/vite.config.ts` 的 `server` 加 `host: '127.0.0.1'`（保留 `strictPort`）。
顺带在 `docs/architecture/node-core.md` 的「关键决策」里补一句：**service 绑 loopback 的前提是前端也绑 loopback**。

**验收**：`ss -ltn | grep 8517` 只显示 `127.0.0.1:8517`；`curl http://127.0.0.1:8517/` 正常；
从本机非 loopback IP 连不上（`/dev/tcp/$IP/8517` 失败）。**并让用户在自己的网络环境确认一次跨机器可达性**（WSL 场景我无法验证）。

**风险**：用户如果**故意**用别的设备访问前端会失效 —— 需要用户确认（默认认为不需要）。

### A2. `engines` 与 `node:sqlite` 要求不一致（按声明装 Node 22 会崩）

**证据**：`service/package.json:8` 与根 `package.json` 都是 `"node": ">=22.19.0"`；README 徽章写 "Node.js 22+"；
但 `node:sqlite` 在 22.x 需要 `--experimental-sqlite`（AGENTS.md 自己记过），本机只在 **Node 26** 实测过。
`service/src/db/index.ts` 的 `new DatabaseSync(path)` 在低版本上是**同步抛错**，报错信息对用户不友好。

**做法**：
1. `engines` 提到真正可用的下限（Node 26 实测；若想兼容 22 就写清需要 flag —— 推荐直接提到免 flag 的版本）；
2. `service/src/index.ts` 启动时自检：`try { new DatabaseSync(':memory:') } catch (e) { logger.error(...明确文案...); process.exit(1) }`；
3. 同步改 README 徽章与 `docs/data-sources-and-runtime.md` 的「运行时」表。

**验收**：`bun run test` + 独立实例启动正常；人为用低版本 Node 跑（或注释掉 flag）能看到人话报错而不是栈。

### A3. Dexie 只剩死路径，`version(10)` 永远不会生效（拍板去留）

**证据**：
- `frontend/src/db/migrateToServer.ts:35` 命中 localStorage flag 直接 `skipped`（flag 已设 `1791375967866`）；
- 实测浏览器里 Dexie 仍是 **v80 / 14 张表**（`version(10)` 在 `frontend/src/db/index.ts:170` 声明的删表**从未执行**，因为没人 open Dexie）；
- 实测浏览器旧表全为 0 行（`watchlist/positions/strategies/alertRules/portfolio/tradeRecords`）→ **数据没有丢**，迁移是成功的；
- 于是现状是「留着 300 行死代码 + 一个 Dexie 依赖 + 一份不生效的 schema」，而 `db/index.ts` 同时被当作**类型来源**（`ScreeningFund`/`StrategyRecord` 等被多处 import）。

**做法（推荐方案 b）**：
- (a) 保底：`frontend/src/main.ts` 里 `void db.open().catch(...)` 一次，让 v10 落地 —— 仍然留着 Dexie 依赖；
- (b) **推荐**：删 Dexie 依赖 + 删 `db/migrateToServer.ts`（及 `main.ts` 里的调用）+ 把 `db/index.ts` 里的
  **类型定义**搬到 `frontend/src/types/legacy.ts`（或按用途就近放），然后删 `db/index.ts`、`db/` 目录（如果空了）。
  同时更新 `docs/architecture/*` 与 AGENTS 里「Dexie 只剩一次性导入」的说法。
- 若选 (b)：先确认用户**所有**浏览器都已经迁移完（本站只有本机浏览器；可让用户在常用浏览器各开一次页面，或直接问用户）。

**验收**：`bun run lint && bunx vue-tsc --noEmit && bun run test && bun run build` 全绿；
真浏览器 `/strategy`（2 条策略）、`/screening`（3331 只 / 2704 完整）正常；
`grep -rn "dexie" frontend/src` 无业务引用（选 b 时）。

**风险**：选 (b) 后如果**还有别的浏览器/设备**存着未迁移的用户数据，那部分数据只能靠 IndexedDB 手工导出 → 先问用户。

### A4. `nav_history` 无容量策略（全市场缓存可达数百 MB）

**证据**：`service/src/services/navCacheService.ts` 只写不删（`clearNavCache` 仅测试用）；
当前 DB 2.5MB / `nav_history` 15062 行 / 6 只基金 ≈ 每只全量序列 2500 点；全市场 3297 只 → **约 800 万行量级**。
`/api/health` 已暴露 `nav_cache: {funds, points}`（`service/src/services/navCacheService.ts:143`）。

**做法**（建议按顺序）：
1. `saveNav()` 时裁掉「超出保留窗口」的历史（例如只保留最近 5 年 + 全部必需区间，窗口常量放 `navCacheService` 顶部）；
2. 加全局上限：`nav_history` 行数超阈值（例如 300 万）时按 `fetched_at` 淘汰最久未用基金（LRU 式，删 `nav_history` + `nav_history_meta` 整只）；
3. `/api/health` 的 `nav_cache` 加 `maxPoints` 与 `trimmed` 计数，便于观察。

**验收**：单测扩展 `service/src/__tests__/services/navCacheService.test.ts`（裁剪 + 淘汰各 1 例）；
真跑一次代码回测/`/api/funds/:code/nav-history` 确认命中仍快（命中应 <100ms）；
`/api/health` 能看到计数变化。

---

## B. 功能缺口（对齐「pi 用纯 HTTP 触达全部能力」）

> 做这一类时的固定流程：改 `service/src/agent/toolsCompute.ts`（或新文件）→ 跑 `bun run gen:tools`
> → 用 `pi -p --no-session --no-builtin-tools -t <tool> "..."` 真跑一次 → 需要确认令牌的按 P4 的
> `confirm_required → token → 原样重调` 流程验一遍（见 `service/src/agent/confirm.ts`）。

### B1. 自选（watchlist）没有任何工具

**证据**：27 个工具清单里没有 watchlist（`get_positions` 有，但自选没有）。
service 侧 CRUD 已齐：`service/src/services/userDataService.ts`（`listWatchlist` / `upsertWatchlistItem` / `removeWatchlistItems` /
`listWatchlistGroups` / `createWatchlistGroup` / `assignWatchlistGroup` / `reorderWatchlist`），路由 `/api/watchlist`。

**做法**：加 2–3 个工具 —— `get_watchlist`（只读）、`add_to_watchlist`（写，需确认令牌；`upsertWatchlistItem`）、
可选 `remove_from_watchlist`（破坏性，需确认令牌）。写工具的 `description` 要写清「会改用户的真实自选」。

**验收**：`pi -p -t get_watchlist "列出我的自选"` 返回与页面一致（当前应为空）；
写路径用确认令牌真跑一次「加一只 → 页面看到 → 删掉」的完整往返。

### B2. pi 无法刷新筛选库（也不能重试失败项）

**证据**：pi 只有 `screen_funds` / `get_screening_status`；`/api/screening/{sync,compute,ranks}` 没有对应工具；
`enrichScreening({retry:true})`（`service/src/services/screeningService.ts:266`）只能 curl 触发。
而 `risk_attempted` 是**不可逆**的（一次取数失败即永久标记），前端也没有「重试失败项」入口。

**做法**：
1. 加工具 `refresh_screening`（`{ force?, enrich_limit?, retry? }`）：调 `syncScreening()` / `enrichScreening()` / `recomputeRanks()`，
   返回 `{ total, risk_metrics_pending, ... }`。它是「联网 + 写缓存」但**不改用户数据** → 我倾向 `readOnly: true` 但在
   description 里说明「会联网刷新，冷启动约 3 分钟」，**不要**给它确认令牌（否则每次刷新都要用户点）；
2. 前端筛选页状态条加一个「重试未算出的基金」按钮 → 调 `/api/screening/compute {retry:true}`（可选，但缺口就此闭合）。

**验收**：`pi -p -t refresh_screening "刷新一下筛选库，然后告诉我还有多少只没算指标"`；
真跑后 `/api/screening/status` 的 `risk_metrics_pending` 下降。

### B3. 桩路由在骗人：`/api/alerts` 与 `/api/user/portfolio/*`

**证据**：`service/src/routes/userData.routes.ts` 只剩 alerts 桩（读回 `[]`、写入只回 `{id: Date.now()}`），
但前端 `AlertSettings.vue` / `AlertBadge.vue`（`stores/alertStore.ts` → `alertAPI`）在调；
`/api/user/portfolio/*`（同一文件里已加的注释与 `frontend/src/services/portfolioApi.ts`）被
`composables/useFundRealtimeGroups.ts` / `useFundRealtimeTrade.ts` / `useFundDetail.ts` 用着 —— **「分组/交易记录/告警」的改动不会保存**。

**做法（二选一，建议先问用户）**：
- (a) **做进 SQLite**：新增迁移 `005_alerts`（`alerts` 表）与 `006_portfolio_groups`（`portfolio_groups` / `group_map` / `trades`），
  把桩路由换成真 CRUD（可参照 `002_user_data` + `userDataService` 的写法）；
- (b) **删掉前端入口**：删 `AlertSettings.vue` / `AlertBadge.vue` / `stores/alertStore.ts` / `alertAPI` /
  `useFundRealtimeGroups.ts` / `useFundRealtimeTrade.ts` / `portfolioApi.ts` + 服务端桩路由，
  并把「实时页的分组/交易」入口一并去掉（要用户同意，因为这是功能删减）。

**验收**：无论哪条，**页面上不再有「看起来能用其实不保存」的入口**；有 SQLite 表的话用真跑验证「改 → 重启 service → 还在」。

### B4. 删死 UI：`/api/market/daily` 不存在

**证据**：`frontend/src/services/api.ts:55` 调 `/market/daily`，service 里**没有这个路由**（grep 无匹配）；
`frontend/src/components/DailyMarketSummary.vue` 已无任何视图引用（`grep -rn DailyMarketSummary frontend/src` 只剩它自己）。

**做法**：删 `DailyMarketSummary.vue` + `fundAPI.getDailyMarket`（顺带清掉相关 i18n/样式引用）。

**验收**：`bun run lint && bunx vue-tsc --noEmit && bun run build` 绿；`grep -rn "market/daily" frontend/src` 为空。

### B5.（可选）策略/方案的删除与改名

现状：`save_strategy` 能更新但不能删；`save_strategy_script` **重名直接拒绝**（无覆盖语义）；
service 侧 `removeStrategy(id)` / `deleteStrategyScript(id)` 已存在但没有工具。

**做法**：加 `delete_strategy` / `delete_strategy_script`（**破坏性 → 必须走确认令牌**），
或给 `save_strategy_script` 加 `overwrite?: boolean`。二选一即可，别两个都加。

**验收**：真跑确认流程；删除后页面刷新确认消失（用一次性测试数据，别删用户真实数据）。

---

## C. 性能 / 体验优化（都便宜，效果可量）

### C1. `POST /api/screening/query` 每次读全表再内存过滤

**证据**：`service/src/services/screeningService.ts:102` `getAllScreeningFunds()` 读全表 3297 行，`:394` `queryScreening` 用 `.filter()`；
表上已建索引 `idx_screening_funds_type` / `idx_screening_funds_pass`（迁移 003）但没用。
实测一次 query ≈ 79ms（P3.3 记录）。

**做法（择优，别过度）**：把「高频且能走索引」的条件下推到 SQL（`fund_type` / `pass_4433`），其余条件仍在内存过滤；
或更省事：**按 `screening_meta.sync_time` + 表版本缓存整表读**（进程内缓存 3297 行，同步/排名后失效）。

**验收**：连打 20 次 `/api/screening/query`（`curl -w %{time_total}`）P95 < 20ms；结果与被替换前逐条一致（同参数对比 total 与首行）。

### C2. `/api/research/dashboard` 每次现算

**证据**：`service/src/services/researchService.ts:49` 每次都读全表 + `buildDashboard`（payload 57KB）。

**做法**：进程内缓存 60s（key 含 `limit`/`etfLimit` 与 `screening_meta.sync_time`），`/api/screening/{sync,compute,ranks}` 后失效。

**验收**：第二次请求 <10ms（日志/`curl -w`）；同步筛选后再请求能拿到新数据（缓存确实失效）。

### C3. 回测取净值没带窗口（白传几 MB JSON）

**证据**：`frontend/src/services/backtest/dataBroker.ts:69` 调 `fetchNavHistory(code)` **不带窗口**；
110022 一只 = 3897 点 ≈ 300KB；5 只组合 ≈ 1.5MB。
service 侧早已支持从 SQLite 按窗口切片（`getFundNavHistory` + `navCacheService`）。

**做法**：`loadNav(codes, range)` 里把 `range` 传给 `fetchNavHistory(code, range.start, range.end)`（`runBacktestForFund.fetchNavHistory` 已支持这两个参数）。

**验收**：`/backtest` 页面跑 `screen-top5`，数字与迁移前**完全一致**（+3.76% / 22500 → 23345.54 / TWR 3.14% / 回撤 −0.97% / 15 次买入）；
在浏览器 Network 里确认响应体积显著下降。

### C4. 冷启动 `/screening` 阻塞 3 分钟

**证据**：`GET /api/screening/sync` 会同步跑完「首批富化」（默认 300 只 ≈ 15s，冷启动总 3 分钟）才返回，
前端 `useScreeningDb.syncFromServer()` 在 `onMounted` 里 `await` 它 → 首屏空白。

**做法**：把首批富化从 `/sync` 里挪出去（`/sync` 只做快照 + 标签 + 4433 排名并立即返回），
前端拿到响应就先 `search()` 渲染列表，再循环 `/compute` 补指标（**现在的循环代码已经是这样**，只是首批被绑在 `/sync` 里）。
顺带把「列表先出、指标陆续到」在状态条上体现出来（`risk_metrics_pending` 数字递减）。

**验收**：清空 DB 后首次打开 `/screening`，**5s 内**看到基金列表（即便指标还没齐）；
`risk_metrics_pending` 最终归 0；页面最终数字与改动前一致（3331 只 / 2704 完整 / 4433 通过 185）。

### C5. pi 工具调用吃同一个限流额度

**证据**：`service/src/app.ts:38` `express-rate-limit` 300/15min，`/api/agent/call` 也在其下；
pi 一次分析可能连着调十几个工具（筛选 + 回测 + 快讯…）。

**做法**：给 `/api/agent` 挂一个更宽的限制（例如 3000/15min）或 `skip`（本地可信来源），
并在 `docs/architecture/pi-tools.md` 记一句。

**验收**：脚本连打 400 次 `/api/agent/call`（可用轻量工具如 `get_screening_status`）不出现 `RATE_LIMITED`。

---

## D. 工程化收口

### D1. 一条命令跑完所有校验 + 可选 CI

**现状**：无 CI（`.github/workflows/ci.yml` 已删），全靠人记 5 条命令。

**做法**：根 `package.json` 加 `"check": "cd service && bun run lint && bun run typecheck && bun run test && cd ../frontend && bun run lint && bunx vue-tsc --noEmit && bun run test && bun run build && cd ../docs && bun run build"`；
文档（AGENTS/README）改成「改完跑 `bun run check`」。

**验收**：`bun run check` 一条命令全绿（并记录耗时）。

### D2. `gen:tools` 会漂移（静态清单与服务端不一致）

**现状**：`.pi/extensions/gofund/tools.manifest.ts` 是生成物（27 个工具），靠人记得跑 `bun run gen:tools`；
服务离线时 pi 用它注册工具 —— 漂移了就会「工具名对不上」。

**做法（选一）**：pre-commit 钩子里跑一次并 `git diff --exit-code` 该文件；或 `/api/agent/tools` 返回 `hash`，
扩展启动时发现本地清单 hash 不同就警告（更宽松）。

**验收**：故意改一个工具描述不跑 gen:tools → 钩子/警告能拦住。

### D3. alias 三处同步（历史坑）

**现状**：`frontend/src` 里 `@gofund/core` / `@gofund/ui` 的别名分别写在 `vite.config.ts`、`tsconfig.json`、`vitest.config.js`。
`docs` 侧没有别名。加包要改三处，漏了 vitest 就会「测试里找不到模块」。

**做法**：`vitest.config.js` 改成从 `vite.config.ts` 读 `resolve.alias`（或抽一个 `aliases.mjs` 被两者 import）。

**验收**：删掉 `vite.config.ts` 里一条 alias 后，vitest 仍能解析（说明单源）；或反过来，新增一条 alias 只改一处就能通过测试。

### D4. 命名与职责

- `service/src/routes/userData.routes.ts` 现在**只剩 alerts** → 改名 `alert.routes.ts`（并改 `app.ts` 引用）。
- `frontend/src/db/index.ts` 一身两职（Dexie 残留 + 类型来源）→ 随 A3 一起处理。

**验收**：`bun run lint && bun run typecheck && bun run test` 绿；`grep -rn "userData.routes" service/src` 为空。

### D5. 文档双源收敛 + schema 清单校验

**现状**：`AGENTS.md` 与 `docs/architecture/node-core.md` 内容重叠（分层、数据流、工具数）→ 将来必漂移；
`node-core.md` 里手写的 SQLite 表清单没有校验，加迁移不会提醒。

**做法**：AGENTS 瘦身到「命令 + hot spots + 坑 + 已知缺口」，架构描述一律指向 `docs/`；
给 `node-core.md` 的 schema 段加一句「以 `service/src/db/migrations/` 为准」。

**验收**：人工过一遍，确认同一事实只在一处描述（重复的那处改成链接）。

### D6. 补测试（当前明确的空白）

- **前端薄客户端零测试**：`useScreeningDb.ts` / `useResearchDashboard.ts` / `userDataApi.ts`（P6 还删了 `strategyMemory.test.ts` 且没补）。
  → 用 mock HTTP 写「信封解包 / 错误分支 / 参数映射」几个用例即可，不用起服务。
- **`fundService.getFundNavHistory` 的缓存路径**：命中 SQLite → 切片、未命中 → 落库（只有真跑验证过；`navCacheService` 本身有单测）。
  → mock provider chain + `:memory:` DB 写 2 例。
- **`service/src/sandbox/runStrategyCode.ts` 的预算/并发失败路径**（只测了 happy path + 超时 + 代码错误）。
- 可选：给 `service/src/routes/agent.routes.ts` 补「结果 >30k 字符转预览」的用例。

**验收**：新增用例全绿；测试数只增不减（基线 service 185 / frontend 247）。

---

## E. 明确不做（避免新会话乱加）

- **不给 service 加鉴权/登录/token**：这是单机单用户工具，A1 把前端也绑回 loopback 就是本次的收口手段。
- 不做多用户、远程部署、容器编排。
- 不重写 UI，不引入新的状态/数据层（前端继续「展示 + 工作台」）。
- **不把 AI 加回前端**（这是 2026-10 的明确决策：service 不做 LLM、AI 只在终端 pi）。
- 不为了「架构更漂亮」而把 `packages/core` 拆包或产出 dist（两端直连源码是刻意的）。

---

## F. 整体验收

1. `bun run check`（或手工那 5 条）全绿：service 185+ tests、frontend 247+ tests、docs build。
2. 阶段 A 的每条都有**真跑证据**（ss 输出 / 低版本 Node 报错 / 浏览器旧表清理 / `/api/health` 计数）。
3. 阶段 B 的工具用**真实 pi 会话**跑过（`pi -p --no-session --no-builtin-tools -t <tool> "..."`），
   写/执行类走完确认令牌流程。
4. 阶段 C 的每条给出**改动前后对比数字**（ms / 字节 / 首屏时间）。
5. 每阶段结束更新：本 plan §执行记录、`AGENTS.md`、`docs/architecture/*`、以及 memory（`memory_write`）。
6. 提交：按阶段分 commit（仓库用 Conventional Commits 中文，如 `fix(frontend): …` / `feat(service): …`）。
   注意仓库有 pre-commit 钩子（私钥扫描/行尾/换行/ruff），提交时它会 stash 未暂存改动。

---

## G. 执行记录（新会话在这里追加）

<!-- 格式：
### A1 前端绑回 loopback（日期 完成）
- 改动：`frontend/vite.config.ts:21` 加 `host: '127.0.0.1'`
- 证据：`ss -ltn | grep 8517` → `127.0.0.1:8517`；`curl 127.0.0.1:8517` 200；`/dev/tcp/$IP/8517` 失败
- 备注：跨机器可达性请用户确认
-->

（尚未开始）
