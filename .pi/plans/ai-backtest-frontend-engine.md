# 计划：AI 回测能力补全 —— 前端回测引擎 + 声明式策略 DSL + 沙箱自定义策略

状态：**Phase 1 已执行并验证；步骤 15（删除 Python 回测路径）与跨年周修复也已完成（2026-09-29）**；Phase 2（沙箱自定义策略）暂不做。执行记录见文末。

---

## 1. 目标

让 AI 能跑「任意参数 / 任意策略逻辑」的回测，同时**不把 LLM 生成的代码直接送进本机 Python**。

两个前提假设（若有偏差请纠正）：

- 现有回测页的**输出契约与数字口径不变**（`summary`/`timeline` 的 snake_case 字段名保持原样，UI 不改）。
- 回测的 NAV 数据仍由 Node 提供（`/api/funds/:code/nav-history` 或 `/api/fund/:code/trend`），前端已有 Dexie 缓存。

用户已确认的范围：止盈/止损、一次性投入 `lump_sum`、费率与初始资金、投资日（每月几号/每周周几）。

---

## 2. 现状证据（均为实际读到的代码）

### 2.1 回测计算本身与 Python 无关

`python/cli/backtest.py:18-21` 的全部依赖：

```python
import math
import os
import sys
from datetime import datetime
```

无 numpy / pandas —— 纯算术 + 日期，共 **243 行**。输出形状（`backtest.py:225-238`）：

```
{"summary": {total_invested, final_value, total_return, return_rate, annual_return,
             max_drawdown, sharpe_ratio, investment_count, days, exit_reason, exit_date},
 "timeline": [{date, invested, shares, nav, value, return, return_rate,
               is_investment_day, status, exit_reason?}, ...]}
```

前端早已在做同量级计算（`computeRiskMetricsLocal`、4433 排名、`researchComputation.ts`），且 AGENTS.md 自己写着「业务计算已迁移前端」——**backtest 是最后一块没迁的**。

### 2.2 当前执行层是白名单式的，不适合跑生成代码

`service/src/services/pythonRunner.ts:36`：

```ts
const scriptPath = join(SCRIPT_DIR, script);
```

`SCRIPT_DIR` 固定为 `python/cli`。`spawn(PYTHON_BIN, [scriptPath], { stdio: 'pipe', timeout })` —— **继承完整 env（含代理配置）、cwd = service 工作目录、无 `-I`、无 rlimit**，venv 里装着 pandas/akshare。要跑生成代码只能落盘进 `python/cli/`（被 ruff 与 `python/cli/check_file_length.py` 当源码管）或新增 `exec()` 入口。

`pythonRunner.ts:96-98` 还有一段兜底：stdout 不是合法 JSON 时 `resolve(trimmed)`，即生成代码多 print 一行，模型会收到一坨文本。

### 2.3 提示注入是真实向量

`frontend/src/services/chatEngine/toolHandlers.ts` 的 `search_news` → `searchService.ts`（Exa/Bocha/Tavily/DDG）把**任意网页正文**送进模型上下文。与「代码执行」叠加即典型 lethal trifecta：一条被投毒的新闻页可以指使模型写一段读 `~/.ssh/id_*` / `.env` 并 POST 出去的代码，用户界面上只多出一张工具卡片（`ChatPanel.vue:89` 只渲染工具名与耗时）。

### 2.4 结果截断与工具参数缺口

- `frontend/src/services/chatEngine/toolLoop.ts:137`：`truncateJson(value, maxLen = 4000)`，`index.ts:199` 用它包住工具结果。3 年日频 timeline ≈ 700+ 条 × ~200 字符（且是 `JSON.stringify(..., null, 2)` 缩进版），模型实际只能看到 `summary` + 十几条 timeline。
- `toolContract.ts:157-163` 的 `run_backtest` 只接受 `fund_code / start_date / end_date / amount / investment_type(monthly|weekly)`；回测页的 `investmentDay / feeRate / initialAmount / takeProfitRate / stopLossRate`（`useFundBacktest.ts:99-110`）AI 一个都传不了。
- `toolHandlers.ts:180-190` 无副作用：不落库、不跳转、不出图。

