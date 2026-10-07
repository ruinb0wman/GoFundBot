# GoFundBot × pi 交互架构说明

> 依据：本仓库 `.pi/extensions/**`、`frontend/src/services/devBridge.ts`、`frontend/src/main.ts`、
> `service/src/app.ts`、bow `src/main/mcp.ts`，以及 pi 的 `docs/extensions.md` / `docs/configuration.md`。
> 文中每条「事实」都对应真实代码；标注为「计划」的属于 `.pi/plans/pi-gofund-framework.md`，尚未实现。
> 落点建议：定稿后移到 `docs/architecture/pi-integration.md`（plan 模式下暂存于此）。

> ⚠️ **2026-10-07 更新（P4）**：工具契约已搬到 service（`GET /api/agent/tools`，23 个工具），
> pi 扩展变成通用桥，本文的「15 个只读工具 / 扩展里定义工具」已过时。现行说明见
> `.pi/extensions/gofund/README.md` 与 `.pi/plans/node-core-architecture.md` §9 的 P4 记录。

## 1. 一句话总览

pi 通过**两个互不依赖的 pi 扩展**触达 GoFundBot：`gofund` 用 HTTP 直连 Node service 取**行情/基金/资讯**（只读）；
`gofund-app` 用 **bow 浏览器 MCP** 驱动运行中的前端，经 **DEV-only 桥 `window.__gofund`** 读写**浏览器 IndexedDB** 里的用户数据（策略记忆等）。
两者共享同一个仓库、同一批 pi 工具契约风格，但**传输通道完全不同**——这是当前架构最重要的一条分界线。

```
                    ┌──────────────────────────── 终端 pi（仓库内运行） ────────────────────────────┐
                    │                                                                              │
                    │  .pi/extensions/gofund/        15 个只读工具                                 │
                    │  .pi/extensions/gofund-app/    3 个应用工具（写策略 / 开页面）               │
                    │  .pi/skills/gofund-data, gofund-strategy   引导「何时用哪个」                │
                    └───────┬──────────────────────────────────────────────┬───────────────────────┘
                            │ A. HTTP fetch                                │ B. ctx.executeTool(browser_*)
                            ▼                                              ▼
                 ┌────────────────────┐                        ┌──────────────────────────┐
                 │ service :8310      │                        │ bow 浏览器 MCP            │
                 │ Express 薄后端      │                        │  browser_eval / _list_tabs│
                 │ ProviderChain + py │                        │  / _new_tab / _switch_tab │
                 └─────────┬──────────┘                        └───────────┬──────────────┘
                           │ 行情/基金/资讯/日志                            │ 在页面主世界执行 JS
                           ▼                                                ▼
                 ┌────────────────────┐                        ┌──────────────────────────┐
                 │ eastmoney/腾讯/     │                        │ frontend dev :8517 (bow)  │
                 │ akshare/Yahoo ...   │                        │  window.__gofund (DEV)    │
                 └────────────────────┘                        │    └→ Dexie IndexedDB     │
                                                               └──────────────────────────┘
```

要点：

- pi **不经过**前端自己的 `httpClient.ts` / Vite `/api` 代理；数据通道是 pi 直接 `fetch('http://localhost:8310/...')`。
- 前端业务逻辑（筛选丰富化、回测引擎、分析、策略注入）**全在浏览器**，Node 只是数据层；因此「碰前端数据」= 必须驱动浏览器。
- 桥是 `import.meta.env.DEV` 门禁，`bun run build` 里被完全 tree-shake（已验证 `grep __gofund frontend/dist` 为空）。

---

## 2. 进程与数据拓扑

| 组件 | 位置 / 端口 | 由谁启动 | pi 如何看它 |
|---|---|---|---|
| 终端 pi | 仓库根目录（bow 的终端或系统终端） | 用户 | 宿主进程，扩展在本进程内运行 |
| service | `service/`，`:8310` | 用户 `cd service && bun run dev` | 通道 A 的 HTTP 对端 |
| frontend dev | `frontend/`，`:8517` | 用户 `cd frontend && bun run dev` | 通道 B 的目标标签页 |
| bow 浏览器 | 本机 Electron 壳 | 用户 | 通道 B 的 MCP 服务器 |
| 浏览器 IndexedDB | bow 的默认 profile（`GoFundBot` 库） | 前端运行时 | 通道 B 的最终数据落点 |
| docs 站 | `docs/`，`:8574`（经前端 `/docs/*` 代理） | 用户（可选） | 与 pi 集成无关 |

