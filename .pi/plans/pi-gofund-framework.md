# 计划：GoFundBot × pi 统一调用框架（共享运行时 + 通用 RPC 桥）

> 状态：待评审。用户已确认：**共享运行时 + 统一注册**、**通用 RPC + 资源注册表**、**不做 MCP server**，
> 能力面扩到 **持仓与自选 / 回测方案 / 筛选快照与行业分类 / 运行回测与日志**。

## 1. 目标

把现在「两条互不相干的 pi 扩展」变成一套框架：**一份共享运行时**（HTTP transport + bow 桥 transport +
结果整形 + 统一注册约定）+ **一个通用的前端 RPC 桥**（`window.__gofund` 资源注册表）。之后：

- pi 侧不需要为每个前端能力手写一个工具与一套桥接代码；
- 新增能力 = 在前端注册表加一个 resource/action（领域逻辑本来就在前端），pi 侧用泛化工具即可触达；
- 数据（service HTTP）与应用（浏览器 IndexedDB/Worker）两种口径在**同一套命名空间与错误/裁剪约定**下暴露。

**假设**：service(:8310) 与 frontend dev(:8517) 由用户自行启动；日常在 bow 里跑 pi；写操作仍需用户确认。
**不改**：service 业务路由、前端业务逻辑（只加桥的注册表与必要的变更事件）。

## 2. 现状（读过的代码，逐条引用）

| 事实 | 出处 | 影响 |
|---|---|---|
| 数据扩展自建 HTTP 客户端与结果裁剪 | `.pi/extensions/gofund/client.ts:11,73`（`SERVICE_BASE`、`jsonResult` 30KB） | 与应用扩展的同类实现重复 |
| 应用扩展自建 bow 桥接与结果裁剪 | `.pi/extensions/gofund-app/browser.ts:19,42`（`APP_BASE`、`jsonResult` 20KB） | 同上；两套 `jsonResult` 上限还不一致 |
| 应用桥只有 strategy 一族方法 | `frontend/src/services/devBridge.ts:52-70`（`DevBridge` 接口逐个手写 `listStrategies/addStrategy/…`） | 加一个能力要改前端桥 + 扩展工具两处 |
| 前端**已经**有全部领域逻辑的出口 | `db/positions.ts`、`db/strategyScripts.ts`、`db/strategyMemory.ts`、`services/industryClassifier.ts:198,233`、`services/researchComputation.ts`、`services/backtest/scriptRun.ts:118-131`（`runCodeSampled`/`runSavedScriptSampled`） | 桥只需转发，不用重写计算 |
| 前端 chat 已把「工具→handler」分好 | `chatEngine/toolHandlers.ts`（HTTP 族）、`toolHandlersBacktest.ts`（浏览器族） | 可作桥注册表的行为参照，但**不直接依赖**（前端 AI 是待删的债，AGENTS.md 明说） |
| bow `browser_eval` 无超时、无体积上限 | `/home/ruinb0w/Workspace/bow/src/main/mcp.ts:283-296`（`executeJavaScript(String(code), true)`） | 长任务会阻塞这次 eval；结果体积由 pi 的 MCP 适配器/我方 `jsonResult` 兜底 |
| pi 扩展发现规则：只扫 `.pi/extensions/`、`.pi/skills/`，且扩展子目录必须有 `index.ts` | pi `docs/configuration.md:34-35`、`docs/extensions.md`「subdirectories containing an `index.ts`」 | `.pi/lib/` 不会被当成扩展，安全 |
| `ToolDefinition` 支持 `namespace` / `annotations` / `promptGuidelines` | pi `docs/extensions.md:152-176`、`types.d.ts:390-480` | 统一注册可顺带打上 `readOnlyHint`/`destructiveHint` 供权限扩展使用 |
| 现有回归基线 | 记忆：frontend 399 tests / service 101 tests；`grep __gofund frontend/dist` 为空 | 每一步都要保持 |

## 3. 设计（三层）

