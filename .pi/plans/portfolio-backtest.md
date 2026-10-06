# 组合回测（多资产 + 再平衡）实现方案

## 1. 目标与假设

**目标**：让「我的用户投资组合」（多只基金按目标权重 + 定期/阈值再平衡 + 定期注水）能被回测，
两条入口都打通：

1. **AI 工具** `run_portfolio_backtest` —— 策略研究/投资策略对话里模型直接调用，不再回「工具做不了、只能手工拼」；
2. **「组合回测」页面** —— 与现有「定投回测」页并列，可手动配置资产/权重/再平衡并看图。

顺带新增 `get_portfolio_holdings` 工具，让模型能读到用户当前持仓（见 Phase 4，这是**最大且前置条件最多**的一块）。

**假设**（已与用户确认）：

- 组合的资产代码与**目标权重**必须由 LLM/用户在调用时给出。当前系统里没有任何「目标权重」数据模型；
  `positions` 只有 shares/cost，且**根本没有落库**（见 §2）。所以 v1 的回测输入是显式的 `assets[]`。
- 权重传百分数或小数都行：引擎按 `sum(weights)` 归一化，`[25,25,25,25]` 与 `[0.25,0.25,0.25,0.25]` 结果相同。
- 「现金腿」用 synthetic cash（固定年化）解决，因为**货币基金没有单位净值序列**，`/funds/:code/nav-history` 拿不到。

---

## 2. 现状（实际读到的代码事实）

单基金引擎，无法表达多资产：

```ts
// frontend/src/services/backtest/backtestEngine.ts
export function runBacktest(
  navHistory: NavPoint[] | undefined | null,
  spec: BacktestSpec,
  hooks: BacktestHooks = {},
): BacktestResult | BacktestFailure
```

```ts
// frontend/src/services/backtest/backtestTypes.ts
export interface DecisionState { nav: number; navs: number[]; ... }  // 单条净值曲线
```

聊天工具全部是单基金：

- `toolContract.ts:154` `run_backtest(fund_code, ...)`、`:176` `run_strategy_code(fund_code, code, ...)`、
  `:203` `compare_backtest_strategies(fund_code, ...)` —— 唯一参数是 `fund_code`。
- `skills.ts:218` `GENERAL_TOOL_NAMES`、`:270` `investment_strategy`、`analysisScenarios.ts:219` `FULL_TOOL_NAMES`
  里没有也不可能有组合回测工具。
- `toolContract.test.ts:16` `EXPECTED_TOOLS` 锁死 **27 个工具**，`docs/architecture/ai-chat.md:63` 同样写 27。

可复用的现成零件（这是本方案能小的关键）：

- `runBacktestForFund.ts:33` `fetchNavHistory(code, start, end)` —— 任意基金净值（`/funds/:code/nav-history`，24h 缓存）。
- `backtestEngine.ts` `summarize(timeline, count)` —— 已 export，直接给组合层算年化/回撤/夏普。
- `timelineSample.ts` `sampleTimeline()` / `sampleBacktest()` —— 已处理「4000 字符预算」的抽样；
  组合层只要产出同构的 `BacktestTimelineRecord[]` 就能直接复用。
- `strategyRules.pickInvestmentDates()` + `pyCompat.{monthKey,dayStamp,pyRound}` —— 日历调度与 CPython 舍入。

一个**必须先知道**的坑（决定了 Phase 4 的规模）：

```ts
// service/src/routes/userData.routes.ts:118
portfolioRouter.get('/holdings', asyncHandler(async (_req, res) => { sendSuccess(res, []); }));
```

`/api/user/portfolio/*` 的 funds/holdings/trades/groups/positions **全是返回 `[]`/`ok` 的桩**；
前端 `useMyPositions.ts:534` 的增删改查和 `FundRealtime` 的 `getHoldings()` 都打这些桩，
`db/index.ts:172` 定义了 `positions` 表却**全仓库无人读写**；
`MyPositions.vue` 除了自己没有任何地方 import（孤立组件）。
→ 「自动读取持仓回测」在今天**数据为空**，Phase 4 必须先补持久化。

---

## 3. 设计

### 3.1 组合 DTO（加到 `backtestTypes.ts`，该文件现仅 109 行）