**关键事实**：bow 建窗没有 `partition`（`bow/src/main/index.ts`），所以**所有 bow 窗口共享同一份 IndexedDB**——
pi 在 agent 窗口写的策略，用户在 user 窗口的页面上能立刻看到。这也是「pi 改的是你这个 bow profile 的数据」这条边界的来源。

---

## 3. 通道 A：pi ↔ service（数据，只读，HTTP）

### 3.1 结构

```
pi tool execute() → .pi/extensions/gofund/client.ts apiGet(path, params)
                  → fetch(`${GOFUND_API_BASE ?? 'http://localhost:8310'}${path}`)
                  → unwrap({success,data}) → jsonResult(data, endpoint)  // 30KB 上限
```

- `SERVICE_BASE` 取自 `GOFUND_API_BASE`（默认 `http://localhost:8310`）。
- 15 秒 `AbortSignal.timeout`；连接失败翻译成「请先在 service/ 下 `bun run dev`」而不是裸堆栈。
- 非 2xx / 非 JSON 都变成可读错误。
- 结果统一 `jsonResult`：超 30000 字符截断并告诉模型「缩小范围重试」。

### 3.2 工具清单（15 个）

| 族 | 工具 | 端点 |
|---|---|---|
| 基金 | `search_funds` | `GET /api/fund/search?q=` |
| | `get_fund_detail` | `GET /api/fund/:code`（**体积裁剪**，见下） |
| | `get_fund_estimate` | `GET /api/funds/:code/estimate` |
| | `get_fund_nav_history` | `GET /api/funds/:code/nav-history`（`startDate`/`endDate`） |
| | `get_fund_holdings` | `GET /api/funds/:code/holdings` |
| | `get_fund_managers` | `GET /api/funds/:code/managers` |
| 市场 | `get_market_indices` | `GET /api/market/indices` |
| | `get_index_kline` | `GET /api/market/kline/:symbol` |
| | `get_hot_sectors` | `GET /api/market/sectors?limit=` |
| | `get_concept_sectors` | `GET /api/market/concept-sectors?limit=` |
| | `get_north_flow` | `GET /api/market/north-flow` |
| | `get_market_breadth` | `GET /api/market/breadth` |
| | `get_main_flow` | `GET /api/market/money-flow` |
| | `get_gold_realtime` | `GET /api/market/gold/realtime` |
| 资讯 | `get_flash_news` | `GET /api/news/flash?count=&page=1` |

### 3.3 三个「有代价」的设计

1. **`get_fund_detail` 序列化压缩**：legacy 响应约 1.05 MB，99% 是时间序列。六个序列字段被压成
   `{count, first, last}` + `_series_note`，降到约 7 KB；要看完整净值必须改用 `get_fund_nav_history`。
2. **四个口径映射工具**（`north_flow` / `breadth` / `concept_sectors` / `main_flow`）：把响应改写成 snake_case
   并附 `data_status`/`note`，防止模型误读——
   北向 `*_net_inflow` **恒为 null（不是 0）**，只有 `*_deal_amount_yi = 百万元 ÷ 100`；
   涨跌停家数可为 null；概念板块 `event_date` 不是行情日期；主力资金 `date` 为空即 unavailable。
   这段映射是**刻意**与前端 `chatEngine/toolHandlers.ts` 重复的，AGENTS.md 已记账。
3. **`^DJI` 会被拒**：海外指数用裸代码（`DJI`/`SPX`/`HSI`/…），service 自动路由到 Yahoo 链路（较慢，需代理）。

---

## 4. 通道 B：pi ↔ 前端应用（bow 桥，可读可写）

### 4.1 结构

```
pi tool execute(params, ctx)
  └─ ctx.executeTool('<browser_* 工具名>', args)          // 嵌套调用，走同一套校验/权限管线
       └─ bow MCP
            ├─ browser_list_tabs   → 找 url 以 APP_BASE(:8517) 开头的标签
            ├─ browser_new_tab     → 没有就开一个（waitUntil:'none' + 轮询）
            ├─ browser_eval        → 在标签页主世界执行 JS
            └─ browser_switch_tab  → 把页面亮给用户
                 └─ window.__gofund.*                      // frontend/src/services/devBridge.ts（仅 DEV）
                      └─ db/strategyMemory.ts (Dexie strategies)
                           └─ dispatchEvent('gofund:strategies-changed')
                                └─ StrategyView 监听 → refresh()   // 页面无需刷新即更新
```

