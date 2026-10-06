# 统一回测工作台（代码优先）

## 1. 目标

移除「定投回测」(`/backtest`) 与「组合回测」(`/backtest-portfolio`) 两个页面，
合并为一个**代码优先**的回测工作台，单路由 `/backtest`：

- **左**：已保存的回测方案列表（`strategyScripts`，每条 = 名称 + 模式 + 代码 + 完整配置），可新建/编辑/复制/删除/回测。
- **右**：复用 `ChatPanel`（新 channel `backtest`，`force-skill="investment_strategy"`）。
- **下**：工作台，在「编辑器」与「回测结果」之间切换；编辑器 = CodeMirror 6 + 配置头 + 运行按钮；结果 = 汇总卡片 + ECharts + 明细表。
- **LLM**：保留 `run_strategy_code`；新增按名称运行已保存方案、列出、保存三个能力；页面可从聊天里把 AI 写的代码拉进编辑器。

### 假设（请重点确认）

1. 旧的两个**表单 UI**（预设定投规则、组合权重表单按钮「智能推荐策略」）随页面一起删除。
   它们背后的引擎（`backtestEngine.ts` / `portfolioBacktest.ts` / `strategyCompare.ts`）**保留不动**，
   LLM 工具 `run_backtest` / `run_portfolio_backtest` / `compare_backtest_strategies` 继续可用；
   代码模式下的「每月定投 / 价值平均 / 均线偏离 / 再平衡」通过**代码模板**提供。
   结论：**页面不再提供预设规则入口**，只能写代码（或让 AI 写）。这是用户所选布局的直接推论。
2. 配置粒度按用户所选：`single` = 基金代码 + 起止日期 + 初始资金 + 手续费率（+ 可选止盈/止损率）；
   `portfolio` = 资产列表(权重/现金年化) + 起止日期 + 初始资金 + 手续费率。
   **不含** `amount`/`period`/`rule`/`contribution`/`rebalance`——这些在代码模式里被引擎绕过（见 §3.4 已核实）。
3. 代码用 CodeMirror 6，新增依赖 `codemirror` + `@codemirror/lang-javascript`。
4. 旧的运行历史表 `backtestRuns` + `specHash` 被新的 `strategyScripts`（含 `lastSummary`）取代，**删除**（会丢弃历史运行记录）。

## 2. 现状（已读代码核实）

| 位置 | 现状 |
|------|------|
| `router/index.ts:45-60` | `/backtest` + `/backtest/:code` → `BacktestView.vue`；`/backtest-portfolio` → `PortfolioBacktestView.vue` |
| `components/FundBacktest.vue` / `PortfolioBacktest.vue` | 两个表单页；`FundBacktest.css` 522 行、`PortfolioBacktest.css` 314 行 |
| `composables/useFundBacktest.ts` / `usePortfolioBacktest.ts` | 各自持有 ECharts 实例、参数、结果；`useFundBacktest` 还写 `db/backtestRuns` |
| `services/backtest/strategySandbox.ts` | 纯逻辑：`compileStrategyFunction` / `makeDecision`（单基金）/ `makePortfolioDecision`（组合）/ `handleRun*Request` |
| `services/backtest/strategyWorker.ts` | `kind:'single'\|'portfolio'` 分派；Worker 内遮蔽 `fetch`/`indexedDB` 等 |
| `services/backtest/runStrategyCode.ts` | `runStrategyCode` / `runPortfolioStrategyCode` → **返回抽样结果**（给 LLM 的 4KB 预算），不返回完整 timeline |
| `chatEngine/toolContract.ts:185` | `run_strategy_code(fund_code 或 assets, code, …)` 已存在；`toolContract.ts` 484 行 |
| `chatEngine/toolHandlers.ts:339` | `run_strategy_code` handler；`toolHandlers.ts` 487 行 |
| `chatEngine/toolApproval.ts:21` | `CONFIRM_REQUIRED = new Set(['run_strategy_code'])` |
| `db/backtestRuns.ts` | Dexie `backtestRuns`（v5），`useFundBacktest` 是唯一调用方；`specHash` 只被它 + 测试使用 |
| `App.vue:18-19`、`MobileDrawer.vue:48-49` | 两个导航项 |

