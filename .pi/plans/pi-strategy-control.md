# 计划：让 pi 能分析 / 修改策略记忆，并在 bow 里打开 /strategy 页面


> ⚠️ **2026-10-07 更新（P4）**：`gofund_strategy_list/_save` 已删除 —— 策略读写改走 service HTTP
> （`list_strategies` / `save_strategy`，带确认令牌），只保留 `gofund_strategy_open` 驱动浏览器。
> 现行说明见 `.pi/skills/gofund-strategy/SKILL.md`。

## 1. 目标与假设

**目标**：终端 pi 具备对 GoFundBot「策略记忆」的完整闭环 —— 读出现有策略 → 结合行情数据提出改进 →
用户在对话里确认 → pi 写入应用（Dexie `strategies` 表）→ 自动在 bow 里把 `/strategy` 页面显示给用户。

**已确认的四个决定（用户 2026-10-07 选择）**
1. 范围 = **策略记忆**（`/strategy` 页，Dexie `strategies` 表），不含回测方案（`strategyScripts`）。
2. 前端日常在 **bow 浏览器** 里打开（不是 Electron 壳 / 系统浏览器）。
3. pi 的写入通道 = **前端 dev-only 桥 `window.__gofund`**（复用 `db/strategyMemory.ts` 真实函数）。
4. 确认方式 = **对话里确认后写入**（pi 先给新旧对照，用户回「确认」，再落库并打开页面）。

**假设（不成立需先纠正）**
- service（:8310）与 frontend dev（:8517）由用户自己起；bow 至少开着。
- `import.meta.env.DEV` 是唯一运行时门禁（本项目没有 prod —— 见 AGENTS.md「移除 prod 相关内容」）。
- 接受「pi 写的是**用户当前这个 bow profile** 里的 IndexedDB」；换浏览器/换壳看到的不是同一份数据。

**不在本轮**：回测方案（`strategyScripts`）、持仓、删策略工具、把前端 AI 删掉、service 侧改动。

## 2. 为什么是这个形状（依据 — 都是读过的代码）

| 事实 | 出处 | 影响 |
|---|---|---|
| `browser_eval` 实现是 `view.webContents.executeJavaScript(String(code), true)` | `bow/src/main/mcp.ts:286-291` | 在页面**主世界**执行、**会 await 返回的 Promise**、结果按值序列化 → `await window.__gofund.listStrategies()` 直接可用 |
| bow 建窗没有 `partition`（默认 session） | `bow/src/main/index.ts:40-58` | agent 窗口与用户窗口**共享** localhost:8517 的 IndexedDB，同一个 `GoFundBot` 库 |
| 扩展工具的 `execute(toolCallId, params, signal, onUpdate, ctx)`，`ctx: ExtensionToolContext` 上有 `executeTool(name, args)` | `pi-coding-agent/dist/core/extensions/types.d.ts:488` / `:269-281` | pi 扩展工具**可以确定性地调用 MCP 的 `browser_eval`**，不必让模型手写 JS 片段 |
| 策略 CRUD 全在 `db/strategyMemory.ts`：`listStrategies()` / `addStrategy({title,content,tags,active,source})` / `updateStrategy(id, patch)` / `removeStrategy(id)` / `toggleStrategyActive(id, active)` / `buildActiveStrategyContext()` | `frontend/src/db/strategyMemory.ts` | dev 桥直接复用这些函数，校验 / `updatedAt` / `source` 与 UI 完全一致 |
| `StrategyView` 只在 `onMounted(refresh)` 拉一次，保存后自己 `refresh()` | `frontend/src/views/StrategyView.vue:170,231` | pi 在别处写入后页面**不会**自己更新 → 需要一个变更信号 |
| 路由是 `createWebHashHistory`，`/strategy` 的 URL 是 `http://localhost:8517/#/strategy` | `frontend/src/router/index.ts:1,68` | 「打开策略页面」= 新标签开该 URL，或对已开标签 `router.push('/strategy')` |
| `buildStrategyContext` 只取 `active === 1` 的策略注入 AI 提示词 | `frontend/src/db/strategyMemory.ts:31-36` | `active` 是「是否影响 AI」的开关，pi 改策略时必须显式处理 |
| `browser_eval` / `browser_list_tabs` / `browser_switch_tab` / `browser_new_tab` 是 bow 的 MCP 工具名 | `bow/src/main/mcp.ts:283`、`mcp({search:'tab'})` 实测 | **但可能带前缀**（bow-browser skill 举过 `bow_browser_navigate`）→ 必须按后缀动态解析工具名 |

