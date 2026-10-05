# 方案：策略讨论中 LLM 自写回测代码（前端 Worker 沙箱）

## 0. 目标与已确认的取舍

**目标**：在策略讨论（以及所有含 `run_backtest` 的聊天入口）中，LLM 能自己写一段策略代码，
对某只基金的历史净值跑回测，并把结果带回对话继续讨论。

**已确认的三个决定**（用户已回答）：

1. **执行方式**：前端 Worker 沙箱（JS）。LLM 写 JS 策略函数，浏览器内执行，零后端改动。
2. **运行确认**：AI 先展示代码，**用户点击「运行」后才执行**（防提示注入 / 防误算）。
3. **生效范围**：所有含 `run_backtest` 的入口（`strategy` / `investment_strategy` / `general`
   三个聊天技能 + `analysis` 场景的 FULL_TOOL_NAMES）。

**需要说明的偏差（请在评审时确认）**：`analysis/` 的 4 个场景（fund_analysis 等）是**无 UI 的
headless 流程**，弹不出确认框。因此那里会**注册该工具但默认拒绝执行**（回喂一条纠错消息让模型改用
`run_backtest`），而不是在无人确认的情况下自动跑 LLM 代码。这样既满足「入口都注册」，又不会破
「必须用户确认」这条硬约束。

---

## 1. 现状（已读代码的证据）

- **现在只能选参数，不能写代码。** `frontend/src/services/chatEngine/toolContract.ts:154`
  `run_backtest` 的参数是枚举：
  ```
  investment_type: enumOf('monthly','weekly','daily','lump_sum')
  dca_rule:        enumOf('fixed','value_averaging','ma_deviation')
  ```
  `validateToolCall()`（同文件 379 行）用 TypeBox `Value.Check` 强校验，越界直接 `INVALID_ARGS`。
- **计算是纯函数，没有执行入口。** `backtestEngine.ts:29` `runBacktest(navHistory, spec)`，
  买入金额来自 `strategyRules.ts:114` `ruleBuyAmount()` 的三种写死规则，全仓库无 `eval` /
  `new Function` / `node:vm` / `new Worker`（已 grep 确认）。
- **策略频道的工具集 = 通用工具集。** `skills.ts:270` `toolNames: [...GENERAL_TOOL_NAMES]`；
  `GENERAL_TOOL_NAMES`（222 行）含 `run_backtest`。`StrategyView.vue:73` 用 `force-skill="strategy"`。
- **工具结果回喂有 4000 字符预算。** `toolLoop.ts:137` `truncateJson(value, 4000)`；这正是
  `timelineSample.ts` / `sampleBacktest()` 存在的原因（3 年日频 timeline ≈148 KB）。
- **工具循环没有暂停机制。** `chatEngine/index.ts:180` 拿到 tool_calls 后直接
  `executeToolCall()`；`chatApi.ts:56` 是纯转发。要加「确认」必须让 async generator 在中间 `await`。
- **service 默认绑 0.0.0.0 且开发态 CORS 全开**（`index.ts:31` `server.listen(port)`；
  `app.ts:38` `cors({ origin: true })`）——这也是为什么选前端沙箱、不新增后端执行端点。

---

## 2. 设计总览

```
LLM 调 run_strategy_code(fund_code, code, ...)
        │
chatEngine 识别到「需确认工具」
        ├─ yield { event:'tool_confirm', data:{ params } }   →  UI 展示代码卡片
        └─ await requestApproval()                           →  用户点「运行」/「取消」
                │ 取消 → 回喂 { error:'用户未批准执行该策略代码' }，不执行
                ▼ 批准
toolHandlers.run_strategy_code
        ├─ fetchNavHistory(fund_code) + clipNavHistory(range)   （复用现有链路）
        └─ runStrategyCode({ nav, spec, code })                  （主线程，5s 超时）
                │  new Worker(new URL('./strategyWorker.ts', import.meta.url), {type:'module'})
                ▼
strategyWorker.ts  →  handleRunStrategyRequest(payload)  （纯函数，可直接单测）
        ├─ compileDecision(code)        → new Function('s', code) + 校验/异常包装
        ├─ runBacktest(nav, spec, { decide })   （复用既有逐日循环 + summarize）
        └─ postMessage({ ok:true, summary, timeline })
                ▼
主线程 sampleBacktest 抽样 → 工具结果（<4KB）回喂模型；完整曲线不进上下文
```