### 2.1 已核实的关键引擎语义（决定配置字段）

`backtestEngine.ts:98`：**提供 `hooks.decide` 时绕过 `pickInvestmentDates`/`ruleBuyAmount`**，但
`initialAmount`(L91-93)、`feeRate`、`takeProfitRate`/`stopLossRate`(L144-149) 仍然生效。
`portfolioBacktest.ts` 同理：有 `hooks.decide` 时绕过 `contribution`/`rebalance`，仍用 `assets`/`initialAmount`/`feeRate`。

→ 所以代码模式的配置头只需上述字段；预设规则/注水/再平衡参数在代码模式无意义。

## 3. 目标设计

### 3.1 页面布局

```
/backtest
┌───────────────┬──────────────────────────────┐
│ 方案列表       │  ChatPanel (channel=backtest) │
│ [新建]        │  force-skill=investment_strategy│
│ · 均线加仓 ▸  │                               │
│ · 四资产再平衡 │                               │
├───────────────┴──────────────────────────────┤
│ [编辑] [结果]                                  │
│ 配置头（模式 / 标的 / 日期 / 金额 / 费率）      │
│ CodeMirror 编辑器                              │
│ [运行] [保存] [另存为] [模板▾]                  │
│ ── 或 ──                                       │
│ 汇总卡片 + ECharts + 明细表                     │
└──────────────────────────────────────────────┘
```

### 3.2 数据模型（Dexie v6）

`frontend/src/db/index.ts` 新增 `strategyScripts`，并在同一版本删除旧表：

```ts
this.version(6).stores({
  strategyScripts: '++id, name, mode, updatedAt',
  backtestRuns: null,           // 旧运行历史，被方案记录取代
})
```

```ts
export type StrategyScriptConfig =
  | { mode: 'single'; fundCode: string; startDate: string; endDate: string;
      initialAmount: number; feeRate: number;
      takeProfitRate?: number | null; stopLossRate?: number | null }
  | { mode: 'portfolio'; assets: PortfolioAsset[]; startDate: string; endDate: string;
      initialAmount: number; feeRate: number }

export interface StrategyScriptRecord {
  id?: number
  name: string
  mode: 'single' | 'portfolio'   // 冗余字段，供索引/列表徽章
  code: string
  config: StrategyScriptConfig   // 非索引
  source: 'manual' | 'ai'
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  lastSummary?: BacktestSummary | PortfolioSummary
}
```

单位约定沿用工具契约：日期 `YYYY-MM-DD`，`feeRate`/`takeProfitRate`/`stopLossRate` 为**小数**，
权重为百分数（引擎按总和归一化）。UI 输入百分数 → composable 里 `/100`。

### 3.3 LLM 工具（29 → 31）

| 工具 | 变化 |
|------|------|
| `run_strategy_code` | 新增可选 `script_name`：给了就按名称从 Dexie 载入已保存方案（代码+配置），忽略 `code`/`fund_code`/`assets`；重名时返回候选列表让模型重选。仍走 `CONFIRM_REQUIRED`（执行是信任边界）。 |
| `list_strategy_scripts` | 新增，无参；返回 `[{id, name, mode, target, updatedAt, lastRunAt, last_run}]` 紧凑列表，供模型点名运行。 |
| `save_strategy_script` | 新增，必填 `name` + `code`；其余参数与 `run_strategy_code` 同构（`fund_code` 或 `assets`、日期、金额、费率）。写入 `strategyScripts`（`source:'ai'`）。**不进确认闸门**（只写本地数据、不执行代码；执行仍由 `run_strategy_code` 的卡片把关）。 |

`save_strategy_script` 的 mode 推导：`assets` 非空且 ≥2 → `portfolio`，否则要求 `fund_code` → `single`。
复用 `toolArgs.ts` 的 `resolveDateRange` / `portfolioSpecFromToolArgs`。

**页面接收 LLM 代码**：`useBacktestWorkspace` 监听 `chatStore.activeToolCalls` + `messages[].toolCalls`
中最近一次 `run_strategy_code` 的 `params`，在工作台顶部显示「AI 生成了策略代码 → 载入编辑器」按钮，
点击后把 `code` + `fund_code`/`assets` + 日期填进编辑器与配置头。不改 `ChatPanel`/`CodeApprovalCard`（共享组件）。