## 3. 设计

```
pi(tool: gofund_strategy_list / _save / _open)
  └─ ctx.executeTool('<动态解析:browser_*>' , …)          ← .pi/extensions/gofund-app/
       └─ bow MCP
            └─ browser_eval 在 http://localhost:8517 标签页主世界执行
                 └─ window.__gofund.*                       ← frontend/src/services/devBridge.ts (仅 DEV)
                      └─ db/strategyMemory.ts (Dexie strategies)
                          └─ 派发 'gofund:strategies-changed'
                               └─ StrategyView 监听 → refresh()  ← 页面立即更新，无需刷新
```

- **工具层**（`.pi/extensions/gofund-app/`）负责：找到 app 标签页、把参数编成 eval 代码、解析 bow 的 `{ok,…}` 信封、
  把「桥没加载 / 前端没开 / bow 没连」翻译成可读错误。模型永远不用自己写 JS。
- **桥层**（`frontend/src/services/devBridge.ts`）只做转发 + 变更通知，不含业务逻辑。
- **变更信号**放在 `db/strategyMemory.ts` 的写函数里（写者无关）：UI 表单、dev 桥、以后任何写者都能让页面刷新。

## 4. 要改 / 新增的文件

### 新增
| 路径 | 作用 |
|---|---|
| `frontend/src/services/devBridge.ts` | 仅 DEV 安装 `window.__gofund`：`{ version, ping, listStrategies, getActiveStrategies, buildActiveStrategyContext, addStrategy, updateStrategy, removeStrategy, setStrategyActive, openRoute }`；依赖可注入（便于单测）。`declare global { interface Window { __gofund?: DevBridge } }` |
| `frontend/src/__tests__/services/devBridge.test.ts` | 注入假依赖 + 假 router + jsdom：验证 `ping`、`addStrategy` 转发与变更事件、`openRoute` 调 `router.push` |
| `.pi/extensions/gofund-app/index.ts` | 扩展工厂：`pi.registerTool` 注册 3 个工具（与 `gofund` 数据扩展分开——那个 README 明确承诺 read-only，且写权限应能独立授信/停用） |
| `.pi/extensions/gofund-app/tools/strategy.ts` | 3 个工具 + `browser_*` 工具名动态解析 + app 标签页定位 |
| `.pi/extensions/gofund-app/README.md` | 工具表、`GOFUND_APP_BASE`、与 `gofund-app` 派发信号的关系、局限（只有 bow profile 里的数据） |
| `.pi/skills/gofund-strategy/SKILL.md` | 路由说明 + 工作流：先 `gofund_strategy_list` 读出全部策略 →（需要时配 `gofund-data` 的行情工具）给分析 → 展示新旧对照 → **等用户明确确认** → `gofund_strategy_save` → 自动打开页面。含降级：工具不可用时用 `browser_eval` 直调的原始片段 |