### 2.5 回测页「智能推荐策略」现在必崩（顺带修掉）

`service/src/routes/backtest.routes.ts:69-104` 的 `/strategy-suggest` 只是**再跑一次 `runBacktest({investmentType:'monthly', amount:1000})`**，返回 `{summary, timeline}`；

而 `frontend/src/components/FundBacktest.vue:175-189` 读的是：

```vue
{{ strategyResult.recommended.name }} ... {{ strategyResult.recommended.summary.annual_return }}%
<div v-for="s in strategyResult.strategies" ...>
```

全仓库（含 Python）**没有任何地方产出 `recommended` / `strategies`** —— 这只是 2.2 里"Node 侧策略生成"被删掉后遗留的契约裂缝。

### 2.6 调用方清点（决定迁移后能删什么）

- `/api/backtest/fixed-investment`：仅 `frontend/src/composables/useFundBacktest.ts:152` 调用。
- `/api/backtest/strategy-suggest`：仅 `useFundBacktest.ts:30` 与 `toolHandlers.ts:191` 调用。
- `pythonRunner.runBacktest`：仅 `backtest.routes.ts` 引用。`runPython` 仍被 `marketService.ts`（`data_complete.py`）用，**必须保留**。
- docs 引用：`architecture/ai-chat.md:94`、`architecture/data-sources.md:49`、`architecture/module-data-sources.md:77`、`architecture/index.md:36,46`、`data-sources-and-runtime.md:61,75,145,150,194`。

### 2.7 前端目前没有任何动态执行设施

`grep -rn "new Worker|new Function|importScripts" frontend/src service/src` → **零命中**。`frontend/` 下**没有 `public/` 目录**，`vite.config.ts` 未覆写 `publicDir`（默认 `public/`）。Dexie 目前 4 个版本、13 张表（`db/index.ts:167-191`）。

---

## 3. 回答「前端能跑回测吗 / 前端隔离是否更自由更安全」

**能跑，而且几乎零阻力**：回测是纯函数（2.1），输入是 NAV 数组，NAV 前端已经拿得到；3 年日频 733 个点，JS 计算在微秒级，不需要 Python IPC。

**隔离上结论是「可以，但必须用对机制」**：

| 机制 | 是否是安全边界 | 说明 |
|---|---|---|
| 同源 Web Worker + 把 `fetch`/`XMLHttpRequest` 等全局置 `undefined` | ❌ | 动态 `import()` 是**语法**不是全局，无法屏蔽；Worker 默认可访问 `indexedDB`/`caches` |
| `sandbox="allow-scripts"`（**不带** `allow-same-origin`）的 iframe | ✅ 部分 | **不透明源** → 按构造拿不到本 app 的 IndexedDB / localStorage / cookie |
| 上述 iframe 文档内的 `<meta http-equiv="Content-Security-Policy">` | ✅ 强制 | 由**浏览器**实施，而不是靠我们记得屏蔽哪个 API |

可用的组合（沙箱文档自己带 CSP，不依赖服务端配置，dev / `bun run preview` / Electron 壳都成立）：

```html
<!-- frontend/public/strategy-sandbox.html -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'">
```

- `default-src 'none'` + `connect-src 'none'` → `fetch` / XHR / WebSocket / `sendBeacon` / `EventSource` 全部被断，**不可能外传数据**。
- `script-src 'unsafe-eval'` 是 `new Function(userCode)` 必需的（`'unsafe-inline'` 给页面内联 harness）。
- iframe 侧：`<iframe sandbox="allow-scripts" src="/strategy-sandbox.html">`（**不加** `allow-same-origin`）。
- 进出只走 `postMessage` 的 structuredClone（只传 NAV 数组 / 返回买入金额数组），超时直接 `iframe.remove()` 硬杀。

