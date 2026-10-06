# LLM 自写代码做「组合（多资产）回测」方案

## 1. 目标

让 `run_strategy_code` 能在**单基金**（现有）之外，支持**多资产组合**：LLM 写 JS，
每个交易日拿到各条腿的净值（按日切片、无未来函数），用 `buy/sell/rebalance` 原语决策；
费用、舍入、`summarize`、抽样输出全部复用现有引擎与沙箱/确认闸门。

**假设/已确认**：不改沙箱“禁网络”的设定——数据由 harness 取好注入，代码仍是纯函数。
沿用现有用户确认（`toolApproval`）作为唯一信任边界。

## 2. 现状（读到的代码）

```ts
// backtestTypes.ts —— 单基金钩子，只有一条曲线
interface DecisionState { i; date; nav; navs: number[]; shares; invested; value }
// backtestEngine.ts
runBacktest(navHistory: NavPoint[], spec, hooks: { decide?: (s: DecisionState) => Decision })
```

```ts
// strategySandbox.ts
compileDecision(code)  → DecisionFn = (state: StrategyDecisionState) => Decision | void
makeDecision(code, args) → 校验 { buy?: number; sellAll?: boolean }
handleRunStrategyRequest({ nav, spec, code }) → { ok, result } | { ok:false, error }
```

```ts
// strategyWorker.ts —— 单条消息 { id, payload: RunStrategyPayload }
// runStrategyCode.ts —— new Worker(...)，5s 超时后 terminate，成功走 sampleBacktest
```

工具 `run_strategy_code`：`fund_code` + `code` 必填；`toolApproval.CONFIRM_REQUIRED` 已包含它。
`CodeApprovalCard.vue` 硬编码显示 `request.params.fund_code`。

组合引擎 `portfolioBacktest.ts`（本次已实现）目前只有参数化 `contribution`/`rebalance`，
没有 `hooks.decide`。

## 3. 新契约

### 3.1 引擎钩子类型（`backtestTypes.ts`）

```ts
export interface PortfolioDecisionState {
  i: number; date: string;
  navs: number[];          // 今日各资产净值
  history: number[][];     // 各资产截至今日（含今日）的净值序列
  codes: string[];         // 资产代码；现金腿为 'cash'
  shares: number[]; values: number[]; cash: number;
  invested: number; value: number;   // value = 持仓 + cash
}
export interface PortfolioDecision {
  buy?:  { asset: number; amount: number }[];   // 追加外部资金（计入累计投入）
  sell?: { asset: number; amount: number }[];   // 卖出换现金（现金留在组合内）
  rebalance?: number[];                          // 内部调仓到目标权重（归一化）
  sellAll?: boolean;
}
export interface PortfolioHooks { decide?: (s: PortfolioDecisionState) => PortfolioDecision | void }
```

### 3.2 引擎（`portfolioBacktest.ts`）

- `PortfolioEngineOptions` 增加 `hooks?: PortfolioHooks`。
- 引入 `cash` 余额；`value = Σ shares_i·nav_i + cash`，`invested` 只随 `buy`（与 `initialAmount`）增长。
- `hooks.decide` 存在时**绕过** `contribution`/`rebalance` 计划（与单基金自定义模式一致，代码全权决策）。
- 每日顺序：day0 按权重建仓 → `hooks.decide(state)` → 应用 `rebalance`（内部，先卖后买，现金兜底）→ `buy`（外部）→ `sell`（转现金）；`sellAll` 覆盖其它并置 `exit_reason='custom'`。
- 现有一个 `value`/`summarize`/TWR 逻辑不变；自定义模式 `investment_count` 报**实际买入日数**（同单基金）。

### 3.3 沙箱（`strategySandbox.ts`，纯逻辑、可单测）

```ts
export interface PortfolioStrategyHelpers {
  ma(asset: number, n: number): number;        // 该腿前 n 日均值（不含今日）
  pctChange(asset: number, n: number): number; // 该腿相对 n 日前涨跌
  weight(asset: number): number;               // 市值权重（含现金分母）
}
makePortfolioHelpers(history)
makePortfolioDecision(code, args)  // 编译 + 逐日校验（资产下标、金额、rebalance 长度/和）
handleRunPortfolioStrategyRequest({ assets, navByCode, spec, code }) → { ok, result } | { ok:false, error }
```

错误信息沿用「`策略代码在 <date> 执行出错：…`」风格。

