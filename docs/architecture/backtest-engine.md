# 回测引擎（前端）

回测计算在 **浏览器内** 完成：`frontend/src/services/backtest/`。原先的
`POST /api/backtest/*` → `pythonRunner` → `python/cli/backtest.py` 链路已无前端调用方，
Python 实现保留为**黄金基准**（生成 fixtures、跑差分测试）。

```
用户 / AI 工具
      │
      ▼
services/backtest/runBacktestForFund.ts  ← 取 NAV（/api/funds/:code/nav-history，24h 缓存）
      │
      ▼
services/backtest/backtestEngine.ts      ← 纯函数：NAV[] + spec → { summary, timeline }
      ├─ strategyRules.ts   定投日调度 + 定投方式（等额/价值平均/均线偏离）
      └─ pyCompat.ts        CPython round() 银行家舍入、ISO 周键
      │
      ├─→ views/BacktestView.vue           （/backtest 工作台：左方案列表 + 右 AI 对话 + 下 编辑器/图表）
      ├─→ chatEngine/toolHandlers.ts       （AI 工具，输出经 timelineSample 抽样）
      └─→ db/strategyScripts.ts            （Dexie 持久化：方案 = 代码；净值缓存 navHistory）
```

## 为什么迁移

1. **回测是纯算术**：`backtest.py` 只用 `math` / `datetime`，无 numpy/pandas，243 行；
   3 年日频 733 个点，JS 计算在微秒级。Python 子进程（`spawn` + JSON stdio + 120s 超时）
   在这里只带来延迟与故障面。
2. **AI 工具的输出预算**：聊天循环用 `truncateJson(envelope)`（默认 4000 字符）包工具结果，
   而 3 年日频 timeline 约 **148 KB** —— 模型过去只能看到被截断的 JSON 片段。
   现在工具返回「summary + 抽样检查点」（< 4 KB），完整曲线留在页面。
3. **架构一致性**：AGENTS.md 早已声明「业务计算已迁移前端」，backtest 是最后一块。

## 数据契约

输出字段名保持 `python/cli/backtest.py` 的 snake_case（`total_invested` / `return_rate` /
`is_investment_day` / `exit_reason` …），因此工作台与画图口径与历史数字都不变。

```ts
interface BacktestSpec {
  period?: 'monthly' | 'weekly' | 'daily' | 'lump_sum'   // 默认 monthly
  day?: number | null      // monthly: 1-31；weekly: 0-4（0=周一）
  amount?: number          // 默认 1000
  initialAmount?: number   // 默认 0
  feeRate?: number         // 小数：0.0015 = 0.15%（默认）
  takeProfitRate?: number | null   // 小数：0.2 = 涨 20% 卖出
  stopLossRate?: number | null
  rule?: { type: 'fixed' }
        | { type: 'value_averaging'; targetGrowth: number }
        | { type: 'ma_deviation'; window: number; factor: number }
}
```

**单位约定**：引擎只认**小数**（0.0015 = 0.15%），UI 输入是**百分数**，转换在
`composables/useBacktestWorkspace.ts` / `components/backtest/BacktestConfigForm.vue` 完成；聊天工具的参数也按小数描述。

## 扣款日语义（`day`）

| 情形 | 行为 |
|------|------|
| `day` 未指定 | 该周期**首个交易日**（与 Python 实现一致） |
| `day = N` | 该周期内首个「日期 ≥ N」的交易日 |
| 该周期没有 ≥ N 的交易日（如 2 月指定 31 号、假期缩短周） | 退化为该周期**最后一个交易日**（不会顺延到下个周期） |
| `period = 'lump_sum'` | 只在首日买入一次 |
| `period = 'daily'` | 每个交易日都买入 |

## 定投方式（rule）