这比 Python 侧能做到的任何隔离都硬：Python 要真隔离得靠容器 / `bwrap`（Linux）/ `sandbox-exec`（mac）/ job object（Windows），跨平台无统一方案，且你本来就不希望策略代码有文件系统与进程能力。

**边界要写清**：前端沙箱防的是「注入 + 数据外泄 + 破坏本机」，不是「防好奇的浏览器 CVE」；生成代码仍**不可单测、不可复现**，所以必须把 `code + hash` 与结果一起落库，支持重放（见步骤 12）。

---

## 4. 决策：分两期

- **Phase 1（默认路径，覆盖绝大多数需求）**：把回测引擎迁到 TS + 声明式策略 DSL。AI 写的是**策略规格 JSON**（可校验、可单测、可复现、可缓存），由引擎解释执行。同时补齐 2.4 的参数缺口、修掉 2.5 的推荐策略、把工具输出改成「摘要 + 采样」以免被 4000 字符截断。
- **Phase 2（进阶逃生口，默认关闭）**：AI 写**策略函数**（纯函数：`(nav, state) => 本期买入金额`），在 3 节的沙箱 iframe 里跑。得任意逻辑，但不进 Node / 不进 Python / 不碰磁盘。

Phase 1 之后 Python 回测路径就没有消费方了（2.6），**建议删除**（清单见步骤 15），把 `backtest.py` 只留作 golden fixture 生成器，随后一并移除。

---

## 5. Phase 1 · 逐文件改动

### 新增

| 文件 | 内容 |
|---|---|
| `frontend/src/services/backtest/backtestEngine.ts` | 纯函数引擎：`runBacktest(navHistory, spec) => {summary, timeline}`，输出**字段名与 Python 完全一致**（`total_invested`…snake_case，见 2.1），UI 零改动 |
| `frontend/src/services/backtest/pyCompat.ts` | Python 语义兼容层：`pyRound(v, d)`（银行家舍入）+ `isoWeekKey(dateStr)`（ISO-8601 年+周，对齐 `dt.isocalendar()[:2]`） |
| `frontend/src/services/backtest/strategySpec.ts` | TypeBox 策略规格 schema + 校验 + `describeSpec()`（给人/模型看的可读摘要） |
| `frontend/src/services/backtest/strategyCompare.ts` | 多策略对比（月度/周度/一次性/价值平均/均线偏离）→ `{recommended:{key,name,description,reason,summary}, strategies:[...]}`，**精确匹配 `FundBacktest.vue:174-192` 现有契约** |
| `frontend/src/services/backtest/timelineSample.ts` | 工具输出压缩：`summary` + 采样点（每个扣款日 + 按月末 + 止盈止损日）+ `timeline_count` + `note`，稳定 < 4000 字符 |
| `frontend/public/strategy-sandbox.html` | Phase 2 沙箱文档（第 3 节那段 CSP） |
| `frontend/src/services/backtest/strategySandbox.ts` | Phase 2：iframe 生命周期、postMessage 协议、超时硬杀、错误归一化 |
| `frontend/src/services/backtest/__fixtures__/*.json` | golden fixtures（由现有 Python 生成，见步骤 1） |
| `frontend/src/__tests__/services/backtestEngine.test.ts` | 引擎 golden 测试 + `pyRound` / `isoWeekKey` 边界测试 |
| `python/tests/gen_backtest_fixtures.py` | 一次性 fixture 生成器（对现有 `backtest.py` 跑参数矩阵，dump JSON） |

### 修改