### 3.4 完整结果 vs 抽样结果（关键）

聊天工具要抽样（`sampleBacktest`/`samplePortfolioBacktest`，<4KB），但**页面要完整 timeline 画图**。
当前 `runStrategyCode.ts` 只有抽样出口，因此新增两个原始出口（复用同一个 Worker 路径）：

```ts
export async function runStrategyCodeRaw(request, options): Promise<BacktestResult | { error: string }>
export async function runPortfolioStrategyCodeRaw(request, options): Promise<PortfolioBacktestResult | { error: string }>
```

`services/backtest/scriptRun.ts` 封装：取 NAV（`fetchNavHistory` + `clipNavHistory`，单基金）或
各腿 NAV（`navByCode`，组合）→ 调 raw 出口 → 返回完整结果；页面与「按名称运行」的 LLM 工具共用它，
LLM 侧再包一层抽样。

## 4. 有序步骤

> 每步都可独立验证；`bun` 是包管理器（见 AGENTS.md）。

### 第 1 步 — 依赖与数据层
1. `frontend/package.json`：加 `codemirror`、`@codemirror/lang-javascript`（`cd frontend && bun install`）。
2. 新建 `frontend/src/db/strategyScripts.ts`：类型 + CRUD
   (`listStrategyScripts` / `getStrategyScript` / `findStrategyScriptByName` / `createStrategyScript` /
   `updateStrategyScript` / `deleteStrategyScript` / `recordScriptRun`)。
3. `frontend/src/db/index.ts`：加 `strategyScripts` 表 + Dexie `version(6)`（并 `backtestRuns: null`），
   删除 `BacktestRunRecord` 接口与 `backtestRuns!: Table<...>`。
4. 删除 `frontend/src/db/backtestRuns.ts`、`frontend/src/services/backtest/specHash.ts`、
   `frontend/src/__tests__/services/specHash.test.ts`。
   （`sampleTimeline`/`BacktestCheckpoint`/`describeSpec` 继续保留：`portfolioSample.ts`、`sampleBacktest` 仍在用。）
   - 验证：`bunx vue-tsc --noEmit`。

### 第 2 步 — 原始结果出口 + 统一运行服务
1. `frontend/src/services/backtest/runStrategyCode.ts`：新增 `runStrategyCodeRaw` / `runPortfolioStrategyCodeRaw`
   （把 `executeInWorker` 的调用结果原样返回，不抽样）。
2. 新建 `frontend/src/services/backtest/scriptRun.ts`：
   - `runScript(code, config): Promise<ScriptRunOutcome>`（`{mode:'single',result} | {mode:'portfolio',result} | {error}`）。
   - `runSavedScriptSampled(script)`（供 LLM 按名称运行，返回抽样 payload）。
   - `configFromToolArgs(args)`（供 `save_strategy_script`）。
3. 新建 `frontend/src/services/backtest/strategyTemplates.ts`：单基金/组合各 2~3 个起步片段
   （月定投近似、均线偏离加码、止盈清仓；组合阈值再平衡、逢跌加仓）。
   - 验证：新增纯函数单测（`scriptRun` 的 config 映射、模板非空），`bun run test`。

### 第 3 步 — 拆分工具契约（避免 500 行 lint 上限）
1. 新建 `frontend/src/services/chatEngine/toolDefs.ts`：把 `TOOL_DEFS`（现 `toolContract.ts:35-364`）与
   `ToolSpec` 接口、`strEnum/str/optStr/int/num` 辅助函数整体搬过去，导出 `TOOL_DEFS`、`ToolSpec`。
2. `toolContract.ts` 仅保留 `TOOL_REGISTRY`/`listToolSpecs`/`getToolSpec`/`toolLabel`/`toolSpecToOpenAI`/
   `toolSpecsToXml`/`escapeXml`/`TOOL_CALL_RULES`/`validateToolCall`，从 `toolDefs.ts` 导入 `TOOL_DEFS`。
   **保持对外导出名不变**（外部只从 `toolContract` 导入）。