```ts
export type RebalanceFrequency = 'none' | 'monthly' | 'quarterly' | 'yearly';

export interface FundAsset  { kind?: 'fund'; fundCode: string; name?: string; weight: number }
export interface CashAsset  { kind: 'cash'; annualRate: number; name?: string; weight: number }
export type PortfolioAsset = FundAsset | CashAsset;

export interface PortfolioSpec {
  assets: PortfolioAsset[];               // weight 会被 sum 归一化
  initialAmount?: number;                 // 期初一次性，默认 0
  contribution?: { amount: number; period: RebalanceFrequency; day?: number | null } | null;
  rebalance?: { frequency: RebalanceFrequency; threshold?: number | null } | null; // threshold: 小数 0.05 = 偏离 5pp
  feeRate?: number;                       // 默认 0.0015，买卖双向收取
}

export interface PortfolioAssetResult {
  code: string; name: string; kind: 'fund' | 'cash';
  targetWeight: number; finalWeight: number;
  contributed: number; finalValue: number; return_rate: number;
}

export interface PortfolioSummary extends BacktestSummary {
  buy_count: number;
  annual_return_twr: number;   // 现金流调整后的时间加权年化（见 3.2）
  rebalance_count: number;
  contribution_count: number;
}

export interface PortfolioBacktestResult {
  summary: PortfolioSummary;
  timeline: BacktestTimelineRecord[];      // 组合层面，复用 UI/抽样
  assets: PortfolioAssetResult[];
  effective_start: string; effective_end: string;   // 对齐后的真实回测区间
  excluded: { code: string; reason: string }[];
  note: string;
}
export interface PortfolioBacktestFailure { error: string }
```

### 3.2 纯引擎语义（新文件 `backtest/portfolioBacktest.ts`，只做算术、不发请求）

**日期对齐（关键决策）**：

- 每个资产拿到的净值是**各自**的序列；按日期取**并集**，每只基金用「最近一个已知净值」**前向填充**
  （停牌/暂停申赎不丢整条组合曲线）。
- 模拟从 `effective_start = max(各资产首个可用日期)` 开始（保证开局四条腿都在，避免「只有一只时 100% 仓位」的假曲线），
  到 `effective_end = min(各资产最后日期)`（或用户给的 end_date）。
- 某只资产在该区间内数据为空 → 进 `excluded`；剩余有效资产 < 2 → 返回 `{ error }`。
- `cash` 资产：`nav_t = (1 + annualRate) ^ (daysSinceStart / 365.25)`。

**初始建仓**：`initialAmount` 按归一化权重分给各资产，每个买入扣 `feeRate`，
`shares_i = cash_i * (1 - feeRate) / nav_i`。

**注水（contribution）**：按 `pickInvestmentDates` 的等价实现调度（`yearly/quarterly/monthly`，缺省该周期首个交易日）。
分配默认「**补最缺的腿**」：按 `targetValue_i - currentValue_i` 从大到小依次买入，直到现金用完；
若全部到位则按目标权重分摊。同时提供 `allocation: 'underweight' | 'target'`（默认 `underweight`）。
注水日 `is_investment_day = true`。

**再平衡**：`rebalance.frequency` 的周期首个交易日，或任一资产权重偏离目标超过 `threshold` 时触发。
卖出扣 `feeRate`，买入扣 `feeRate`，回到目标权重。同日「先注水、后再平衡」。`rebalance_count` 计数。

**每日估值**：`value = Σ shares_i × nav_i`（不留现金）。

**指标**：

- `summarize(timeline, contributionCount + (initialAmount>0?1:0))` 直接复用（年化/回撤/夏普口径与单基金页一致）。
- 额外算 **TWR 年化**：维护组合「单位净值」`u_0 = 1`；每个外部现金流日 `u_after_flow = value_after / (prevValue + flow)`，
  最后对 `u_end / u_0` 按 `days/365.25` 开方。单基金页的 `annual_return` 是投入本金口径，
  注水型组合会失真，所以额外给 `annual_return_twr` 并写进 `note`。

**费用/边界**：全部走 `pyRound`，与单基金引擎一致。

### 3.3 取数 + 工具（新文件 `backtest/runPortfolioBacktest.ts`）

```ts
export interface PortfolioBacktestRequest extends PortfolioSpec {
  startDate?: string; endDate?: string;
  navByCode?: Record<string, NavPoint[]>;   // 测试/页面复用，跳过 HTTP
}
export async function backtestPortfolio(req: PortfolioBacktestRequest): Promise<PortfolioBacktestResult | PortfolioBacktestFailure>
```

