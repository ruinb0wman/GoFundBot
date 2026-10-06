# 自由代码回测（固定池 + 按 code 决策 + Dexie 优先缓存）

> 已定方案：选 (a)「池子固定、按日决定持哪几只」。**不做**动态腿、不做 async 引擎、不做 Worker↔主线程数据 RPC。

## 1. 目标

`/backtest` 只保留**一个代码编辑器**（删掉单基金/组合模式切换与资产权重表）。代码即契约：

- `prepare(sdk)` 声明**固定池**（基金代码 + 可选现金腿）、窗口、初始资金、费率。
- `onDay(s)` 逐日按**基金代码**决策买卖/再平衡。

数据 **Dexie 优先**，缺失/过期才取；`prepare` 可调本地 `screen()` 从基金库选池。引擎保持同步纯函数。

## 2. 现状（已核实）

| 事实 | 位置 |
|------|------|
| 组合引擎日期轴 = 各腿区间并集，模拟窗口 `max(首日)~min(末日)`，**要求 ≥2 腿** | `portfolioBacktest.ts:300-345`，`:310 active.length < 2` |
| `decide` 同步、按下标寻址（`{asset, amount}` / `rebalance: number[]`） | `portfolioBacktest.ts:427`；`backtestTypes.ts:PortfolioDecision` |
| 沙箱用 `new Function` 编译单函数（不是模块） | `strategySandbox.ts:compileStrategyFunction` |
| 回测取数**不走 Dexie**；服务端内存缓存 24h，key 含 range | `runBacktestForFund.ts:fetchNavHistory`；`fundService.ts:186`；`cache.ts:163` |
| provider **先全量下载再按 range 切片**（range 不省上游） | `eastmoneyFundProvider.ts:166/189`、`stockSdkFundProvider.ts:22` |
| 有批量口 | `POST /api/funds/nav-batch`（`fund.routes.ts:50`） |
| 本地基金库只有元数据（无序列），可用于选池/判陈旧 | Dexie `screeningFunds`（`db/index.ts:222`） |

## 3. 设计

### 3.1 契约（人 / LLM / 运行时同一份）

```ts
// ── 声明：只读本地数据，无网络；返回固定池 ─────────────────────────────
function prepare(sdk) {
  const pool = sdk.screen({ type: 'ETF' }).slice(0, 5).map(r => r.code);
  return { start: '2020-01-01', end: '2026-10-06', assets: pool, initialAmount: 0, feeRate: 0.0015 };
}
// sdk.screen(filter) 只读本地 screeningFunds（字段见 ScreenRow）

// ── 逐日决策：按下标寻址改为按基金代码寻址 ──────────────────────────────
function onDay(s) {
  // s.i / s.date / s.codes
  // s.nav(code) / s.navs(code)（截至今日，无未来）/ s.ma(code,n) / s.pctChange(code,n)
  // s.weight(code) / s.shares / s.values / s.cash / s.invested / s.value / s.returnRate()
  // s.args = { start, end, initialAmount, feeRate }
  return {
    buy?:  [{ code: '110022', amount: 1000 }],   // 外部资金（计入累计投入）
    sell?: [{ code: '510300', amount: 500 }],    // 换现金（留在组合）
    rebalance?: { '110022': 0.6, '510300': 0.4 },// 内部调仓（按总和归一化）
    sellAll?: true,
  };
}
```

约定：
- `assets` 里最多一个 `CASH`（`'CASH'` 或 `'CASH:0.02'`），在 `onDay` 中以代码 **`cash`** 寻址。
- `initialAmount > 0` 时由引擎按**等权**在 i=0 预分配（`onDay` 在其后执行）。
- 引擎的 `PortfolioDecision`（下标）**不变**；`strategySandbox` 做 code→index 适配。
- 未在 `assets` 中声明的代码：`buy/sell/rebalance` 引用它 → 明确报错（不静默）。

### 3.2 执行流程（无 RPC，两段 worker 调用）