3. 在 `toolDefs.ts` 里改 `run_strategy_code`（加 `script_name`）+ 加 `list_strategy_scripts`、`save_strategy_script`。
   - 验证：`toolContract.test.ts` 的 `EXPECTED_TOOLS` 29 → 31 并补断言；`bun run test`。

### 第 4 步 — 拆分并扩展工具 handler
1. 新建 `frontend/src/services/chatEngine/toolHandlersBacktest.ts`：把 `toolHandlers.ts` 里的
   `run_backtest` / `run_portfolio_backtest` / `run_strategy_code` / `suggest_strategy` /
   `compare_backtest_strategies` 及其辅助函数（`runPortfolioStrategyTool` / `compareStrategiesTool`）搬过来；
   实现新工具 `list_strategy_scripts`（读 `strategyScripts`）与 `save_strategy_script`（写库）。
   `run_strategy_code` 增加 `script_name` 分支（载入 → `runSavedScriptSampled`）。
2. `toolHandlers.ts`：`const toolHandlers = { ...backtestToolHandlers, <其余> }`，删除已搬走的条目与不再使用的 import。
   - 验证：`runStrategyCodeTool.test.ts` 扩展；`bun run test`。

### 第 5 步 — 技能/通道接线
1. `frontend/src/services/chatEngine/skills.ts`：`investment_strategy` 的 `toolNames` 加
   `list_strategy_scripts`；`GENERAL_TOOL_NAMES` 加 `list_strategy_scripts`（`save_strategy_script` 也加，通才助手可用）。
2. `frontend/src/services/analysis/analysisScenarios.ts`（FULL_TOOL_NAMES）：加 `list_strategy_scripts`
   （headless 场景不落库，不加 save）。
3. 页面用 `channel="backtest"` + `force-skill="investment_strategy"`；`chatApi` 的 channel 过滤是自由字符串，
   无需改后端（会话在 Dexie）。
   - 验证：`analysisScenarios.test.ts`、`chatEngine.test.ts`、`toolContract.test.ts` 全绿。

### 第 6 步 — 前端组件
新建 `frontend/src/components/backtest/`：
1. `CodeEditor.vue`：CodeMirror 6（`basicSetup` + `javascript()`）薄封装，`v-model`，主题色走 CSS 变量。
2. `BacktestConfigForm.vue`：按 `mode` 渲染字段（single：基金选择/日期/金额/费率/止盈/止损；portfolio：资产行 + 权重 + 现金年化 + 日期/金额/费率）。数值百分数 ⇄ 小数转换在此。
3. `BacktestScriptList.vue`：方案列表（徽章/目标/上次运行），新建/复制/删除/选中。
4. `BacktestChart.vue`：ECharts；single 有「市值 / 收益率」tab，portfolio 画「累计投入 / 组合市值」。把 `useFundBacktest`/`usePortfolioBacktest` 里的图表 option 逻辑收拢到这里。
5. `BacktestResultPanel.vue`：汇总卡片 + `<BacktestChart>` + 明细表（single 分页；portfolio 资产表 + `effective_start/end` + `excluded`/`note`）。
6. `BacktestWorkbench.vue`：配置头 + 编辑器 + 运行/保存/另存为/模板 + 「编辑/结果」切换 + LLM 代码横幅。
7. `frontend/src/composables/useBacktestWorkspace.ts`：状态与编排（当前方案 CRUD、运行 `scriptRun.runScript`、保存、`recordScriptRun`、chat→编辑器桥接、`:code` 深链预填）。

### 第 7 步 — 页面与导航
1. 重写 `frontend/src/views/BacktestView.vue`：三块布局（左列表 / 右 ChatPanel / 下工作台），
   样式放 `frontend/src/views/BacktestView.css`。
2. `frontend/src/router/index.ts`：删 `PortfolioBacktestView` import 与 `/backtest-portfolio` 路由；
   保留 `/backtest` 与 `/backtest/:code`（深链 → 新建/选中 single 草稿并预填 `fundCode`）。
3. `frontend/src/App.vue`：两个按钮并一个「回测」；`ChatBubble` 在 `strategy` 与 `backtest` 路由都隐藏
   （避免与页内聊天重复）。
4. `frontend/src/components/MobileDrawer.vue`：两个入口并一个「回测」。