### 修改
| 路径 | 改动 |
|---|---|
| `frontend/src/main.ts` | 在 `app.use(router)` 之后：`if (import.meta.env.DEV) installDevBridge(router)` |
| `frontend/src/db/strategyMemory.ts` | 新增 `export const STRATEGIES_CHANGED_EVENT = 'gofund:strategies-changed'` + 私有 `notify()`（`typeof window !== 'undefined'` 守卫）；在 `addStrategy` / `updateStrategy` / `removeStrategy` / `toggleStrategyActive` 成功后派发 `window.dispatchEvent(new CustomEvent(...))` |
| `frontend/src/views/StrategyView.vue` | `onMounted` 里 `window.addEventListener(STRATEGIES_CHANGED_EVENT, refresh)`，`onUnmounted` 移除（`refresh` 现有实现不动） |
| `.pi/skills/gofund-data/SKILL.md` | 「这里没有的能力」段落里，策略记忆不再是「必须去前端手动操作」→ 指向 `gofund-strategy` 技能 |
| `AGENTS.md` | hot-spots 表加 `frontend/src/services/devBridge.ts` 与 `.pi/extensions/gofund-app/` 两行 |

### 三个工具的契约（TypeBox）
| 工具 | 参数 | 行为 |
|---|---|---|
| `gofund_strategy_list` | — | 定位 app 标签 → eval `await window.__gofund.listStrategies()` + `buildActiveStrategyContext()`；返回 `{count, items, active_context}`。找不到 app 标签 → 报错并提示先 `gofund_strategy_open` |
| `gofund_strategy_save` | `{ id?: Integer, title: string, content: string, tags?: string[], active?: boolean, open?: boolean=true }` | 有 `id` → update（**不传 `source`**，保留原徽标）；无 `id` → add 且 `source:'ai-draft'`；成功后若 `open` → 打开 /strategy。描述里写明「仅在用户确认后调用」 |
| `gofund_strategy_open` | `{ route?: string='/' + 'strategy' }` | 有 app 标签 → eval `openRoute(route)` + `browser_switch_tab`；没有 → `browser_new_tab { url: 'http://localhost:8517/#/strategy', activate: true }` |

**关键实现细节**
- 工具名解析：`ctx.tools.map(t => t.name).find(n => n.endsWith('browser_eval'))`（同理 `browser_list_tabs` / `browser_switch_tab` / `browser_new_tab`）；
  一个都找不到 → 明确报「bow 浏览器 MCP 未连接（检查 bow 是否在运行、MCP HTTP 插件是否启用）」。**不要硬编码前缀**。
- 解析 `executeTool` 结果：`outcome.isError` → 报错；否则 `JSON.parse(result.content 里 type==='text' 的 text)` 得到 bow 的 `{ok, result|error}`。
- eval 代码用 `JSON.stringify(params)` 拼参数，避免引号注入。
- app 标签匹配：`url.startsWith(process.env.GOFUND_APP_BASE ?? 'http://localhost:8517')`，优先 `windowRole === 'user'` 的那条。
- 桥缺失（`typeof window.__gofund === 'undefined'`）→ 提示「前端 dev 桥未加载：确认 frontend 跑在 `bun run dev` 且该标签页是最近的版本，刷新一次」。

## 5. 实施步骤（有序，每步可单独验证）

1. **`frontend/src/db/strategyMemory.ts`**：加常量 + `notify()` + 四个写函数派发事件。验证：`cd frontend && bun run test`（既有 `strategyMemory.test.ts` 只测纯函数，应仍绿）。
2. **`frontend/src/services/devBridge.ts`** + 单测。验证：`bun run test`（新用例过）+ `bunx vue-tsc --noEmit`。
3. **`frontend/src/main.ts`（DEV 门禁）+ `StrategyView.vue`（监听刷新）**。验证：`bun run lint && bunx vue-tsc --noEmit && bun run build`。
4. **DEV 门禁自检**：`grep -r "__gofund" frontend/dist` 应为**空**。若非空（静态 import 未被 DCE），把 `main.ts` 的调用改成 `if (import.meta.env.DEV) import('./services/devBridge').then(m => m.installDevBridge(router))`。
5. **`.pi/extensions/gofund-app/`（3 个工具 + README）**。验证（真跑，必须先确认 `ctx.tools` 里能看到 bow 的工具名 —— 这是本计划最大的未知）：
   ```bash
   cd service && bun run dev        # 终端 A
   cd frontend && bun run dev       # 终端 B
   # 终端 C：仓库根目录
   pi --approve
   ```
   在 pi 里：`用 gofund_strategy_list 列出我的策略` → 结果与 `/strategy` 页面逐条一致。