```
主线程：读 screeningFunds → 投影 ScreenRow[]
  │
  ├─ worker#1  kind:'plan'   → compileStrategyModule(code) → prepare({screen}) → {start,end,assets,initialAmount,feeRate}
  │
  ├─ 主线程 DataBroker：按 assets 解析 NAV（Dexie 优先 → 取数 → 合并写回）
  ├─ 主线程 buildPortfolioSpec(plan)：fund→{kind:'fund'}，CASH→{kind:'cash',annualRate}，等权
  │
  └─ worker#2  kind:'portfolio' → onDay 逐日（同步）→ 完整结果 → 汇总/图表
```

- 两段都**禁网**、各 5s 超时（`executeInWorker` 现有机制即可，无需暂停逻辑）。
- 编译两次（plan / run）但代码很短，代价可忽略；不做跨调用状态共享。

### 3.3 Dexie 缓存 + 取数策略

新增表（`db/index.ts` `version(7)`）：
```ts
interface NavCacheEntry { code: string; points: NavPoint[]; firstDate: string; lastDate: string; updatedAt: number }
this.version(7).stores({ navHistory: 'code, lastDate, updatedAt' })
```
`db/navCache.ts`：`get(code)` / `merge(code, points)`（按 date 并集去重，升序）/ `coverage`。

`services/backtest/dataBroker.ts`：
- `loadNav(codes, {start,end})`：Dexie 命中且覆盖且不陈旧 → 直接用；否则取数（**稳定区间**：不带 range 或固定长窗口，让服务端 `fund:nav-history:CODE::` 24h 缓存命中）→ 合并写回 → 返回。
- 陈旧判定：`lastDate < expectedLastTradingDay`，`expectedLastTradingDay` 取 `screeningFunds.nav_date` 的最大值（本地快照，每日 9AM 刷新），退化到今天；避免周末/节假日反复重取。
- `screenRows()`：读 `screeningFunds` → 投影 `ScreenRow[]`。
- **限并发**（≤6）+ **每轮取数预算**（≤60 次），超限返回明确错误（避免打爆服务端 300/15min）。

> 关键取舍：请求「尾巴」会因服务端缓存 key 含 range 而触发**全量重下**，所以这里只做**前端覆盖度增量**，上游按稳定区间走缓存。

### 3.4 页面 / 记录 / 工具

- 删 `components/backtest/BacktestConfigForm.vue`、`PortfolioAssetsEditor.vue`、`BacktestView.vue` 里的模式切换。
- 工作台 = 编辑器（CodeMirror，已有）+ 模板 + 保存/另存为 + 运行 + 结果（汇总卡片 + 曲线 + 可折叠逐日明细）。
- `strategyScripts` 记录简化为 `{ id, name, code, source, createdAt, updatedAt, lastRunAt?, lastSummary? }`（配置全在 `prepare()` 里）。
- 工具：`run_strategy_code` 参数变 `{ code, script_name? }`（+ 可选 `start_date/end_date/initial_amount/fee_rate` 作为覆盖）；
  `save_strategy_script` 变 `{ name, code }`。`list_strategy_scripts` 去掉 `mode/target`。
- `CodeApprovalCard.vue`：始终展示 `code`（`script_name` 模式从 Dexie 取码，已有逻辑）。
- `strategyTemplates.ts`：改成 `prepare`+`onDay` 模板（等权定投 / 动量轮动 / 阈值再平衡 / 逢跌加仓）。

## 4. 步骤（每步可独立验证）

**Step 1 — 沙箱契约（`strategySandbox.ts` 重写）**
- `compileStrategyModule(code)`：`new Function` 包模块，导出 `prepare`/`onDay`（要求 `onDay`）。
- `handlePlanRequest({code, screenRows, defaults})` → 归一化 `StrategyPlan`（校验 assets 非空/≤`MAX_POOL`/单现金腿/日期）。
- `makePortfolioDecision(code, args)`：把 `DaySdk`（按 code）建好，调 `onDay`，`toIndexDecision` 转成引擎下标形状。
- 删除单基金沙箱（`makeDecision`/`handleRunStrategyRequest`/`compileDecision`）。
- 验证：新增 `strategySandboxPlan.test.ts`；重写 `portfolioStrategySandbox.test.ts`（code 寻址 + 未知 code 报错）。