```
pi 工具层（统一注册）
  .pi/extensions/gofund/      数据工具 15 个（service HTTP，只读）
  .pi/extensions/gofund-app/  通用应用工具 4 个（bow 桥）
        │
        ▼  共用
.pi/lib/gofund/               ← 新增共享运行时（不是扩展目录）
  result.ts   jsonResult / 截断 / 信封解包
  http.ts     SERVICE_BASE / apiGet / apiGetData / unwrap（从 gofund/client.ts 搬来）
  bow.ts      APP_BASE / findBrowserTool / callBrowserTool / 找标签 / 等待（从 gofund-app/browser.ts 搬来）
  bridge.ts   NEW：通用 RPC（ensureAppTab / listResources / callResource / openRoute / RPC 代码构造）
  tool.ts     NEW：defineGofundTool()（统一 namespace、annotations、错误翻译、尺寸上限）
        │
        ▼  window.__gofund（仅 DEV）
frontend/src/services/devBridge.ts  v2：资源注册表 + listResources()/call()
        │
        ▼  直接转发（零新业务逻辑）
db/strategyMemory.ts · db/positions.ts · db/strategyScripts.ts ·
services/industryClassifier.ts · services/researchComputation.ts ·
services/backtest/scriptRun.ts（Worker）+ db/navCache.ts
```

### 3.1 前端桥 v2 契约

```ts
export const DEV_BRIDGE_VERSION = 2

interface BridgeAction  { description: string; write?: boolean; run: (params: any) => Promise<unknown> }
interface BridgeResource { description: string; actions: Record<string, BridgeAction> }

interface DevBridgeV2 {
  version: 2
  ping(): string
  /** 能力目录：模型先看它再调用，避免猜 resource/action */
  listResources(): Promise<Array<{ name: string; description: string;
    actions: Array<{ name: string; description: string; write: boolean }> }>>
  /** 统一入口；未知 resource/action 抛错并在消息里列出可用值 */
  call(resource: string, action: string, params?: unknown): Promise<unknown>
  openRoute(path: string): Promise<string>
  // v1 方法原样保留（既有 skill 降级片段、单测、肌肉记忆）
  listStrategies, getActiveStrategies, buildActiveStrategyContext,
  addStrategy, updateStrategy, removeStrategy, setStrategyActive
}
```

- `call()` 内**不 catch**：异常冒泡给 `browser_eval`，由桥在 RPC 代码里 in-band 转成 `{__bridge:'ready', error}`（见 3.2），
  保证错误消息可读、不依赖 executeJavaScript 的 rejection 语义。
- 写入类 action 在成功后派发变更事件；本计划把策略已有的 `gofund:strategies-changed`
  泛化为 `gofund:db-changed`（`detail: { resource }`），相关 view 按 resource 过滤刷新
  （`StrategyView.vue:231` 现有监听见 `frontend/src/views/StrategyView.vue`）。
- 体积纪律：`screening` 类 action 只返回**聚合 + 限量列表**（如 4433 结果加 `limit`，默认 20）。

### 3.2 pi 侧 RPC 代码构造（`.pi/lib/gofund/bridge.ts`）

```ts
// resource/action/params 全部经 JSON.stringify 注入，避免引号注入
const code = `(async () => {
  const b = window.__gofund
  if (!b) return { __bridge: 'missing' }
  try {
    return { __bridge: 'ready', result: await b.call(${JSON.stringify(r)}, ${JSON.stringify(a)}, ${JSON.stringify(p ?? null)}) }
  } catch (e) { return { __bridge: 'ready', error: (e && e.message) || String(e) } }
})()`
```

`evalBridge()` 统一处理：`__bridge:'missing'` → 「前端 dev 桥未加载」；`error` → 抛出；
非对象 → 抛出；正常 → 返回 `result`。

### 3.3 统一注册（`.pi/lib/gofund/tool.ts`）