- 对每个 `kind==='fund'` 资产并行 `fetchNavHistory`（`Promise.allSettled`，单只失败只进 `excluded`）。
- `samplePortfolioBacktest(result)`：调用 `sampleTimeline()` 得抽样点，输出
  `{ summary, spec: '四资产 25/25/25/25，年度再平衡，年度注水 10000 元…', checkpoints, assets, excluded, note }`，
  用 `truncateJson` 的 4000 字符预算做上限（照抄 `timelineSample.ts` 的注释与量级）。

工具注册（`toolContract.ts`，与 `run_backtest` 并列）：

```ts
{
  name: 'run_portfolio_backtest',
  label: '组合回测',
  description: '对多资产组合按目标权重做历史回测，支持定期/阈值再平衡与定期注水（多资产，非单只基金）。',
  promptSnippet: 'run_portfolio_backtest(assets, ...): 多资产组合再平衡回测',
  parameters: Type.Object({
    assets: Type.Array(Type.Object({
      fund_code: optStr('6位基金代码；现金腿留空'),
      weight: num('目标权重，可传百分数(25)或小数(0.25)，按总和归一化'),
      annual_rate: num('仅现金腿：年化收益率小数，如 0.02'),
      name: optStr('资产名称，可选'),
    }), { description: '资产列表，至少 2 项' }),
    start_date: optStr('开始日期 YYYY-MM-DD，缺省三年前'),
    end_date: optStr('结束日期 YYYY-MM-DD，缺省今天'),
    initial_amount: num('期初一次性金额（元）'),
    contribution_amount: num('每期注水金额（元）'),
    contribution_period: Type.Optional(enumOf('monthly', 'quarterly', 'yearly')),
    rebalance_frequency: Type.Optional(enumOf('none', 'monthly', 'quarterly', 'yearly')),
    rebalance_threshold: num('权重偏离阈值（小数，0.05=偏离5个百分点触发）'),
    fee_rate: num('手续费率（小数，默认 0.0015，买卖双向）'),
  }),
}
```

`toolSpecsToXml` 只会渲染顶层 `type/enum/anyOf`，`assets` 会退化成 `type="array"`。
**总要**给 `toolSpecsToXml` 加一层「数组项字段也渲染成 `<parameter>`」的小增强，
否则纯 XML 协议（默认模型）看不到 `assets[]` 的子字段。

工具注册点（一处漏了就白做）：

- `skills.ts` `GENERAL_TOOL_NAMES`（`:218`）→ `strategy`/`general` 自动带上；再单独加进 `investment_strategy.toolNames`（`:270`）。
- `analysisScenarios.ts` `FULL_TOOL_NAMES`（`:219`）。
- `toolContract.test.ts` `EXPECTED_TOOLS` 27 → 28（+ Phase 4 的 `get_portfolio_holdings` 再 +1）。
- 在 `INVESTMENT_STRATEGY_PROMPT` / `STRATEGY_CHAT_PROMPT` 加一句：
  「用户要回测多资产组合/再平衡策略时用 `run_portfolio_backtest`，不要手工拼单基金回测」。
- Handler 进 `toolHandlers.ts`（无需审批，纯计算，不进 `toolApproval.ts`）。

### 3.4 「组合回测」页面

- 新 `views/PortfolioBacktestView.vue` + `components/PortfolioBacktest.vue`(.css) + `composables/usePortfolioBacktest.ts`。
- 表单：资产行（基金搜索/代码 + 权重 + 删除/新增，现金腿可切「现金」并填年化）、期初金额、
  注水（金额 + 周期）、再平衡（频率 + 阈值）、费率、日期区间。
- 图表（ECharts，复用 `useEChartsTheme` 的暗色主题写法）：组合市值 vs 累计投入；再平衡/注水日打点。
- 结果：`summary` 卡片（年化、TWR 年化、最大回撤、夏普、再平衡次数、注水次数）+ 各资产最终权重/收益表 +
  `excluded` 提示 + `effective_start/end` 说明。
- 路由：`router/index.ts` 加 `{ path: '/backtest-portfolio', name: 'backtest-portfolio' }`；
  `App.vue` 头部 mode-btn 区加「组合回测」按钮（`BottomNav` 已有 6 项，不再塞第 7 个）。
- 持久化（**可选**，默认不做）：单基金页用 `backtestRuns`；组合历史要复用就得把 `spec` 改成联合类型或新开表，
  v1 先不持久化，避免 schema 迁移。

