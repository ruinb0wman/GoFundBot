# 定投回测引擎（前端）

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
      ├─→ components/FundBacktest.vue      （回测页：图表 + 明细 + 多策略推荐）
      ├─→ chatEngine/toolHandlers.ts       （AI 工具，输出经 timelineSample 抽样）
      └─→ db/backtestRuns.ts               （Dexie 持久化：spec + summary + 抽样点）
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
`is_investment_day` / `exit_reason` …），因此 `FundBacktest.vue` 与历史数字口径都不变。

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
`composables/useFundBacktest.ts` 完成；聊天工具的参数也按小数描述。

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
| **智能推荐策略必崩** | `/api/backtest/strategy-suggest` 只返回 `{summary, timeline}`，`FundBacktest.vue` 却读 `recommended.name` / `strategies[]` | 前端 `strategyCompare.ts` 产出该契约（夏普排序 + 差异说明） |
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

回测页「智能推荐策略」与聊天工具 `compare_backtest_strategies` 共用同一实现：并行跑
每月/每周/一次性/价值平均/均线偏离五种方案，按**夏普比率**（并列看年化）排序推荐。

两个必须记住的约束：

1. **必须在页面同一时间窗口内比较**。`suggestStrategy` 先 `clipNavHistory()` 裁剪到
   `params.startDate ~ endDate` 再比——否则推荐来自基金全部历史（实测 110022 会变成 16 年、
   每月定投总投入 194000 元），而结果卡片只展示 3 年，点「应用此策略参数」后数字就对不上。
   `recommended.reason` 里会写明回测区间。
2. **各方案投入本金不同**，收益率不可直接横比（一次性投入尤其）。`reason` 里会逐个列出本金。

## 自定义策略代码（AI 沙箱，`run_strategy_code`）

除模板化方案外，聊天/策略讨论里的模型还可以**自己写一段 JS 策略**并回测：

```
LLM 调 run_strategy_code(fund_code, code, …)
   → chatEngine 识别为「需确认工具」→ yield tool_confirm → 用户点「运行」
   → toolHandlers 取净值（/api/funds/:code/nav-history，24h 缓存）
   → runStrategyCode() 起 Worker（5s 超时后 terminate）
   → strategySandbox.handleRunStrategyRequest()
        compileDecision(code) → new Function('s', code)
        runBacktest(nav, spec, { decide })   ← 复用本文档全部会计与 summarize()
   → sampleBacktest() 抽样后回喂模型（<4KB）
```

**代码契约**：`onDay(s) -> { buy?: 元, sellAll?: true }`，每个交易日调用一次。
`s = { i, date, nav, navs, shares, invested, value, returnRate(), args, helpers }`；
`navs` 只到当日、`helpers.ma(n)/pctChange(n)` 也只取**今日之前** n 日，所以自定义代码
无法偷看未来。`sellAll` 走与止盈相同的清仓路径，`exit_reason: 'custom'`。

**引擎接口**：`runBacktest(nav, spec, hooks?)` 新增可选 `hooks.decide`；提供时绕过
`pickInvestmentDates`/`ruleBuyAmount`，由回调逐日决定买入。不传 `hooks` 时行为与黄金
fixtures **逐值一致**（回归测试保证）。自定义运行因为无计划表，`investment_count` 报**实际买入次数**。

**安全边界（重要）**：浏览器里没有真正的 JS 沙箱。Worker 只做到「可 terminate」+ 尽力遮蔽
`fetch`/`indexedDB` 等全局 + **不注入任何密钥**；**用户点击运行是唯一信任边界**，所以 UI 必须
完整展示代码原文。无 UI 的 headless 分析场景（`analysis/`）会**默认拒执**并让模型改用 `run_backtest`。

## 持久化

`db/backtestRuns.ts`（Dexie `version(5)`，表 `backtestRuns`，每只基金保留最近 10 次）：
只存 `spec` + `summary` + **抽样**检查点（全量 timeline 约 150 KB/次，可由 spec 重算）。
回测页据此显示「上次回测」并支持一键**载入参数**；`specHash()`（FNV-1a on key-sorted JSON）
用于按 spec 定位历史运行。
