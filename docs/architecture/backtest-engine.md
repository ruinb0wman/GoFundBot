# 回测引擎

引擎本体在 **`packages/core/src/backtest/`**（纯 TS），前端页面与 service 路由**共用同一份源码**，
所以同一组参数在浏览器与 Node 上必然得到同一个数字。

```
packages/core/src/backtest/
  backtestEngine.ts     单基金：定投 / 价值平均 / 均线偏离 / 一次性
  portfolioBacktest.ts  多资产：权重 + 日历/阈值再平衡 + 定期注水 + 现金腿
  strategyRules.ts      扣款日、价值平均、均线偏离的规则计算
  strategyCompare.ts    多策略对比 + 推荐（compare_backtest_strategies）
  strategySandbox.ts    自由代码回测的 plan/run 两段协议（prepare/onDay）
  strategyTemplates.ts  页面「插入模板」里的示例代码
  toolArgs.ts           工具参数（snake_case）→ 引擎参数的映射
  timelineSample.ts / portfolioSample.ts   给模型的抽样输出（完整结果给图表）
  pyCompat.ts           CPython round / ISO 周 等兼容细节
  backtestTypes.ts      引擎的输入输出类型
```

## 两种入口、一份引擎

| 入口 | 谁在用 | 说明 |
|---|---|---|
| `/api/backtest/{fixed-investment,portfolio,compare-strategies}` | pi（`run_backtest` / `run_portfolio_backtest` / `compare_backtest_strategies`）、脚本 | 参数沿用**聊天时代的 snake_case**（`toolArgs.ts` 负责映射），返回抽样后的紧凑结果 |
| `/backtest` 页面 | 人 | 代码工作台：编辑代码 → 浏览器 Worker 跑 → 图表 + 明细（完整 timeline） |

两条路的净值都来自 `/api/funds/:code/nav-history`（service 的 SQLite 缓存，见 [数据流向](/architecture/data-flow)）。

## 数据契约

- 输入：`NavPoint[] = { date: 'YYYY-MM-DD', nav: number }`（升序、按日期去重）。
- 输出：`{ summary, timeline, ... }`（`summary` 含投入/期末市值/收益率/年化/最大回撤/夏普/TWR 年化；组合还有各腿期末权重）。
- 参数约定：**费率、止盈止损、权重都用小数**（`0.2` = 20%）。

### 收益序列口径：累计净值优先（份额拆分 / 分红）

不能直接拿**单位净值**当收益序列。ETF 的**份额拆分**当天单位净值会腰斩：512010 在 2021-06-24 由
3.206 → 0.8207（1:4）、513500 在 2022-03-28 由 2.7551 → 1.3924（1:2）、515220 在 2024-04-10、
512800 在 2025-07-03、515000 在 2025-09-04、512480 在 2021-03-25 与 2026-07-01 同理。
在单位净值序列里这就是一根 **−50% / −75% 的假阴线**：止损被误触发、动量排序被污染、回撤与夏普全虚，
一只有过拆分的 ETF 整条回测都是错的（512010 六年「−80.6%」，按累计净值只有 −22.3%）。

所以取数统一走 `packages/core/src/backtest/navSeries.ts` 的 `toReturnNavPoints()`：**优先累计净值 `accNav`**
（拆分当天连续、分红一并累计），只有累计净值基本缺失（<95% 的点有值，多见于货币基金或低质量数据源）
时才退回单位净值。三个取数点都已接上：`service/src/services/backtestService.ts`（pi 工具 + 代码沙箱）、
`service/src/services/fundService.ts`（筛选库风险指标富化）、`frontend/src/services/backtest/runBacktestForFund.ts`（页面）。
注意这是**收益序列**口径 —— 展示用单位净值（实时估值、持仓成本、净值曲线）仍读 `nav`，两者不要混。

## 单基金：扣款日与定投方式

- 扣款日 `day`：`monthly` 用「每月第 N 个**交易日**」，`weekly` 用「每周第 N 个交易日」（无则顺延到下一个交易日）。
- 定投方式 `rule`：
  - `equal` 等额定投；
  - `value_averaging` 价值平均（按目标增长率补齐市值）；
  - `ma_deviation` 均线偏离加码（偏离 `maWindow` 日均线时按 `maFactor` 加码）。
- `take_profit_rate` / `stop_loss_rate`：触发即结束（`exit_reason` 记原因），**触发后不再买入**。

## 组合：再平衡、注水与现金腿

- `assets`：`{ fundCode, weight }`；**不填 `fundCode` 的腿是现金**（`annualRate` 可选，默认 0）。
- 权重会被归一化；再平衡支持 `none / monthly / quarterly / yearly` + 阈值（偏离超过 `threshold` 才动）。
- `contributionAmount` + `contributionPeriod`：定期注水，默认补到最欠配的腿（`contributionAllocation: 'underweight'`，可选 `target`）。
- 年化用 **TWR**（`annual_return_twr`）——注水/再平衡不影响收益率的度量。

## 自由代码回测（代码优先）

契约（`strategySandbox.ts`）：

```js
function prepare(sdk) {                     // 声明固定池 + 窗口 + 期初/费率
  const pool = sdk.screen({ type: '混合型' }) // 本地基金库筛选（数据由宿主注入，不联网、无副作用）
  return { start: '2024-01-01', end: '2025-12-31', assets: pool.map(r => r.code).slice(0, 5) }
}
function onDay(s) {                          // 每个交易日调用一次，按基金代码寻址
  if (s.date.endsWith('-01')) return { buy: [{ code: s.codes[0], amount: 500 }] }
  return { rebalance: { [s.codes[0]]: 0.6, 'CASH': 0.4 } }   // 或 sell / sellAll
}
```

- `s` 提供 `nav/navs/ma/pctChange/weight/shares/values/cash/returnRate()/args`（**无未来函数**：`ma`/`pctChange` 只看今天之前）。
- 执行环境：宿主三段式（worker `plan` → 取净值 → worker `portfolio`），**5s 超时 `terminate()`**。
  沙箱的隔离强度与确认流程见 [pi 工具面#代码回测](/architecture/pi-tools)。
- 页面用浏览器 Worker（可以随时终止），service 用 `node:worker_threads`（`service/src/sandbox/`）。

## 验证

- **黄金 fixtures**：`frontend/src/services/backtest/__fixtures__/{engine,pyround,isoweek}.json`
  —— 迁移前从 Python 实现导出的输入/输出对，**两端各跑一遍**逐值比对
  （`frontend/src/__tests__/services/backtestEngine.test.ts` 与 `service/src/__tests__/services/core-golden.test.ts`）。
- **端到端**：`service` 的 `/api/backtest/*` 与页面回测在真实数据上出同样的数（例如组合 110022/161725/现金腿的 TWR 与各腿权重）。
- 已知怪癖（有意保留，改动会变更 UI 数字）：`day` 缺失时按「每月首交易日」；无交易日时最后一个定投日顺延；`lump_sum` 在对比里作为基准。