**Step 2 — worker + 出口（`strategyWorker.ts` / `runStrategyCode.ts`）**
- worker 增加 `kind:'plan'` 分派；`executeInWorker` 允许 `'plan' | 'portfolio'`。
- 新增 `planStrategyCode(code, screenRows)`；删除单基金 `runStrategyCode`/`runStrategyCodeRaw`。
- 验证：`bunx vue-tsc`。

**Step 3 — 引擎放宽（`portfolioBacktest.ts`）**
- `:310 active.length < 2` → `< 1`，错误文案改「至少需要 1 个有效资产」。
- 验证：改 `portfolioBacktest.test.ts:126` 期望；其余黄金 fixtures 逐值不变。

**Step 4 — Dexie 缓存与 broker（`db/navCache.ts` / `db/index.ts` / `services/backtest/dataBroker.ts`）**
- v7 表；`loadNav` / `screenRows` / 并发与预算。
- `fetchNavHistory` 保持为「原始 HTTP」，broker 在其上做缓存。
- 验证：`navCache.test.ts`（merge/coverage/stale，纯映射）；真浏览器连跑两次回测，第二次零网络（broker 计数断言）。

**Step 5 — 运行编排（`services/backtest/scriptRun.ts`）**
- `runScript(code, overrides)`：plan → broker NAV → spec → run；返回完整结果。
- `runSavedScriptSampled(script)`：同上再抽样给 LLM。
- 验证：更新 `runStrategyCodeTool.test.ts`。

**Step 6 — 页面与记录**
- `useBacktestWorkspace.ts` 去掉 mode/single/portfolio/AssetRow；`views/BacktestView.vue` 去掉模式与配置表；
  删两个配置组件；`db/strategyScripts.ts` + `db/index.ts` 记录简化（旧记录读入时忽略未知字段）。
- 验证：`vue-tsc` + lint + 真浏览器（新建/保存/刷新还原/跑通/图表）。

**Step 7 — 工具与文档**
- `toolDefs.ts`（`run_strategy_code`/`save_strategy_script` 参数）、`toolHandlersBacktest.ts`、`toolContract.test.ts`、
  `strategyScriptsTool.test.ts`、`CodeApprovalCard.vue`。
- `docs/architecture/backtest-engine.md`（新增 SDK/契约/缓存节）、`docs/architecture/ai-chat.md`、`AGENTS.md`。
- 验证：`bun run lint && bunx vue-tsc --noEmit && bun run test && bun run build` + `docs` build。

## 5. 风险 / 决策

1. **破坏性契约变更**：指数寻址 → 代码寻址；单基金沙箱删除。已保存方案若用旧契约需重写（记录里只存代码，改了就行）。
2. **`initialAmount` 语义**：等权预分配（含现金腿）。若希望「全部先留现金」，需在引擎层加开关——本次不做，文档写明。
3. **现金腿寻址**：以 `cash` 字面量；只允许一个现金腿。
4. **`screen()` 快照**：只投影 `ScreenRow` 字段；空库返回 `[]`（不报错）。
5. **上游带宽**：增量只省前端；如需真正省，后续再动服务端全量缓存（本次不做）。
6. **`onDay` 不支持 `await data.*`**：这是 (a) 的边界；动态选池留待 (b) 的独立方案。

## 6. 验收

- 回测页只有一个代码编辑器；无模式切换、无资产权重表。
- 代码用 `prepare()` 声明单只/多只/含现金，`onDay()` 按代码买卖与再平衡；单标的可跑。
- 第二次相同回测不再发净值请求（Dexie 命中），刷新/服务重启后仍命中。
- 取数有限并发与每轮预算，超限有明确错误。
- 现有同步引擎与其它工具不回归；黄金 fixtures 逐值不变。
- LLM 与人共用同一契约。