### 第 8 步 — 删除旧实现
- 删 `frontend/src/views/PortfolioBacktestView.vue`
- 删 `frontend/src/components/FundBacktest.vue` + `FundBacktest.css`
- 删 `frontend/src/components/PortfolioBacktest.vue` + `PortfolioBacktest.css`
- 删 `frontend/src/composables/useFundBacktest.ts` + `usePortfolioBacktest.ts`
- 验证：`bun run lint && bunx vue-tsc --noEmit && bun run test && bun run build`（全绿）。

### 第 9 步 — 文档
1. `docs/architecture/backtest-engine.md`：标题改为「回测引擎（前端）」；更新页面引用
   （`FundBacktest.vue`/`PortfolioBacktest.vue` → 新工作台）、持久化节（`backtestRuns` → `strategyScripts`）、
   `run_strategy_code` 的 `script_name` 与两个新工具。
2. `docs/architecture/ai-chat.md`：`29 个工具` → `31 个`；工具表加 `list_strategy_scripts` / `save_strategy_script`。
3. `docs/.vitepress/config.ts`：侧边栏文字「定投回测引擎（前端）」→「回测引擎（前端）」。
4. `AGENTS.md`：更新 monorepo hot spots（两个页面 → 一个工作台、`db/strategyScripts.ts`、新工具数、channel `backtest`）。
5. 验证：`cd docs && bun run build`。

## 5. 验证清单

```bash
cd frontend && bun run lint && bunx vue-tsc --noEmit && bun run test && bun run build
cd docs && bun run build
```

新增/更新测试：
- `toolContract.test.ts`：`EXPECTED_TOOLS` 31 个；`run_strategy_code` 可选 `script_name`；两个新工具的参数 schema。
- `runStrategyCodeTool.test.ts`：`script_name` 分支（mock `scriptRun`）。
- 新 `services/scriptRun.test.ts`：`configFromToolArgs` 的 mode 推导与单位换算（纯函数，不碰 IndexedDB）。
- 可选：`strategyScripts` 的纯映射函数单测（IndexedDB 需 `fake-indexeddb`，本轮不引入）。

## 6. 风险 / 未知 / 决策

1. **功能损失（需确认）**：页面上的「预设规则表单」「智能推荐策略」「组合注水/再平衡表单」消失；
   引擎与 LLM 工具仍在。若仍想在页面用预设规则，需要另加「模板」按钮把预设参数展开成代码（本计划只放静态模板）。
2. **历史运行记录丢失**：删除 `backtestRuns` 表会丢弃既有回测历史（只有 spec/summary/抽样点，可重算）。
3. **CodeMirror 体积**：`codemirror` meta 包 + JS 语言约数百 KB；对 5s 沙箱脚本够用，但会增加首屏 chunk。
   若不接受，可退回纯 `textarea`（零依赖），仅需换 `CodeEditor.vue` 一处。
4. **`save_strategy_script` 不进确认闸门**：模型可静默写本地方案（`source:'ai'`，列表可见可删）。
   若要求更严，把它加进 `CONFIRM_REQUIRED`，但 `CodeApprovalCard.vue` 是代码卡片，需要新的确认 UI。
5. **`script_name` 重名**：名称非唯一键，按名称查找可能命中多条 → 返回候选让模型用更精确的名字或 id 重试。
6. **headless 场景**：`analysis/` 无 UI，`run_strategy_code` 仍默认拒执；新增的 `list_strategy_scripts` 只读，安全。
7. **Dexie 删表**：`version(6).stores({ backtestRuns: null })` 需确认运行期无并发旧版本标签页（本地应用，可接受）。
8. **深链 `/backtest/:code`**：当前全仓库无调用方（只有路由定义），保留为「预填单基金草稿」以兼容旧书签。

## 7. 验收标准

- 导航只剩一个「回测」入口；`/backtest-portfolio` 不再存在。
- 左侧可新建/保存/编辑/删除方案，方案含代码+完整配置；刷新后仍在。
- 底部可在编辑器与结果之间切换；结果含汇总卡片 + 图表（可缩放）+ 明细表。
- 聊天里 `run_strategy_code` 运行成功后，页面可一键把该段代码载入编辑器。
- LLM 能：写代码回测、按名称跑已保存方案、列出方案、保存方案。