| 文件 | 改动 |
|---|---|
| `frontend/src/composables/useFundBacktest.ts:152` | `backtestAPI.fixedInvestment(...)` → 本地 `runBacktest()`；`suggestStrategy()`（:30）→ 本地 `compareStrategies()` |
| `frontend/src/composables/useFundBacktest.ts:99-110` | `params` 增加 `day` 语义（现只有 `investmentDay` 字段但**从未透传**给后端，见 `:144-153` 的 payload），并映射到 `BacktestSpec` |
| `frontend/src/services/api.ts:103-105` | 删除 `backtestAPI`（无调用方后） |
| `frontend/src/services/chatEngine/toolContract.ts:153-163` | `run_backtest` 参数扩为：`fund_code, start_date, end_date, amount?, period?(monthly\|weekly\|lump_sum), day?, fee_rate?, initial_amount?, take_profit_rate?, stop_loss_rate?, rule?`；新增 `compare_backtest_strategies`（一次拿多策略对比表），返回**采样摘要**而非全量 timeline |
| `frontend/src/services/chatEngine/toolHandlers.ts:180-192` | `run_backtest` 改走本地引擎（先取 NAV）；`suggest_strategy` 改调 `compareStrategies()`；两者输出经 `timelineSample.ts` 压缩 |
| `frontend/src/services/chatEngine/skills.ts:269` | `investment_strategy.toolNames` 加 `compare_backtest_strategies` |
| `frontend/src/db/index.ts` | `version(5)` 加 `backtestRuns: '++id, fundCode, createdAt, specHash'`（Phase 2 存 `code`+`hash`；Phase 1 先存 spec+结果，供"上次回测"复用） |
| `frontend/src/components/FundBacktest.vue` | 仅当推荐策略卡片补空态（若 `compareStrategies` 失败）；主流程不改 |
| `service/src/routes/backtest.routes.ts` | 删除（步骤 15）或整体标 deprecated |
| `service/src/services/pythonRunner.ts:120-127` | 删除 `runBacktest`（保留 `runPython`，`marketService` 还在用） |
| `python/cli/backtest.py`、`python/tests/test_backtest.py` | 删除（步骤 15，golden 迁完后） |
| docs（6 处，见 2.6） | 更新为「回测计算在前端 `services/backtest/`」；`data-sources-and-runtime.md:145-150` 的 `_run_backtest` 小节改述 |

### 策略规格 DSL（语义必须钉死，否则实现有歧义）

```ts
interface BacktestSpec {
  period: 'monthly' | 'weekly' | 'lump_sum'
  day?: number             // monthly: 1-28；weekly: 0-4（0=周一）
  amount: number
  initialAmount?: number   // 默认 0
  feeRate?: number         // 默认 0.0015
  takeProfitRate?: number | null
  stopLossRate?: number | null
  rule?:
    | { type: 'fixed' }                                    // 默认，等额定投
    | { type: 'value_averaging'; targetGrowth: number }     // 目标市值 = 累计投入 × (1+g)^期数；本期买入 = max(0, 目标 − 当前市值)
    | { type: 'ma_deviation'; window: number; factor: number } // MA = 前 window 个交易日 NAV 均值（不含当日，避免未来函数）；
                                                               // 买入额 = amount × clamp(MA/nav, 1−factor, 1+factor)
}
```

扣款日规则（现 Python 是"每周期第一个交易日"）：

- `day` 缺省 → 该周期第一个交易日（与现行为一致，保证 golden 不红）。
- 指定 `day` → 该周期内第一个「日期 ≥ day」的交易日；若该周期内不存在，则取该周期最后一个交易日。

### 已知的三处 Python 语义坑（必须处理，否则 golden 测试必红）

1. **`round()` 是银行家舍入**：`round(0.5)==0`、`round(2.5)==2`，且 `round(2.675, 2)==2.67`（浮点表示）。JS 的 `Math.round`/`toFixed` 都不是这个语义 → 必须自实现 `pyRound` 并用 tie 用例单测（`0.5 / 1.5 / 2.5 / 2.675 / 1.005 / 负值`）。
2. **周键是 ISO 周**：Python `dt.isocalendar()[1]` 是 ISO-8601 周（周一为周首，含首个周四的那周为第 1 周），跨年周（12-29 ~ 01-04）会落到上一/下一年的第 1 周；`(year, week)` 里的 year 是 **ISO 年**。JS `Date` 没有 ISO 周 → 手写，并在 fixtures 里显式放跨年区间。
3. **年化公式**：`(1 + total_return_rate)^(1/years) - 1`，`years = days/365.25`，`total_return_rate = return_rate/100`；夏普用 `(mean − 0.02/252)/std × √252`，日收益序列基于 `timeline[i-1].value > 0`。逐字移植，别"优化"。