### 2.1 LLM 要写的代码契约（简单的「按日决策」模型）

LLM 写一个**函数体**（或完整 `function onDay(s){}`，编译前归一化），每个交易日调用一次：

```js
// s 只含「当日及以前」的数据，杜绝未来函数
// s = {
//   i, date, nav, navs: number[],          // navs = 截至今日（含）的净值
//   shares, invested, value,               // 持仓/累计投入/市值
//   returnRate(),                          // (value - invested) / invested
//   args: { initial_amount, fee_rate },
//   helpers: { ma(n), pctChange(n) }        // 都是「不含今日」的前 n 日，避免未来函数
// }
// 返回 { buy?: number, sellAll?: true }；金额单位「元」
function onDay(s) {
  const ma = s.helpers.ma(60)
  if (s.invested === 0 && s.nav < ma * 0.98) return { buy: 3000 }
  if (s.returnRate() > 0.30) return { sellAll: true }
  return { buy: s.nav < ma ? 1500 : 500 }
}
```

- `sellAll: true` → 清仓收现金，`exit_reason: 'custom'`，之后不再交易（与止盈止损同路径）。
- 引擎级 `take_profit_rate` / `stop_loss_rate` 仍然生效（可叠加，也可省略）。
- 校验：`buy` 必须有限且 ≥ 0（否则抛「第 i 天返回非法 buy」）；`onDay` 抛异常 → 整个回测失败并回报
  出错日期；返回非对象 → 视为不操作。

### 2.2 为什么复用 `runBacktest` 而不是在 Worker 里另写一个循环

`backtestEngine.ts` 的逐日会计（手续费、止盈止损、`pyRound`、`summarize` 的夏普/回撤/年化）
已经过黄金 fixtures 逐值验证（`docs/architecture/backtest-engine.md`）。给引擎加一个
**可选 `hooks.decide`**，自定义代码只负责「今天买多少/是否清仓」，其余全部复用，避免第二套会计逻辑分叉。

### 2.3 沙箱强度（诚实说明）

浏览器里没有真正的 JS 沙箱。本方案做到的是：

1. **可取消**：代码跑在 Worker 里，主线程 5s 未返回就 `worker.terminate()`——
   死循环/超长计算不会卡死页面（这是必须用 Worker 的唯一理由）。