```ts
export function defineGofundTool(spec): ToolDefinition
// 自动补齐：namespace { name: 'gofund', description: 'GoFundBot 数据与应用控制' }
//           annotations { readOnlyHint / destructiveHint }
//           execute 外层 try/catch → 抛出可读中文错误
export function registerGofundTools(pi, tools): void
```

数据工具保留原名字（与前端 toolDefs 对齐，不破坏 skill/记忆）；应用工具用 `gofund_app_*` 前缀。

### 3.4 pi 侧新增的通用应用工具（4 个，替换原 3 个 strategy 专用工具）

| 工具 | 参数 | 说明 |
|---|---|---|
| `gofund_app_resources` | — | 返回桥的能力目录（resource/action/write 标记） |
| `gofund_app_read` | `resource, action, params?` | 只允许 `write !== true` 的 action；`readOnlyHint: true` |
| `gofund_app_write` | `resource, action, params` | 只允许 `write === true`；`destructiveHint: true` + `promptGuidelines`「必须先展示改动并拿到用户确认」 |
| `gofund_app_open` | `route?='/strategy'` | 打开/切换页面（原 `gofund_strategy_open`） |

> 决策点（见 §9）：是否把 `gofund_strategy_list/_save` 也删掉、全部走通用工具。
> 推荐：删掉并更新技能，让「一个泛化入口」名副其实。

### 3.5 资源注册表初版（前端 `devBridge.ts`，实现=转发既有函数）

| resource | action（读） | action（写） | 转发到 |
|---|---|---|---|
| `strategies` | `list`, `active`, `context` | `add`, `update`, `remove`, `setActive` | `db/strategyMemory.ts` |
| `positions` | `list` | `add`, `update`, `remove` | `db/positions.ts` |
| `watchlist` | `list`, `groups` | — | `db` 的 `watchlist`/`watchlistGroups` 表（只读起步） |
| `scripts` | `list`, `get` | `save`, `remove` | `db/strategyScripts.ts` |
| `screening` | `snapshot`（只返回计数/更新时间）, `by4433(limit?)`, `byIndustry(keyword)`, `industryPerformance` | — | `db.screeningFunds` + `industryClassifier.ts` |
| `backtest` | `runCode(code, overrides?)`, `runScript(name, overrides?)` | — | `services/backtest/scriptRun.ts` 的 `runCodeSampled` / `runSavedScriptSampled` |

> `backtest` 只返回**抽样 payload**（前端 chat 已用同一函数，体积可控）。
> 日志（`/api/logs/read`）是 service 侧，不放桥里，做成数据扩展的新工具 `get_service_logs`。

## 4. 新增 / 修改文件

### 新增
| 路径 | 作用 |
|---|---|
| `.pi/lib/gofund/result.ts` | `jsonResult` / `truncate` / `unwrapEnvelope` |
| `.pi/lib/gofund/http.ts` | `SERVICE_BASE` / `apiGet` / `apiGetData` / `unwrap` / `clampInt` |
| `.pi/lib/gofund/bow.ts` | 从 `gofund-app/browser.ts` 原样搬迁的 bow 连接层 |
| `.pi/lib/gofund/bridge.ts` | `ensureAppTab` / `listResources` / `callResource` / `openRoute` / RPC 代码构造 |
| `.pi/lib/gofund/tool.ts` | `defineGofundTool` / `registerGofundTools` |
| `.pi/lib/gofund/index.ts` | 统一出口 |
| `.pi/lib/gofund/__tests__/*.test.ts` | 纯函数断言（截断、信封、RPC 代码转义、工具名代理兜底），`bun test .pi/lib/gofund` |
| `.pi/lib/gofund/README.md` | 框架说明：三层、资源注册表、加一个能力的步骤 |
| `.pi/extensions/gofund-app/tools/app.ts` | 4 个通用应用工具 |
| `.pi/extensions/gofund/tools/logs.ts` | `get_service_logs` |
| `.pi/skills/gofund-app/SKILL.md` | 原 `gofund-strategy` 技能升级改名，覆盖全部 resource + 写确认流程 |