---

## 6. Phase 2 · 沙箱自定义策略（默认关闭）

- 开关：`useAppSettings` 增加 `advancedCustomStrategy: boolean`（默认 `false`），前端 localStorage；**开启时在聊天里显式提示"自定义策略会执行 AI 生成的代码（沙箱内、无网络、无本地存储）"**。
- 工具：`run_custom_backtest(fund_code, start_date, end_date, code, code_language='js')`，`code` 必须是纯函数形式：

  ```js
  // 入参: nav (number[]), dates (string[]), state {invested, shares, value}
  // 出参: 本期买入金额（元），0 表示不投
  function buy(nav, dates, i, state) { ... }
  ```

- 执行：`strategySandbox.ts` 建 iframe → `new Function(code + '; return buy')` → 纯 JS 逐日循环产出 timeline → 与 Phase 1 的 `summary` 计算共用同一个 `summarize()`。
- 结果与 `code`、`specHash` 一起写 `backtestRuns`，UI/工具可"重放"（这是对"不可复现"的补偿）。
- 失败处理：语法错误 / 抛错 / 超时（1500ms）→ 归一化成 `{ok:false,error:{code:'SANDBOX_ERROR',message}}` 回喂模型自纠，最多 2 次（与 `toolLoop` 现有纠错风格一致）。

---

## 7. 步骤（每步独立可验证）

| # | 步骤 | 涉及文件 | 验证 |
|---|---|---|---|
| 1 | 写 fixture 生成器，用**现有 Python** 跑参数矩阵（monthly/weekly/lump_sum × 有无 initialAmount × 有无止盈止损 × 有无 feeRate × 跨年周 × 空/单点 NAV），dump 到 `__fixtures__/` | `python/tests/gen_backtest_fixtures.py`、`frontend/src/services/backtest/__fixtures__/` | 生成的 JSON 与 `python/tests/test_backtest.py` 现有断言一致 |
| 2 | 实现 `pyRound` + `isoWeekKey` 并先测它们 | `frontend/src/services/backtest/pyCompat.ts` + 测试 | tie 用例 vs Python 实际输出（fixtures 内含 tie 值） |
| 3 | 移植引擎（先只支持 `period` + `amount` + `initialAmount` + `feeRate` + 止盈止损） | `backtestEngine.ts` | `bun run test`：golden deep-equal（浮点 1e-9） |
| 4 | 加 `day` 语义（含"无 ≥day 则取周期末交易日"） | `backtestEngine.ts`（+ 若保留 Python 需同步，故并入步骤 15） | 新增 fixture：day=15/28/31、day 落在周末、day 落在月末 |
| 5 | 加 DSL rule：`value_averaging` / `ma_deviation` | `strategySpec.ts`、`backtestEngine.ts` | 手算 3 期小样本 + 边界（window > 数据长度） |
| 6 | 实现 `compareStrategies()` 产出 `recommended`/`strategies` | `strategyCompare.ts` | 契约测试：字段与 `FundBacktest.vue:174-192` 逐一对应 |
| 7 | 切换回测页到本地引擎 | `useFundBacktest.ts:30,152`（`api.ts:103-105` 暂留） | 手动：同参数下页面数字与改前一致；「智能推荐策略」卡片正常渲染 |
| 8 | 实现 `timelineSample()` | `timelineSample.ts` | 断言输出 < 3800 字符（3 年日频输入） |
| 9 | 扩 `run_backtest` 工具 + 新增 `compare_backtest_strategies` + handler 走本地引擎 | `toolContract.ts`、`toolHandlers.ts`、`skills.ts:269` | `bun run test`（现有 `toolContract.test.ts:19,39-42,78-85` 需同步更新）；聊天里问"帮我 20% 止盈回测一下"能正确传参并拿到摘要 |
| 10 | Dexie `version(5)` + `backtestRuns` 落库（含 spec/specHash） | `db/index.ts`、`useFundBacktest.ts` | 刷新页面后"上次回测"可复用；Dexie 升级不丢既有表 |
| 11 | Phase 2：`strategy-sandbox.html` + `strategySandbox.ts` + `run_custom_backtest` 工具 + 开关 | 见 §5/§6 | 在沙箱内尝试 `fetch(...)` / `indexedDB.open` 必须失败（手动验证 + 留一条测试）；死循环 strategy 被 1500ms 硬杀 |
| 12 | Phase 2：重放（存 `code`，能从 `backtestRuns` 重跑并比对 `summary`） | `strategySandbox.ts`、`db/index.ts` | 重放结果与首次逐字段一致 |
| 13 | 本地全量校验 | — | `cd frontend && bun run lint && bunx vue-tsc --noEmit && bun run test && bun run build`（~500 行/文件上限，`backtestEngine.ts` 超了就按 `engine/` 拆分） |
| 14 | 文档同步 | `docs/architecture/{ai-chat,data-sources,module-data-sources,index}.md`、`docs/data-sources-and-runtime.md`、`AGENTS.md`（Monorepo hot spots + Data flow 的 backtest 行） | `cd docs && bun run build` 通过 |
| 15 | 清理 Python 回测路径 | 删 `service/src/routes/backtest.routes.ts`、`pythonRunner.ts:120-127`、`python/cli/backtest.py`、`python/tests/test_backtest.py`；`app.ts` 摘掉路由注册；`api.ts:103-105` | `cd service && bun run lint && bun run typecheck && bun run test`；`grep -rn "backtest.API\|/api/backtest" frontend/src service/src` 必须零命中 |