2. **尽力遮蔽**：`strategyWorker.ts` 顶层先 `Object.defineProperty(self, k, {value: undefined})`
   遮蔽 `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `indexedDB` / `caches` /
   `importScripts` / `Worker` / `SharedWorker` / `BroadcastChannel` / `navigator` / `location`。
3. **不注入任何密钥**：Worker 只收到净值数组 + 数字参数 + 代码字符串，LLM key / IndexedDB 数据
   **从不进入** Worker。

**已知的残余风险**：上述遮蔽可以被 `Object.getPrototypeOf(self)` 这类间接引用绕过；代码理论上仍能
发网络请求或读同源存储。因此**「用户点击运行」是主要的信任边界**，必须在 UI 上把代码原文完整展示、
可复制、可取消。真正的恶意代码防护不在本方案范围（本方案防的是「LLM 写错 / 被网页内容注入带偏」）。

---

## 3. 需要改动的文件

### 新增

| 文件 | 作用 |
|------|------|
| `frontend/src/services/backtest/strategySandbox.ts` | 纯逻辑：`compileDecision(code)`、`makeHelpers(navs)`、`handleRunStrategyRequest({nav, spec, code})`（内部调 `runBacktest(..., {decide})`）、`MAX_CODE_LENGTH` / 错误类型。**不引用 Worker**，可直接单测 |
| `frontend/src/services/backtest/strategyWorker.ts` | 薄壳：顶层遮蔽全局 → `self.onmessage = e => self.postMessage(handleRunStrategyRequest(e.data))` |
| `frontend/src/services/backtest/runStrategyCode.ts` | 主线程：起 Worker、5s 超时 + `terminate()`、校验回包、`sampleBacktest` 抽样成工具结果 |
| `frontend/src/services/chatEngine/toolApproval.ts` | `CONFIRM_REQUIRED_TOOLS = new Set(['run_strategy_code'])` + 单例 broker（`request()` 返回 Promise，`resolveApproval(ok)`，reactive `pending`） |
| `frontend/src/components/CodeApprovalCard.vue` | 代码卡片：基金代码/区间/`<pre>` 代码 + 「运行」「取消」按钮，运行时禁用 |
| `frontend/src/__tests__/services/strategySandbox.test.ts` | 见 §5 |
| `frontend/src/__tests__/services/backtestCustom.test.ts` | 见 §5 |

### 修改

| 文件 | 改动 |
|------|------|
| `frontend/src/services/backtest/backtestTypes.ts` | `exit_reason` 联合类型加 `'custom'`（两处：timeline record + summary）；新增 `DecisionState` / `Decision` 类型 |
| `frontend/src/services/backtest/backtestEngine.ts` | `runBacktest(navHistory, spec, hooks?)`；`hooks.decide` 存在时走自定义决策分支（替代 `scheduled`/`ruleBuyAmount`），并处理 `sellAll` → `exitReason='custom'`；`investment_count` 用实际买入次数 |
| `frontend/src/services/backtest/timelineSample.ts` | `sampleBacktest(result, spec, opts?: { specLabel?: string })`，让自定义策略的 `spec` 字段显示「自定义策略代码」而不是「等额定投」 |
| `frontend/src/services/chatEngine/toolContract.ts` | 新增 `run_strategy_code` ToolSpec；`code` 参数用 `Type.String({ maxLength: 8000, description: <完整 API 契约> })`——`toolSpecsToXml()` 会把每个参数 description 打进 `<available_tools>`，所以契约写在参数描述里两条通道都能看到 |
| `frontend/src/services/chatEngine/toolHandlers.ts` | 新增 handler：`resolveDateRange` + `fetchNavHistory` + `clipNavHistory` + `runStrategyCode` |
| `frontend/src/services/chatEngine/skills.ts` | `GENERAL_TOOL_NAMES` 与 `investment_strategy.toolNames` 加入 `run_strategy_code` |
| `frontend/src/services/chatEngine/index.ts` | tool 循环里插入确认闸门：`requiresApproval` → yield `tool_confirm` → `await requestApproval()`；`ChatArgs` 加 `requestApproval?` |
| `frontend/src/services/analysis/analysisScenarios.ts` | `FULL_TOOL_NAMES` 加 `run_strategy_code`（honor「所有入口」） |
| `frontend/src/services/analysis/analysisEngine.ts` | 同款闸门，但无 UI：默认拒绝，回喂纠错消息「此场景不支持交互确认，请改用 run_backtest」 |
| `frontend/src/services/chatApi.ts` | `sendMessage` 加可选 `requestApproval`；`_handleEvent` 处理 `tool_confirm` → 新回调 `onToolConfirm` |
| `frontend/src/stores/chatStore.ts` | `sendMessage` 透传 `toolApproval.request`；白名单在 UI 侧无需感知（卡片读 broker 的 pending） |
| `frontend/src/components/ChatPanel.vue` | 消息区渲染 `<CodeApprovalCard>`（broker pending 时） |
| `frontend/src/components/FundBacktest.vue` | `exit_reason === 'custom'` 的文案（两处三元），避免显示成「止损卖出」 |
| `frontend/src/__tests__/services/toolContract.test.ts` | `EXPECTED_TOOLS` 26→27 并加 `run_strategy_code` 的必需参数断言 |
| `docs/architecture/backtest-engine.md` | 自定义策略章节（hooks / 代码契约 / 沙箱边界） |
| `docs/architecture/ai-chat.md` | 新工具、确认流程；顺手修正「25 个工具」的既有漂移（实际 26→27） |

---

## 4. 实施步骤（每步可独立验证）

**Step 1 — 引擎支持自定义决策（纯前端，可单测）**
- `backtestTypes.ts`：`exit_reason` 加 `'custom'`；新增 `DecisionState` / `Decision`。
- `backtestEngine.ts`：加第三参 `hooks?: { decide?: (s: DecisionState) => Decision | void }`；
  `normalizeSpec` 后如果 `hooks.decide` 存在，逐日分支改为调用 `decide`（传 `navs: navs.slice(0, i+1)`），
  `sellAll` → 清仓 + `exit_reason='custom'`；`summarize` 的 `investmentCount` 传实际买入数。
- 验证：`bunx vitest run src/__tests__/services/backtestEngine.test.ts`（**12 个黄金用例必须仍逐值一致**
  —— 不传 hooks 时行为零变化）。

**Step 2 — 沙箱纯逻辑 + Worker 壳**
- `strategySandbox.ts`：`makeHelpers(navs)`（`ma(n)` / `pctChange(n)` 均取「不含今日」的前 n 日）、
  `compileDecision(code)`（`new Function('s', code)`，归一化 `function onDay(s){}` 包裹）、
  `handleRunStrategyRequest()`（校验代码长度 → 编译 → `runBacktest(..., {decide})` →
  捕获编译/运行错误并带 `date` 回报）。
- `strategyWorker.ts`：遮蔽全局 + `onmessage`。
- `runStrategyCode.ts`：Worker 生命周期 + 超时。
- 验证：`bunx vitest run src/__tests__/services/strategySandbox.test.ts`（不依赖真 Worker）。

**Step 3 — 工具契约 + handler**
- `toolContract.ts` 加 spec（`code` 参数描述里写全 §2.1 契约）。
- `toolHandlers.ts` 加 handler（复用 `fetchNavHistory` / `clipNavHistory` / `resolveDateRange`，
  返回 `sampleBacktest(result, spec, {specLabel:'自定义策略代码'})`）。
- `skills.ts` 把工具名加进通用/定投策略集合。
- 验证：`bunx vitest run src/__tests__/services/toolContract.test.ts`（更新后 27 个）
  与 `chatEngine.test.ts` 的「每个 skill 工具名都已注册」用例。

**Step 4 — 确认闸门（聊天链路）**
- `toolApproval.ts` broker；`chatEngine/index.ts` 在 `executeToolCall` 前插入
  `tool_confirm` 事件 + `await requestApproval()`；拒绝时回喂 `{error:'用户未批准执行该策略代码'}`。
- `chatApi.ts` 转发 `tool_confirm`；`chatStore.ts` 透传 `requestApproval`。
- 验证：`bunx vitest run src/__tests__/services/chatEngine.test.ts` 新增用例——
  `requestApproval` 返回 `false` 时 `executeTool` **未被调用**、历史里出现拒绝消息；
  返回 `true` 时正常执行。

**Step 5 — 确认 UI**
- `CodeApprovalCard.vue` + `ChatPanel.vue` 接入 broker；等待确认时卡片显示、按钮置灰、输入框禁用。
- 验证：`bunx vue-tsc --noEmit` + 手工用真实 LLM 走一遍（见 Step 7）。

**Step 6 — headless 场景拒执 + 文档**
- `analysisScenarios.ts` / `analysisEngine.ts` 默认拒绝分支；`FundBacktest.vue` 文案；
  `docs/architecture/backtest-engine.md` + `ai-chat.md`。
- 验证：`bunx vitest run src/__tests__/services/analysisScenarios.test.ts` 与新用例。

**Step 7 — 全量校验 + 真实链路**
```bash
cd frontend && bun run lint && bunx vue-tsc --noEmit && bun run test && bun run build
```
再用 bow 浏览器（本仓库 skill）在真实 LLM 下确认：
① 模型能生成合法 `run_strategy_code` 调用；② 代码卡片出现且可读；③ 点「取消」不进回测、
对话继续；④ 点「运行」返回 summary 并能追问；⑤ 死循环代码 5s 被终止、页面不卡。

---

## 5. 测试清单

- `strategySandbox.test.ts`
  - `helpers.ma(2)` 在 `i` 处只取 `navs[i-2..i-1]`（**无未来函数**）；
  - 合法函数 → 产出 timeline/summary；`buy` 为负数/NaN → 报错；
  - 函数抛异常 → 错误信息含出错日期；
  - 超过 `MAX_CODE_LENGTH` → 拒绝（TypeBox 之外的第二道防线）。
- `backtestCustom.test.ts`
  - 自定义 `decide` 复现「每月首交易日买 1000」与既有 `fixed` 规则一致；
  - `sellAll` 在触及年线卖出 → `exit_reason === 'custom'` 且之后不再买入；
  - `hooks` 缺省时既有 fixtures 逐值不变（防回归）。
- `chatEngine.test.ts`：确认通过 / 拒绝两条路径（见 Step 4）。
- `toolContract.test.ts`：27 个工具、`run_strategy_code` 必需参数、`code.maxLength`。
- `analysisScenarios.test.ts`：headless 场景调用该工具时回喂纠错 envelope，且**不执行**。

## 6. 风险与未知

1. **沙箱不是安全边界**（§2.3）。缓解：必须用户确认 + 不注入密钥 + Worker 可终止。
   若将来接入不可信内容源（如第三方网页）时要求更强隔离，需换 iframe opaque-origin 或 WebAssembly
   解释器——不在本次范围。
2. **Worker 在 Vite dev / Electron 下的加载形态**：用 `new Worker(new URL('./strategyWorker.ts', import.meta.url), {type:'module'})`
   是 Vite 官方支持写法；但**需要真机验证** Electron 打包产物（`frontend/dist`）里 worker chunk 能被正确加载。
   若失败，退路是 `import StrategyWorker from './strategyWorker?worker'`。
3. **等待确认期间的状态**：`chat()` 卡在 `await` 时 `isStreaming` 仍为 true；若用户切换会话/关闭面板，
   这个 Promise 可能永不 resolve（现有代码本来也没有 abort 机制）。本次只保证 UI 看起来是「等待确认」，
   **不做会话切换时的取消回收**，列在已知限制。
4. **模型能力**：默认 Qwen2.5-7B 写 JS 策略可能出错。通过 (a) 参数描述里给完整契约与示例、
   (b) 错误回喂成 `TOOL_ERROR` 让模型自纠、(c) 保留 `run_backtest` 作为模板路径 来兜底。
5. **`exit_reason` 联合类型扩展**是编译期可见改动，需检查所有 `=== 'take_profit'` 分支（已 grep：
   只有 `FundBacktest.vue` 两处，均在本计划内）。

## 7. 不在本次范围

- 不做 Python / 后端执行端点（用户已选前端沙箱）。
- 不做用户「永久批准」记忆（用户选了每次确认）。
- 不把自定义策略持久化到 `db/backtestRuns.ts`（该表只存 `spec`；自定义代码是 transient 的，
  如需保存应另开「保存策略代码」功能）。
- 不重构 `analysisEngine` 的 headless 确认（仅默认拒绝）。