### 4.2 为什么必须绕浏览器

策略记忆存在**浏览器 IndexedDB**（Dexie `GoFundBot.strategies`），终端进程无法用 HTTP 读到它。
所以 pi 不去读数据，而是**驱动页面调用它自己的函数**——写入因此走的是和 UI 表单完全相同的代码路径
（校验、`updatedAt`、`source`、变更事件）。

### 4.3 桥的契约（v1，现存）

`frontend/src/services/devBridge.ts` 暴露：

```
version / ping()
listStrategies() / getActiveStrategies() / buildActiveStrategyContext()
addStrategy(input) / updateStrategy(id, patch) / removeStrategy(id) / setStrategyActive(id, active)
openRoute(path)        // → vue-router push（hash 路由，故 URL 是 http://localhost:8517/#/strategy）
```

安装点在 `frontend/src/main.ts`：`if (import.meta.env.DEV) installDevBridge(router)`。

### 4.4 工具清单（3 个）

| 工具 | 行为 | 写 |
|---|---|---|
| `gofund_strategy_list` | 读全部策略 + 启用策略注入上下文 | 否 |
| `gofund_strategy_save` | 带 `id` 更新 / 不带 `id` 新建（`source:'ai-draft'`），随后打开页面 | **是** |
| `gofund_strategy_open` | 打开/切换 `/strategy` | 否 |

`gofund_strategy_save` 带 `promptGuidelines`：**未得到用户明确确认不得调用**；技能 `gofund-strategy` 把这条写成硬约束。

### 4.5 工具名与信封：两个必须记住的兼容点

- **工具名按后缀解析，绝不硬编码**：MCP 适配器可能注册成 `browser_eval`、`bow_browser_eval`，
  也可能只暴露一个**命名空间代理** `mcp__browser`（参数 `{tool, args}`，2026-10-07 实测就是这种）。
  `findBrowserTool` 先找具体名，找不到且有代理就以裸后缀返回；`callBrowserTool` 有代理时改走 `{tool,args}`。
- **返回信封形状不统一**：`browser_eval → {ok, result}`，而 `browser_list_tabs → {ok, tabs}`、
  `browser_new_tab → {ok, tabId}`（载荷摊平在顶层）。只取 `result` 会拿到 null。
- **`browser_eval` 按脚本求值**：顶层 `await` 直接报 `Script failed to execute`，必须 `(async () => …)()`。
- **`browser_new_tab` 不要 `waitUntil:'load'`**：Vite 冷启动常超过 15s 超时，标签其实已建好；
  用 `waitUntil:'none'` 再轮询 `waitForAppTab` / `waitForBridge`（各 45s 预算）。
- bow 的 `browser_eval` 无超时、无体积上限（`bow/src/main/mcp.ts:283`），所以工具侧自带 20KB `jsonResult`。

---

## 5. 两条通道的对比

| 维度 | 通道 A（`gofund`） | 通道 B（`gofund-app`） |
|---|---|---|
| 传输 | `fetch` → `:8310` | bow MCP → `browser_eval` |
| 数据落点 | service 进程 / 上游数据源 | 浏览器 IndexedDB |
| 能力 | 行情/基金/资讯（只读） | 用户数据读写 + 页面导航 |
| 写权限 | 无 | 有（确认门禁） |
| 失效原因 | service 未启动 | bow 未连 / 前端未开 / 桥未加载 |
| 需要浏览器 | 否 | 是（且必须开着 8517 标签） |
| 环境变量 | `GOFUND_API_BASE` | `GOFUND_APP_BASE` |
| 覆盖范围 | 前端 ~31 个工具里的**纯后端**那一半 | 目前只有策略记忆一族 |

两者刻意**不合并**：`gofund` 的 README 明确承诺 read-only，写权限需要能独立授信/停用。

---

## 6. 握手与前置条件

```
终端 A: cd service   && bun run dev        # :8310
终端 B: cd frontend  && bun run dev        # :8517（桥只在 vite dev 下存在）
bow 必须运行，且 bow://settings → 插件管理 里「MCP HTTP 服务」已启用
终端 C: cd <repo> && pi --approve          # 项目信任 + 加载 .pi/extensions/
```

- **项目信任**：`.pi/extensions/` 属受保护的项目资源；GoFundBot 不在 `~/.pi/agent/trust.json` 里，
  交互模式会问一次，非交互（print/RPC）必须 `--approve`，否则**静默不加载**。