| rule | 语义 |
|------|------|
| `fixed` | 每期固定 `amount` |
| `value_averaging` | 第 n 期目标市值 `target(n) = amount * ((1+g)^n - 1) / g`（`g = 0` 时为 `n * amount`），买入 `max(0, target(n) - 当前市值)`；**只补不卖** |
| `ma_deviation` | 取**今日之前** `window` 个交易日的 NAV 均值 MA（不含当日，避免未来函数），买入 `amount × clamp(MA/nav, 1-factor, 1+factor)`，无历史时按 `amount` |

## 迁移中修掉的既有缺陷

| 缺陷 | 现象 | 现状 |
|------|------|------|
| **手续费 100×** | 页面输入 `0.15`（%）被原样发给 `/api/backtest/fixed-investment`，Zod 以「小数」接收 → Python 按 **15%** 手续费计算 | 引擎统一小数，UI 显式 `/100` |
| **止盈率 400** | 页面输入 `20`（%）→ 后端 Zod `max(1)` → 请求 400，回测直接失败 | 同上；`0.2` = 20% |
| **每日定投恒为 0** | 页面提供「每日定投」，但 Python 没有 `daily` 分支 → `investment_count = 0`、收益率恒 0%（静默错误） | 引擎实现 `daily` |
| **智能推荐策略必崩** | `/api/backtest/strategy-suggest` 只返回 `{summary, timeline}`，原回测页却读 `recommended.name` / `strategies[]` | 前端 `strategyCompare.ts` 产出该契约（夏普排序 + 差异说明）；现由 `compare_backtest_strategies` 工具暴露 |
| **跨年周重复扣款** | 周键写成 `(dt.year, isocalendar()[1])`（日历年 + ISO 周号而非 ISO 年周）→ 跨年那周被切成两桶、扣款两次 | 两侧同步改为真正的 ISO 年周（`isocalendar()[:2]` / `isoWeekKey`）；`weekly_cross_year` fixture 已重生成（4 次 → 3 次投入） |

## 验证

```bash
# 黄金 fixtures（Python 实现迁移前导出，现已冻结）—— 引擎必须逐值复现
cd frontend && bunx vitest run src/__tests__/services/backtestEngine.test.ts

# 工具输出不被截断（核心回归）
cd frontend && bunx vitest run src/__tests__/services/backtestPayload.test.ts
```

`__fixtures__/{engine,pyround,isoweek}.json` 的来历（生成脚本已于 2026-09-29 随 Python 路径
删除）见 `__fixtures__/README.md`。迁移时的验证结果：

| 验证 | 结果 |
|------|------|
| 12 个黄金用例（退回/止盈止损/一次性/跨年周/tie/单点/空数据） | **逐值一致** |
| 随机差分测试（400+ 例，随机净值/乱序输入/重复日期，两个种子） | 移植域内 **0 mismatch** |
| 工具输出经 `truncateJson`（4000 字符预算） | 抽样后不再被截断（原先 3 年日频 148 KB） |

`pyCompat.ts` 之所以存在：CPython 的 `round()` 是**按二进制精确值 ties-to-even**
（`round(0.5) === 0`、`round(2.675, 2) === 2.67`），而 `Math.round` 是 half-up、
`toFixed` 在 tie 上远离零，都会让数字对不上。`pyRound` 用 BigInt 还原 double 的精确十进制
展开后四舍五入，再解析回 double —— 与 CPython 两步一致（oracle 见 `__fixtures__/pyround.json`）。

## 已知怪癖（有意保留，改动会变更 UI 数字）

1. **`investment_count` = 计划扣款次数**，不是实际买入次数：清仓后仍按计划计数
   （`monthly_stop_loss_exit` 实际只买 1 次却报 3 次）。工具输出额外给出 `buy_count`
   （由 timeline 的 `is_investment_day` 统计）作为诚实口径。
3. **`amount = 0` 的边界**：Python 会把「买了 0 元」的那一天标为 `is_investment_day: true`，
   前端引擎只标注真实买入（数值字段完全一致）。
4. `max_drawdown` 存的是**负值**（`-18.11` 表示回撤 18.11%），与 Python 一致。

## 多策略推荐（`strategyCompare.ts`）