### 3.5 Phase 4：持仓持久化 + `get_portfolio_holdings`

前置事实：`/api/user/portfolio/*` 全是桩，`positions` 表无人读写，`MyPositions.vue` 孤立。
要真正读到用户持仓，最小路径是**把 `MyPositions` 的持仓落到 Dexie**，然后工具读 Dexie：

1. 新 `db/positions.ts`（仿 `db/backtestRuns.ts`）：`listPositions/addPosition/updatePosition/removePosition/clearPositions`，
   读写 `db.positions`；`UserPosition` 加一个非索引字段 `purchaseTime?: string`（非索引字段无需升版本）。
2. 改 `composables/useMyPositions.ts`：`:534`/`:558`/`:570`/`:588` 的 `portfolioAPI.*Position` 换成 `db/positions`；
   处理 id 形态差异（UI 用字符串 id，Dexie 是 `++id` 数字）——写入后回读自增 id，UI 统一用数字 id。
3. 新工具 `get_portfolio_holdings()`：`localScreeningItems` 同款思路，读 `db.positions`，
   返回 `{ holdings: [{ fund_code, fund_name, shares, cost, market_value?, weight_pct }] }`；
   权重按 `shares × 最新估值` 归一化（估值走 `/funds/:code/estimate`，失败则退回 cost）。
   **只在用户明确问「我的持仓」时用**，并说明它读的是本地 IndexedDB。
4. `FundRealtime` 的 funds/trades/holdings/`groups`（rebalance upper/lower）仍是桩，**本次不动**，单独排期。

> 注意：即便读完持仓，拿到的也只是**当前权重**，不是回测需要的**目标权重**，模型仍要用户确认目标配置。
> 工具描述里必须写清这点，否则模型会拿当前权重当目标权重直接跑。

---

## 4. 文件改动清单

**新增**

| 文件 | 作用 |
|------|------|
| `frontend/src/services/backtest/portfolioBacktest.ts` | 纯引擎（对齐/注水/再平衡/指标/TWR） |
| `frontend/src/services/backtest/runPortfolioBacktest.ts` | 取数 + `samplePortfolioBacktest` |
| `frontend/src/composables/usePortfolioBacktest.ts` | 页面状态/调度/图表数据 |
| `frontend/src/components/PortfolioBacktest.vue` + `.css` | 组合回测 UI |
| `frontend/src/views/PortfolioBacktestView.vue` | 路由壳 |
| `frontend/src/__tests__/services/portfolioBacktest.test.ts` | 引擎单测 |
| `frontend/src/__tests__/services/portfolioBacktestTool.test.ts` | handler/抽样/截断单测 |
| （Phase 4）`frontend/src/db/positions.ts` | Dexie 持仓 CRUD |

**修改**

| 文件 | 改动 |
|------|------|
| `frontend/src/services/backtest/backtestTypes.ts` | 加 §3.1 DTO |
| `frontend/src/services/chatEngine/toolContract.ts` | 加 `run_portfolio_backtest`（+ `toolSpecsToXml` 数组项渲染） |
| `frontend/src/services/chatEngine/toolHandlers.ts` | 加 handler |
| `frontend/src/services/chatEngine/skills.ts` | `GENERAL_TOOL_NAMES` + `investment_strategy` + prompt 提示 |
| `frontend/src/services/analysis/analysisScenarios.ts` | `FULL_TOOL_NAMES` |
| `frontend/src/__tests__/services/toolContract.test.ts` | `EXPECTED_TOOLS` 27→28（+Phase4 29） |
| `frontend/src/router/index.ts` | `/backtest-portfolio` |
| `frontend/src/App.vue`（+ `MobileDrawer.vue`） | 入口按钮 |
| （Phase 4）`frontend/src/composables/useMyPositions.ts`、`frontend/src/db/index.ts` | 持仓落 Dexie |
| `docs/architecture/backtest-engine.md`、`docs/architecture/ai-chat.md`、`AGENTS.md` | 组合引擎章节、工具数、hot spots |

---

## 5. 分阶段步骤（每步可独立验证）

**Phase 1 — 引擎（纯函数，先不接 UI/工具）**

1. `backtestTypes.ts` 加 §3.1 DTO。
2. 写 `portfolioBacktest.ts`：`pickRebalanceDates()`（本地实现 quarter/year key，别去改 `pyCompat`/`pickInvestmentDates` 的
   单基金语义）、日期并集 + 前向填充 + `effective_start/end`、建仓/注水/再平衡/估值、
   `summarize()` 复用、TWR。