> 若你希望保留 Python 回测作为降级路径，步骤 15 改为「只标 deprecated + docs 注明」，但 fixture 同步（步骤 4/5 的新语义）要在 Python 侧再实现一遍 —— 这正是不建议保留的原因。

---

## 8. 风险与未知

1. **舍入与浮点表示**：`pyRound` 写得"看起来对"但和 Python 差 1 个分位是很容易的事 → 用 fixtures 兜住，不要在实现里用 `toFixed` 图省事。
2. **`day` 语义是新行为**：现有 Python 是"周期内第一个交易日"；引入"≥day"后，同参数数字会变。步骤 4 的 fixture 必须显式覆盖，且要在 UI 上把默认值设为"未指定"以保持旧行为。
3. **`meta` CSP 的浏览器差异**：Chrome/Firefox 对 `meta` CSP 支持良好，Safari 对 `frame-ancestors` 之外指令的支持一致，但**必须真机试一次**（沙箱 iframe 与 Electron 壳两种宿主）。若 meta CSP 在某宿主不生效，退路是把 `strategy-sandbox.html` 的响应头加在 `vite.config.ts` 的 `server.headers` 与 preview/静态托管配置上（dev 与 prod 都要覆盖，工作量翻倍）。
4. **iframe 与父页面 CSP 叠加**：本方案用独立静态文件（非 `srcdoc`）正是为了避免继承父文档 CSP 导致的意外拦截。
5. **生成代码不可单测**：只能靠"落库 + 重放 + hash"补偿；`code` 里包含时间/随机数时重放也会漂 —— 在工具描述里明确禁止 `Date.now()` / `Math.random()`。
6. **`day` 与节假日**：NAV 只有交易日，`day=31` 在 2 月必然回退，回退到"周期最后一个交易日"可能距 31 号很远 —— 语义已钉死，但要在工具描述里告诉模型（避免它把"每月 31 号"当成真实成交日）。
7. **未知**：`compareStrategies` 的 `recommended.reason` 生成方式待定 —— 建议先用确定性规则（按夏普排序 + 模板文案），AI 只负责在聊天里解释；若要 AI 生成 reason，则不能再算"确定性"。
8. **未知**：`backtestRuns` 表是否需要按 fundCode 限流清理（3 年 timeline 单条 ~100KB，多跑几次会让 IndexedDB 明显变大）—— 建议只存 spec + summary + 采样 timeline，全量 timeline 不入库。