### 修改
| 路径 | 改动 |
|---|---|
| `frontend/src/services/devBridge.ts` | v2：`listResources`/`call` + 资源注册表 + 泛化变更事件；v1 方法保留 |
| `frontend/src/__tests__/services/devBridge.test.ts` | 补 v2 用例（目录、`call` 转发、未知 resource 报错、read/write 分类） |
| `frontend/src/db/positions.ts`、`db/strategyScripts.ts` | 写操作后派发 `gofund:db-changed`（与 `strategyMemory.ts` 同款 notify） |
| `frontend/src/db/strategyMemory.ts` | `notify()` 泛化为 `gofund:db-changed`（`detail.resource='strategies'`），保留旧事件名兼容 |
| 相关 view（`StrategyView.vue`、持仓/自选/回测页） | 监听 `gofund:db-changed` 并按 resource 过滤刷新 |
| `.pi/extensions/gofund/tools/{fund,market}.ts` | 改 import 到 `.pi/lib/gofund/*`；删 `gofund/client.ts` |
| `.pi/extensions/gofund-app/index.ts` | 注册通用工具（+ §9 决定是否保留 strategy 专用工具） |
| `.pi/extensions/gofund-app/browser.ts`、`tools/strategy.ts` | 删除/改由 shared 提供；工具逻辑迁到 `tools/app.ts` |
| 两个扩展的 `README.md`、`.pi/skills/gofund-data/SKILL.md` | 更新工具表、指向框架文档与新技能 |
| `AGENTS.md` | hot-spots 表更新 `.pi/extensions/gofund-app/` 描述 + 新增 `.pi/lib/gofund/` |

## 5. 实施步骤（每步可独立验证）

1. **共享运行时骨架**（`.pi/lib/gofund/{result,http,bow,bridge,tool,index}.ts` + README）。
   纯搬迁，行为不变；`bridge.ts`/`tool.ts` 为新代码。
   *验证*：`bun test .pi/lib/gofund`（RPC 代码转义、截断、信封、代理兜底四种形态全过）。
2. **数据扩展接上 shared**：改 3 个 tool 文件的 import，删 `client.ts`。*验证*：真跑 `get_market_indices` / `get_north_flow`，数值与 `curl :8310` 一致。
3. **应用扩展读路径接上 shared**：`tools/strategy.ts` 改用 `bridge.ts`，删 `browser.ts`。
   *验证*：真跑 `gofund_strategy_list`，返回与 `/strategy` 页面逐条一致。
4. **前端桥 v2**：加注册表 + `listResources`/`call`，保留 v1；扩展单测。
   *验证*：`cd frontend && bun run lint && bunx vue-tsc --noEmit && bun run test`；`grep -r "__gofund" frontend/dist` 为空。
5. **通用应用工具**：`gofund_app_resources/_read/_write/_open`；§9 决定 strategy 专用工具去留。
   *验证*：真跑 `resources` 目录；`read(strategies,list)`；`read(scripts,list)`；未知 resource 得到「可用：…」；`write` 无确认时按 guideline 先展示改动。
6. **能力面（只读）**：把 `positions/watchlist/scripts(读)/screening/backtest.runCode` 注册进桥并真跑。
   *验证*：每项与页面显示/`curl :8310` 对照；`backtest.runCode` 记录耗时（见风险 §7）。
7. **能力面（写入）**：`positions`/`scripts` 写 action + `gofund:db-changed` + 相关 view 刷新。
   *验证*：pi 写入后页面**不刷新即更新**；写错/取消不落库。
8. **service 日志工具**：`.pi/extensions/gofund/tools/logs.ts` 的 `get_service_logs`（`source/date/level/limit/offset/q`）。
   *验证*：与 `curl ':8310/api/logs/read?source=dataservice&date=<today>'` 对照。
9. **文档与技能**：框架 README、两扩展 README、`gofund-data` 技能增补、`gofund-strategy` → `gofund-app` 技能、AGENTS.md。
   *验证*：`/skill:gofund-app` 可加载；不加载时系统提示里只出现 name/description。