3. `portfolioBacktest.test.ts`：等权两资产一次性；年度再平衡后权重回目标；阈值触发；
   注水后 `total_invested` 增长且补最缺腿；手续费在再平衡卖出时扣除；一个资产晚成立 → `effective_start` 正确；
   `cash` 腿按年化增长；不足 2 资产 → error。

**Phase 2 — 工具接入**

4. `runPortfolioBacktest.ts`（并行 `fetchNavHistory` + `allSettled` + `excluded` + `samplePortfolioBacktest`）。
5. `toolContract.ts` 加工具 + `toolSpecsToXml` 数组增强；`toolHandlers.ts` 加 handler。
6. 三处注册（skills ×2、analysisScenarios）+ `EXPECTED_TOOLS` 27→28 + prompt 一句话。
7. `portfolioBacktestTool.test.ts`：mock `fetchNavHistory`，验证信封输出 <4000 字符、缺数据只进 `excluded`、
   handler 对 `annual_rate` 现金腿的处理。

**Phase 3 — 页面**

8. `usePortfolioBacktest.ts` + `PortfolioBacktest.vue`(.css) + `PortfolioBacktestView.vue` + 路由 + 入口按钮。
9. 手动验证：跑一遍「25/25/25/25 + 年度再平衡 + 年度注水」，核对 `effective_start`、再平衡次数、各腿权重回到 25%。

**Phase 4 — 持仓（最大，可单独排期）**

10. `db/positions.ts` + `useMyPositions.ts` 切到 Dexie（保留 `portfolioAPI` 调用为静默兜底或删除）。
11. `get_portfolio_holdings` 工具 + 注册 + `EXPECTED_TOOLS` 28→29。
12. 手动验证：在持仓页加成一条 → 刷新仍在 → 聊天问「我的持仓」能拿到。

---

## 6. 验证

```bash
cd frontend && bun run lint && bunx vue-tsc --noEmit && bun run test && bun run build
```

- 新增引擎/工具测试全绿；`backtestEngine.test.ts`（12 个黄金 fixtures）必须**逐值不变**——本方案不碰单基金引擎。
- `toolContract.test.ts` 工具总数断言更新。
- 手动：策略研究 chat 里让模型跑四资产永久组合，确认它调用 `run_portfolio_backtest` 而不是回「做不了」，
  且工具条不是黄色感叹号。

## 7. 风险与未知

1. **货币基金无净值序列**：`eastmoneyFundProvider.ts:52` 注明 `hb` 走货币基金排行，pingzhongdata 里没有单位净值。
   现金腿必须走 synthetic `cash`（本方案已含），不要试图用 6 位货基代码走 `nav-history`。
2. **ETF 净值可用性未实测**（本机没跑服务，curl 被 plan 策略拦）：`/funds/:code/nav-history` 走 pingzhongdata，
   对 ETF（510300/518880 等）是否稳定返回净值需在 build 阶段实测；若个别 ETF 为空，用户可换对应联接基金。
   这决定了「永久投资组合」能否用 ETF 拼出来。
3. **权重口径**：模型可能把权重当百分数或小数——已用「按总和归一化」兼容，但要保证同一次调用单位一致。
4. **再平衡次数/费用建模**：v1 用单一 `feeRate` 买卖双向，未区分申赎费/卖出印花/ETF 佣金；结果偏乐观，
   文档要写明。
5. **`summarize` 口径**：`annual_return` 是本金收益率口径，注水型组合会失真 → 已加 `annual_return_twr`；
   如果不用 TWR，用户会拿它去对永久组合的历史 CAGR，得出错误结论。
6. **页面持久化**：v1 不做，刷新丢结果。要保留需扩 `backtestRuns` 类型或新表，属独立小任务。
7. **`toolSpecsToXml` 只渲染顶层字段**：本方案要顺手增强；否则非原生 tool-calls 的模型看不到 `assets[]` 结构。
8. **Phase 4 的数据层**：`/api/user/portfolio/*` 是桩、`positions` 表无人读写、`MyPositions.vue` 孤立 ——
   Phase 4 实际上是在补一条从未真正联通的数据链路，工作量接近 Phase 1+2，**建议单独排期**，
   不要阻塞组合回测的本体交付。