- **`pi --tools/-t` 白名单会连 MCP 工具一起挡掉**：白名单存在时 `ctx.tools` 里没有 `browser_*`，
  表现为「bow 不可用」——错误文案已写明这条。
- **首次扩展加载时不会拉起任何进程**：pi 只是把工具注册进本会话；数据对端由用户自己启动。

---

## 7. 失败模式（都必须是可读、可行动，不静默）

| 场景 | pi 侧表现 |
|---|---|
| service 未启动 | `GoFundBot service 请求失败（http://localhost:8310）… 请确认 service 已启动` |
| 命中 service 限流（300/15min） | 如实返回 HTTP 429 文本，不重试风暴 |
| bow 未运行 / MCP 插件关闭 / `-t` 白名单挡掉 | `当前会话里没有 bow 浏览器的工具（browser_*）…`（含排查三条） |
| bow 在跑但没有 8517 标签 | 工具**自动新开**一个标签页再继续 |
| 前端不是 dev（桥不存在）或页面是旧版本 | `前端 dev 桥未加载（window.__gofund 不存在）… 刷新该标签页` |
| 数据源不可用（板块/北向/K 线等已知故障） | 工具透传 `data_status: unavailable` + `note`，技能要求**不许编造数值** |

---

## 8. 边界与已知限制

- **profile 绑定**：只有 bow（= 用户跑 pi 的同一个浏览器）里的数据可见；Electron 壳或别的浏览器是另一份 IndexedDB。
- **能力边界**：pi 现在只能读后端数据 + 读写**策略记忆**。回测、4433、行业分类、持仓/自选、已保存回测方案、
  联网搜索仍是浏览器专属，没有工具（技能里明确「不要假装能调用」）。
- **无删除工具**：策略删除是刻意不做的破坏性操作，用户在页面上删。
- **不做 MCP server**：service 没有对外 MCP 端点，pi 之外（Claude Code 等）无法复用；这是当前的有意取舍。
- **`.pi/` 不在仓库 lint/typecheck 范围**：扩展只能靠真跑 pi 验证。

---

## 9. 文件索引

| 路径 | 角色 |
|---|---|
| `.pi/extensions/gofund/{index,client}.ts` + `tools/{fund,market,news}.ts` | 通道 A：HTTP 客户端 + 15 个工具 |
| `.pi/extensions/gofund-app/{index,browser}.ts` + `tools/strategy.ts` | 通道 B：bow 桥接层 + 3 个工具 |
| `.pi/skills/gofund-data/SKILL.md` | 数据工具的使用套路与口径铁律 |
| `.pi/skills/gofund-strategy/SKILL.md` | 策略读写工作流 + 写前确认硬约束 + 降级直调片段 |
| `frontend/src/services/devBridge.ts` | 页面侧 `window.__gofund`（v1，仅 DEV） |
| `frontend/src/main.ts` | DEV 门禁安装桥 |
| `frontend/src/db/strategyMemory.ts` | 策略 CRUD + `buildStrategyContext` + 变更事件 |
| `.pi/plans/pi-data-extension.md` / `pi-strategy-control.md` | 两条通道的设计与验收记录（含 §9 实施记录） |
| `.pi/plans/pi-gofund-framework.md` | **下一步**：把两通道统一为共享运行时 + 通用 RPC 注册表 |

---

## 10. 与「统一框架」计划的关系（计划，未实现）

现状的症结：① 两份 transport / 错误处理 / 裁剪各自实现；② 桥只暴露 strategy 一族，加一个能力要改两处；
③ 契约在「前端 toolDefs / 扩展工具 / skill 文档」三处近似重复。

拟定改法（详情见 `pi-gofund-framework.md`）：

- 新增 `.pi/lib/gofund/`（**不是扩展目录**，pi 只扫 `.pi/extensions/` 与 `.pi/skills/`）承载 HTTP + bow + 结果整形 + `defineGofundTool`；
- 前端桥升 v2：资源注册表 + `listResources()` / `call(resource, action, params)`，v1 方法保留；
- pi 侧 4 个泛化工具 `gofund_app_resources/_read/_write/_open`，取代 3 个 strategy 专用工具；
- 能力面扩到持仓/自选、回测方案、筛选与行业、回测运行；日志（service 侧）做成 `get_service_logs`。

上表（§9）即改造后仍成立的文件骨架，只是补上 `.pi/lib/gofund/` 与 `frontend/src/services/devBridge.ts` v2。