10. **回归 + 端到端**：frontend 全套（lint/tsc/test/build）；真 pi 全流程 + 四条负路径（bow 未启 / 应用未开 / 桥缺失 / 未知 action）；确认 15 个数据工具仍正常。

## 6. 验收标准

- 新增一个前端能力**只改前端一处**（注册表 + 领域函数），pi 侧泛化工具立即可用（用 `positions` 演示）。
- 一条明确路径触达四类能力：`gofund_app_read(positions,list)`、`scripts,list`、`screening,by4433`、`backtest,runCode` 全部真跑成功。
- 写操作 100% 经用户确认，且页面无需手动刷新即更新。
- 现有行为零回退：15 个数据工具数值不变；策略读写闭环不变；`frontend/dist` 无 `__gofund`；两端 lint/tsc/test/build 全绿。
- 共享运行时有一次纯函数测试通过；跨目录 import 在真 pi 下加载无告警。

## 7. 风险与未知

| 风险 | 处理 |
|---|---|
| `browser_eval` **无超时**，回测可能阻塞一次 eval 很久（`bow/src/main/mcp.ts:283`） | 只跑抽样出口；第 6 步实测耗时。若 >30s：桥改「job + poll」两段式（`backtest.start` 返回 jobId，`backtest.status` 轮询），代价是多两个 action |
| 通用工具让模型更易用错（resource/action 猜错） | 先 `gofund_app_resources`；`call` 的未知错误里列出可用值；技能里写工作流 |
| 写确认只是软约束（`promptGuidelines`） | 读写分成两个工具（`_read` 拒绝 write action）；`_write` 打 `destructiveHint`；保留技能硬约束 |
| 结果体积：screening/4433 可能很大 | 桥只返回聚合 + 限量列表；`jsonResult` 双向兜底 |
| `.pi/` 不在仓库 lint/typecheck 内 | 走纯函数 `bun test .pi/lib/gofund` + 真 pi 验证；共享模块保持小而直白 |
| 跨目录 import（`.pi/extensions/* → .pi/lib/*`）在 jiti 下解析 | 第 1/2 步就真跑验证；失败则回退方案：把 shared 放 `.pi/extensions/gofund/lib/`，应用扩展 `import '../gofund/lib/x.ts'` |
| 变更事件泛化可能触发现有无改动的 view 报错 | `gofund:db-changed` 的 `detail.resource` 做过滤；保留旧 `gofund:strategies-changed` |
| 能力面一次铺开过大 | 严格执行第 6 步（只读）通过再做第 7 步（写入）；每步独立可回滚 |

**无法从代码确认的点**：① pi 的 MCP 适配器对 `browser_eval` 结果的体积上限（假定 ~20KB，沿用现有 20KB `jsonResult`）；
② 嵌套 `ctx.executeTool` 在长 eval 下是否有额外超时；③ `executeJavaScript` 对 Dexie 返回的普通对象序列化是否始终无损
（现有 strategy 链路已证明普通对象可行，新资源照此约束：**桥只返回普通数组/对象**）。

## 8. 不做（本轮）

- service 侧 MCP server（用户已否决）。
- 删除类破坏性工具的独立确认 UI。
- 前端 AI 层的删除与契约一处化（AGENTS.md 的既有债，与新框架正交）。
- 改 service 业务路由。

## 9. 待拍板的小选择（评审时一并回复即可）

1. **strategy 专用工具去留**：推荐删掉 `gofund_strategy_list/_save`，全部并到 `gofund_app_*`；备选是保留为别名。
2. **技能改名**：推荐 `gofund-strategy` → `gofund-app`（描述扩成全部应用资源）；备选保留原名并扩内容。
3. **自选写入**：推荐本轮只读，写入留到真正需要时；若你要一起做，就把 `watchlist` 的 add/remove 纳入第 7 步。
4. **回测长任务**：先按「阻塞式」实测（第 6 步），只有实测 >30s 才上 job+poll；你若想直接上两段式也可以。