---

## 9. 明确不做

- 不做「AI 生成 Python 代码 + `exec()` 本机执行」（第 2 节的三重理由：无沙箱、注入面、不可复现/不可单测）。
- 不改动 `pythonRunner.runPython` 的现有白名单机制与 `data_complete.py` 路径。
- 不引入 numpy/pandas 到前端；引擎只用纯 JS 算术。
- 不动 `InvestmentStrategyView` / 策略记忆（`strategyMemory.ts`）的现有语义。

---

## 10. 执行记录（2026-09-29）

### 已完成（Phase 1，步骤 1–14）

| 步骤 | 产出 |
|------|------|
| 1 | `python/tests/gen_backtest_fixtures.py` → `frontend/src/services/backtest/__fixtures__/{engine,pyround,isoweek}.json`（12 个回测用例 + 104 个 round oracle + 28 个 ISO 周 oracle） |
| 2 | `services/backtest/pyCompat.ts`（`pyRound` 银行家舍入 + `pythonWeekKey`/`pythonMonthKey`/`weekdayIndex`/`dayStamp`） |
| 3–5 | `services/backtest/backtestEngine.ts` + `strategyRules.ts`（引擎 + `day` 语义 + 定投方式） |
| 6 | `services/backtest/strategyCompare.ts`（`recommended`/`strategies` 契约，夏普排序） |
| 7 | `composables/useFundBacktest.ts` 改用本地引擎；UI 增加定投方式选择、上次回测提示 |
| 8 | `services/backtest/timelineSample.ts`（工具输出抽样 < 4 KB） |
| 9 | `toolContract.ts`（`run_backtest` 参数扩展 + 新增 `compare_backtest_strategies`）、`toolHandlers.ts`、`skills.ts:222,269`、`analysisScenarios.ts` |
| 10 | `db/index.ts` `version(5)` + `db/backtestRuns.ts`（spec + summary + 抽样点，每基金保留 10 次） |
| 11–12 | **未做（Phase 2）** |
| 13 | 前端 lint / `vue-tsc` / 294 tests / build 全绿；service 96 tests 全绿；docs build 通过；ruff + file-length + python unittest 通过 |
| 14 | 文档：`docs/architecture/backtest-engine.md`（新增）、`ai-chat.md`、`data-sources.md`、`module-data-sources.md`、`index.md`、`data-sources-and-runtime.md`、`AGENTS.md` |

### 验证结果

- **黄金 fixtures**：12/12 用例逐值一致（`backtestEngine.test.ts`，含退回、止盈止损、一次性、跨年周、银行家舍入 tie、单点、空数据）。
- **差分测试**（`python/tests/differential_backtest.py`，随机净值序列/乱序输入/重复日期）：300 例与 200 例两个种子下，**移植域内 100% 逐值一致**（0 mismatch）；域外仅在预期处不同（`daily` 与 `amount=0` 的 `is_investment_day`）。
- **工具输出截断回归**：所有 engine fixture 经 `truncateJson({ok:true,data})` 后均不含 `truncated`（此前 3 年日频为 148 KB ≫ 4000 字符）。

### 与计划的偏差（均为有意）