6. **写入闭环**：`帮我看下现有策略有什么问题，给个改进版` → pi 给新旧对照 → 回「确认」→ 检查 (a) 页面**不刷新即更新**，(b) 另一只 bow 窗口里的同一页面刷新后内容一致，(c) `active` 徽标 / `source=AI起草` 正确。
7. **`.pi/skills/gofund-strategy/SKILL.md`** + 改 `gofund-data` 技能里过期的「没有的能力」一句。验证：`/skill:gofund-strategy` 能加载；不加载时系统提示里只出现 name/description。
8. **负路径**：① 关掉 bow → 工具报「MCP 未连接」而不是挂起/堆栈；② 开着 bow 但没开 8517 标签 → `gofund_strategy_list` 报「前端未打开」，`gofund_strategy_open` 能把它开出来；③ 8517 标签是旧版本（没有 `__gofund`）→ 报「桥未加载」。
9. **回归**：`cd frontend && bun run lint && bunx vue-tsc --noEmit && bun run test && bun run build`；`cd service && bun run lint && bun run typecheck && bun run test`（本轮不动 service，确认没误伤）；`pi --approve` 确认 `gofund` 数据扩展的 15 个工具仍正常（新增扩展不影响它）。
10. **`AGENTS.md` + `.pi/extensions/gofund/README.md`** 交叉引用。

## 6. 验收标准

- pi 能在一次会话里完成「列出策略 → 分析 → 拿到确认 → 落库 → 页面自动显示」，全程不要求用户手工操作。
- 页面在 pi 写入后**无需手动刷新**即更新（同一标签页）；`strategies` 表的字段与 UI 手动保存完全一致。
- `frontend/dist` 里没有 `__gofund`；`.pi/` 之外没有为 pi 新增的运行时分支。
- bow 未运行 / 前端未打开 / 桥未加载 三种情况都给出可读的下一步，而不是静默失败。

## 7. 风险与未知

| 风险 | 处理 |
|---|---|
| **`ctx.tools` 里 bow 工具的实际名字不确定**（可能 `browser_eval` / `bow_browser_eval` / `mcp__browser__browser_eval`） | 按**后缀**动态解析；第 5 步第一件事就是打印 `ctx.tools` 名字确认 |
| `executeTool` 只能在「模型调用扩展工具」的上下文里用（另一处 `context_with_system` 型 executeTool 是给别的钩子的） | 工具就是这么被调用的，天然满足；第 5 步真跑验证 |
| `browser_eval` 的结果序列化（`executeJavaScript` 返回 Vue/Proxy 对象会变 `{}`） | 桥里只返回 Dexie 的**普通对象数组**，不返回响应式对象 |
| 桥是 DEV-only，用户若哪天跑 build/preview 就没有它 | 这是刻意的（本项目只有 dev）；错误文案直接教用户跑 `bun run dev` |
| 用户正在表单里编辑时 pi 写入 → 后写覆盖先写 | 工具描述 + skill 要求「写入前先展示新旧对照并得到确认」；本轮不做并发合并 |
| 新增 3 个 `direct` 工具挤占系统提示（现有 15 个 + bow 的 39 个已经不小） | 先 direct；若上下文开销明显，改 `exposure: 'deferred'` 配 `tool_search`（与 `gofund` 扩展 README 第 9 节同一手法） |
| `.pi/` 不在仓库 lint/typecheck 范围内 | 只能靠第 5–8 步真跑；工具代码保持小而直白 |
| 用户换了浏览器/Electron 壳 → 看不到 pi 写的策略 | 在 skill 与 README 里写明：「pi 改的是你 bow profile 里的那份数据」，这是当前架构的固有边界 |
| 删除策略没有工具 | 刻意的（破坏性）；用户要删可手动，或以后单独加带确认的工具 |