多策略推荐由聊天工具 `compare_backtest_strategies`（与 `suggest_strategy` 共用）暴露：并行跑
每月/每周/一次性/价值平均/均线偏离五种方案，按**夏普比率**（并列看年化）排序推荐。

两个必须记住的约束：

1. **必须在页面同一时间窗口内比较**。`suggestStrategy` 先 `clipNavHistory()` 裁剪到
   `params.startDate ~ endDate` 再比——否则推荐来自基金全部历史（实测 110022 会变成 16 年、
   每月定投总投入 194000 元），而结果卡片只展示 3 年，点「应用此策略参数」后数字就对不上。
   `recommended.reason` 里会写明回测区间。
2. **各方案投入本金不同**，收益率不可直接横比（一次性投入尤其）。`reason` 里会逐个列出本金。

## 自定义策略代码（代码优先，`run_strategy_code`）

固定池 + 逐日决策，一个契约，没有单基金/组合之分：

```
LLM/用户 提供 code（模块）
  → chatEngine 识别为「需确认工具」→ 用户点「运行」
  → worker#1 kind:'plan'：compileStrategyModule → prepare(sdk) → { start, end, assets, ... }
  → DataBroker 取 NAV（Dexie 优先，缺失/过期才取）
  → worker#2 kind:'portfolio'：onDay(s) 逐日 → runPortfolioBacktest(spec, { navByCode, hooks })
  → 完整结果（页面画图）/ samplePortfolioBacktest（回喂模型，<4KB）
```

**代码契约**：代码是一个模块，必须定义

```js
function prepare(sdk) {   // 固定池 + 窗口；只读本地基金库，无网络
  const pool = sdk.screen().filter((r) => r.sharpe_ratio_1y != null).slice(0, 5).map((r) => r.code);
  return { start?, end?, assets: ['110022', '510300', 'CASH:0.02'], initialAmount?, feeRate? };
}
function onDay(s) {       // 逐日；按**基金代码**寻址（不是下标）
  return { buy?: [{ code, amount }], sell?: [{ code, amount }], rebalance?: { code: 权重 }, sellAll? };
}
```

`s = { i, date, codes, nav(code), navs(code)（截至今日，无未来）, ma(code,n), pctChange(code,n),
weight(code), shares, values, cash, invested, value, returnRate(), args:{ start, end, initialAmount, feeRate } }`。
每日应用顺序 `rebalance → buy → sell`，`sellAll` 覆盖其余。未在 `assets` 声明的代码会**明确报错**。
`CASH[:年化]` 是现金腿，在代码里以 `'cash'` 寻址。省略 `start`/`end` 默认近三年。

**适配**：引擎仍用下标寻址（`PortfolioDecision` 未变），`strategySandbox.toIndexDecision` 在边界做
code→index 转换；引擎只把资产数下限放宽为 1（`portfolioBacktest.ts`），会计与黄金 fixtures 不动。
`initialAmount > 0` 时按**等权**在首日预分配。

**安全边界（重要）**：浏览器里没有真正的 JS 沙箱。Worker 只做到「可 terminate」+ 尽力遮蔽
`fetch`/`indexedDB` 等全局 + **不注入任何密钥**；**用户点击运行是唯一信任边界**，所以 UI 必须
完整展示代码原文。无 UI 的 headless 分析场景（`analysis/`）会**默认拒执**并让模型改用 `run_backtest`。

## 回测工作台（`/backtest`）

左 = 已保存方案列表，右 = 复用 `ChatPanel`（`channel="backtest"`，`force-skill="investment_strategy"`），
下 = CodeMirror 6 **编辑器** / **结果**（汇总卡片 + ECharts + 逐日明细）切换。
**没有模式切换、没有资产权重表**——池子写在代码的 `prepare()` 里。

## 数据：Dexie 优先（`dataBroker.ts` + `db/navCache.ts`）