1. **工具参数名保留 `investment_type`**（计划写的是 `period`）：避免重命名带来的模型/测试连锁改动；内部映射到 `BacktestSpec.period`。
2. **`investment_count` 语义保持 Python 口径**（计划原写「改为实际买入次数」）：改为在工具输出新增 `buy_count`，因为 12 个 golden 用例中有 2 个（止盈/止损清仓）依赖「计划扣款次数」语义，改语义会让 UI 数字变化。
3. **`day` 缺省值不写入 fixtures**：`day` 是新行为，Python 无 oracle，因此在 TS 侧用手工样本单测（含「2 月无 ≥15 号交易日 → 退化到月末」与跨周回退）。
4. 顺带修复的三个既有缺陷（计划外但同源）：手续费 100×、止盈率 400、每日定投恒为 0；详见 `docs/architecture/backtest-engine.md`。

### 发现的既有 bug（已修）

- **周键 = `(日历年, ISO 周号)`**：跨年那周会被切成两桶、扣款两次。已两侧同步改为 ISO 年周，
  fixture `weekly_cross_year` 重生成并锁住新行为（详见 `docs/architecture/backtest-engine.md`）。

### 真浏览器 + 真后端验证（2026-09-29，`bun dev` 栈）

跑通了 `http://localhost:8517/#/backtest/110022` 全流程：

| 项 | 结果 |
|----|------|
| 网络 | 只有 4 个 API 调用，`/api/backtest` **零调用**；NAV 走真实 `/api/funds/110022/nav-history` |
| 结果 | 总投入 36000 / 最终 29138.34 / -19.06% / 回撤 -13.49% / 夏普 1.78 / 36 次 |
| 手续费 | 0% vs 0.15% 只差 **43.78 元**（≈36000×0.15%）→ 100× bug 确实已修 |
| 止盈率 20% | 正常跑完（原先 Zod `max(1)` 404/400） |
| 每日定投 | **727 次 / 727000 元 / -18.43%**（原先静默 0 次） |
| 推荐卡片 | 渲染正常，区间写明 2023-09-30 ~ 2026-09-29，最大回撤显示 -11.73% |
| Dexie | 「上次回测（09/29 20:44）：每月 1 号投入 1000 元，等额定投」+ 载入参数 均生效 |

### 浏览器验证时又发现并修掉的 3 个问题（写代码时看不出来）

1. **策略对比用了全历史**：`suggestStrategy` 直接拿 `loadNav()` 的全量 NAV 去比，与页面的
   3 年窗口不一致（实测每周定投“总投入 837000”）。已加 `clipNavHistory()` 并与页面同区间，
   `reason` 里写明区间。
2. **推荐卡片双负号** `--49.91%`：模板写了 `-{{ max_drawdown }}`，而该值本身已是负数
   （卡片以前从未成功渲染过，所以没人发现）。已改为 `{{ }}`，标签「总收益」→「总收益率」。
3. **`BInputNumber` 只在 blur 时提交**（`onInput` 仅改 `tempValue`）：以后用脚本驱 UI 验证
   数字时要先 `focus` → 改值 → 派发 `input` + `blur`，否则参数根本没变（会误判“没生效”）。

### 待决定（步骤 15）—— 已完成

Python 回测路径已按用户决定**删除**（2026-09-29）：`service/src/routes/backtest.routes.ts`、
`pythonRunner.runBacktest`（含 `DEFAULT_TIMEOUT_BACKTEST`）、`python/cli/backtest.py`、
`python/tests/test_backtest.py`，以及 `app.ts` 的路由注册。

迁移期的两个工具（`gen_backtest_fixtures.py`、`differential_backtest.py`）也一并删除（它们依赖
已删的 Python 实现）；**黄金 fixtures 本身保留并冻结**在
`frontend/src/services/backtest/__fixtures__/`（附 README 说明来历）。

### 跨年周重复扣款 —— 已修

两侧同步改为真正的 ISO 年周（Python `dt.isocalendar()[:2]`；前端 `pyCompat.isoWeekKey`），
`weekly_cross_year` fixture 重生成后从 **4 次投入变为 3 次**，差分测试复跑 300 + 250 例仍
0 mismatch。