### 3.4 Worker / 主线程（`strategyWorker.ts` / `runStrategyCode.ts`）

- Worker 消息改为带 `kind: 'single' | 'portfolio'` 的联合请求，分派到两个 handler；封锁全局与超时逻辑不变。
- 新增 `runPortfolioStrategyCode(request)`：起同一个 Worker，成功后走
  `samplePortfolioBacktest(response.result, spec)`（<4KB 预算，已有守卫）。

### 3.5 工具（扩展 `run_strategy_code`，不新增工具）

- `parameters`：`fund_code` 改可选，新增 `assets`（与 `run_portfolio_backtest` 同款数组，可选），`code` 仍必填；
  校验后 handler 判定：有 `assets`（≥2）→ 组合模式；只有 `fund_code` → 单基金模式；都没有 → 报错。
- 描述写清两种模式的 `s` 字段差异与 `buy/sell/rebalance` 语义；`promptSnippet` 同步。
- 注册点/工具数不变（仍是 29），`toolApproval.CONFIRM_REQUIRED` 不必改。

### 3.6 确认卡片（`CodeApprovalCard.vue`）

- 资产行：优先显示 `assets` 列表（`510300 25% / …`），否则 `fund_code`；提示语按模式区分
  （“只读取该基金净值” vs “只读取这些资产净值”）。

## 4. 文件清单

**修改**
| 文件 | 改动 |
|---|---|
| `frontend/src/services/backtest/backtestTypes.ts` | 组合决策/钩子类型 |
| `frontend/src/services/backtest/portfolioBacktest.ts` | `hooks` + cash + 决策应用 |
| `frontend/src/services/backtest/strategySandbox.ts` | 组合 helpers / 编译校验 / handler |
| `frontend/src/services/backtest/strategyWorker.ts` | 消息联合分派 |
| `frontend/src/services/backtest/runStrategyCode.ts` | `runPortfolioStrategyCode` |
| `frontend/src/services/chatEngine/toolContract.ts` | `run_strategy_code` 加 `assets` + 描述 |
| `frontend/src/services/chatEngine/toolHandlers.ts` | 双模式分支 |
| `frontend/src/components/CodeApprovalCard.vue` | 资产行 + 提示语 |
| `frontend/src/__tests__/services/toolContract.test.ts` | required 由 `['fund_code','code']` → `['code']` + 组合参数用例 |

**新增**
| 文件 | 内容 |
|---|---|
| `frontend/src/__tests__/services/portfolioStrategySandbox.test.ts` | 组合沙箱单测 |

文档：`docs/architecture/backtest-engine.md` 自定义策略节补「组合模式」。

## 5. 步骤（每步可独立验证）

1. `backtestTypes.ts` 加类型；`portfolioBacktest.ts` 接 `hooks`（先写引擎级测试：用 hook 复现「月度按权重注水」在无 fee/无漂移时与参数化 `run_portfolio_backtest` 逐值一致）。
2. `strategySandbox.ts` 组合 helpers + 校验 + handler（单测：`rebalance` 归位、`sell` 转现金、`buy` 计入投入、`sellAll`、越界/负值报错、`history` 无未来）。
3. `strategyWorker.ts` + `runStrategyCode.ts` 双模式（单测：组合请求返回抽样 payload，含 `assets`）。
4. 工具 + handler + 确认卡片 + `toolContract.test.ts` 更新。
5. 真浏览器验证：让模型写一段「黄金腿跌破 60 日均线则减半、股票腿超配 >5pp 再平衡」并确认执行。

## 6. 风险 / 注意

- **语义歧义**：`buy`=外部新钱、`sell`=转现金、`rebalance`=内部调仓，三者顺序必须写进工具描述与卡片，否则模型会用错。
- **资金守恒**：`invested` 只随 `buy`/`initialAmount` 增长；`rebalance`/`sell` 不产生外部现金流，`value` 含 `cash`。测试要断言 `value = 持仓 + cash` 与 `total_invested` 口径。
- **越界防御**：沙箱是唯一校验点（引擎信任 hooks 输出），`asset` 下标、非负有限金额、`rebalance` 长度都要挡。
- **输出预算**：组合代码跑完走 `samplePortfolioBacktest`（已按 pretty-print ≤3800 自适应），不要再手拼 payload。
- 不改沙箱封锁网络与 5s 超时的既有边界；用户确认仍是唯一信任边界。