- `navHistory` 表（Dexie `version(7)`）按 code 缓存整段净值，`fetchedThrough` 记录「取到哪一天」。
- 命中条件：覆盖 `[start, min(end, today)]` 且（窗口完全在过去 或 24h 内取过）。净值是**追加型**，
  按 date 并集去重合并（旧点不会被改写）。
- 取数用**稳定区间**（全量、不带 query）——服务端缓存 key 含 range，而 provider 是先全量下载再按
  range 切片，所以请求「尾巴」只会全量重下。**增量只体现在前端覆盖度**，不省上游带宽。
- 限并发 6 + 每轮取数上限 60 次，超限返回明确错误（护住服务端 300/15min 限流）。
- `prepare(sdk).screen()` 读本地 `screeningFunds`（数千行），零网络；可用于选池。

## 持久化

`db/strategyScripts.ts`（Dexie `version(7)`）：每条 = `{ name, code, source, lastRunAt, lastSummary }`——
**配置全在代码的 `prepare()` 里**，没有单独的 config 字段。旧的 `backtestRuns` 表已在 `version(6)` 删除。

## 组合回测（多资产 + 再平衡）

单基金引擎只吃一条净值曲线（`runBacktest(navHistory, spec)`），多资产的核心仓（如
永久投资组合 25/25/25/25 + 年度再平衡）表达不了，所以组合走独立的一层：

```
用户 / AI 工具 run_portfolio_backtest
      │
      ▼
services/backtest/runPortfolioBacktest.ts   ← 每个资产各取一次 /funds/:code/nav-history
      ▼
services/backtest/portfolioBacktest.ts       ← 纯函数：对齐 → 建仓/注水/再平衡 → 组合 timeline
      ├─ summarize()（复用单基金引擎）       年化/回撤/夏普口径一致
      ├─ sampleTimeline()（复用）            工具输出 <4KB
      └─ TWR 年化（annual_return_twr）       剔除注水影响的真实收益
      │
      ├─→ views/BacktestView.vue             （/backtest 工作台的「组合」模式）
      └─→ chatEngine/toolHandlers.ts         run_portfolio_backtest
```

**数据契约**：`PortfolioSpec { assets[{kind:'fund'|'cash', fundCode|annualRate, weight}],
initialAmount, contribution{amount,period,day}, rebalance{frequency,threshold}, feeRate }`。
权重按**总和归一化**，所以传百分数(25)或小数(0.25)等价。

**对齐**：每个基金的净值按日期取**并集**、前向填充（停牌不丢曲线），但模拟只从
`effective_start = max(各资产首个可用日期)` 开始，保证开局每条腿都在；`effective_end =
min(各资产最后日期)`。区间内没数据的资产进 `excluded`（工具/页面都会提示），剩余资产 <2 则报错。

**现金腿**：货币基金**没有单位净值序列**（`eastmoneyFundProvider.ts` 里 `hb` 走货币基金排行），
所以现金用 synthetic `cash`（`annualRate` 按日复利），不要塞 6 位货基代码。

**注水**：`contribution.period`（monthly/quarterly/yearly）按周期首个交易日；默认按
「补最缺的腿」分配（`contributionAllocation: 'underweight'`），可切 `'target'` 按目标权重分摊。

**再平衡**：`rebalance.frequency` 日历触发（周期首个交易日）或 `threshold` 偏离触发
（`0.05` = 偏离 5 个百分点）；同日先注水后再平衡；买入与卖出都扣 `feeRate`（未区分申赎费/印花税，偏乐观）。

**指标**：`annual_return` 是投入本金口径，注水型组合会失真；**用 `annual_return_twr`（时间加权年化）**
与公开组合收益对比。

**工具输出预算**：`samplePortfolioBacktest()` 把 `assets` 压成 `{code,kind,target_pct,final_pct,return_pct}`，
并从 12 个检查点起**逐次减 2** 直到 `truncateJson`（pretty-print、4000 字符硬截断）不会截断（上限 3800）。
单基金那份预算有 `backtestPayload.test.ts`，组合这份有 `portfolioBacktestPayload.test.ts` 守着。