**无法从代码确认的点**：pi 侧 MCP 工具在 `ctx.tools` 里的确切命名与本项目的 mcp-adapter 配置（`~/.pi/agent/mcp-adapter.json`）有关，只能真跑确认 —— 已把动态解析作为设计的一部分，所以命名怎么变都不影响实现。

## 8. 后续（本轮不做）
1. 同一套桥 + 工具扩到回测方案（`strategyScripts`：读 / 保存代码 / 触发回测 / 打开 `/backtest`）。
2. 需要删除或批量操作时，再加带 `CONFIRM_REQUIRED` 语义的工具。
3. 若将来要换掉前端 AI，把 `gofund-app` 的工具契约与前端 `toolDefs.ts` 一处化（与 `gofund` 数据扩展同一笔债）。

## 9. 实施记录（2026-10-07，已完成）

**落地文件**：`frontend/src/services/devBridge.ts`（+ 单测）、`frontend/src/db/strategyMemory.ts`（变更事件）、
`frontend/src/main.ts`（DEV 门禁）、`frontend/src/views/StrategyView.vue`（监听刷新）；
`.pi/extensions/gofund-app/{index,browser}.ts` + `tools/strategy.ts` + `README.md`；
`.pi/skills/gofund-strategy/SKILL.md`；`gofund-data` 技能 + `gofund` README + `AGENTS.md` 交叉引用。

**验收证据（全部真跑）**：
- 读：`gofund_strategy_list` → `{count:2, tab_id:9, bridge_version:1}`，两条策略与页面逐条一致（id 4 / id 1）。
- 写：`gofund_strategy_save` 新建 id=5（`source:'ai-draft'`、`active:1`、`page_opened:true`）；
  同一标签页 `.memory-item` **从 2 直接变 3，全程未刷新** → 变更事件链路成立。
- 清理：`removeStrategy(5)` 后 Dexie 立即回到 id [4,1]，页面随后回到 2 条（Vue `refresh()` 异步，同一 tick 读 DOM 会看到旧值）。
- `gofund_strategy_open` → `{"opened":true,"route":"/strategy"}`。
- 负路径：bow 未连 / 白名单 `-t` 挡掉 MCP 工具 / 前端未起 / 无 8517 标签（自动新开）/ 桥缺失，均有明确文案。
- 回归：frontend lint + vue-tsc + **399 tests** + build 绿；service lint + typecheck + **101 tests** 绿；
  `grep -r "__gofund" frontend/dist` **空** → DEV 门禁与 tree-shaking 成立（静态 import 无需改动态）。

**与计划的偏差（都是验证中发现的必要修正）**：
1. **bow 的工具可能是单个命名空间代理**：实测 `ctx.tools` 36 项里浏览器只有一个 `mcp__browser`（取 `{tool, args}`），
   不是一工具一条的 `browser_eval`。`findBrowserTool` 按后缀匹配，`callBrowserTool` 在只有代理时改走
   `executeTool('mcp__browser', {tool, args})`。
2. **bow 工具返回值形状不统一**：`browser_eval` 是 `{ok, result}`，`browser_list_tabs`/`browser_new_tab`
   把载荷摊平在顶层（`{ok, tabs}` / `{ok, tabId}`）。原先只取 `result` 导致「有 4 个 8517 标签却报没有」。
3. **`browser_new_tab` 不能用 `waitUntil:'load'`**：Vite 冷启动超过它 15s 的超时（标签其实已建好）。
   改为 `waitUntil:'none'` + 轮询 `waitForAppTab` / `waitForBridge`（各 45s 预算）。
4. **`browser_eval` 不支持顶层 `await`**（`executeJavaScript` 按脚本求值）→ 必须 `(async () => …)()`。
   已把技能里的降级片段改成 IIFE 并写明原因。
5. `pi --tools/-t` 白名单会把 MCP 工具也挡掉 → `MCP_MISSING` 文案里明确写上这一条（否则误导用户去查 bow）。

**仍缺**：删除策略的工具（刻意不做，破坏性）。同一条通道扩到回测方案 / 持仓仍是后续工作。
