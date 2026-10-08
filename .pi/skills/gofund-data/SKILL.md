---
name: gofund-data
description: 查询 GoFundBot 的行情/板块/资金流/涨跌统计/指数K线/基金详情与净值/市场快讯，并做回测、基金筛选、读取用户策略与持仓。当用户问及 A 股大盘、板块热点、北向资金、主力资金、涨跌家数、某只基金/净值/持仓/基金经理、快讯、定投回测、4433 筛选、我的策略/持仓时使用。
---

# GoFundBot 数据与计算

这些工具由 `.pi/extensions/gofund/` 扩展从本仓库 service（默认 `http://localhost:8310`）拉取，
工具清单与口径的唯一真源在 `service/src/agent/tools*.ts`。
service 未启动时工具会明确报错 —— 如实转述，**不要据此编造数据**。

## 组合套路

- **看大盘**：`get_market_indices` 定基调 → 需要结构就 `get_hot_sectors` / `get_concept_sectors`；
  需要资金面就 `get_main_flow` / `get_north_flow` / `get_market_breadth`。
- **看单只基金**：`get_fund_detail` 一把拿全（净值走势 / 区间收益 / 排名 / 持仓 / 经理 / 资产配置）；
  只要净值序列（算回撤、波动、区间收益）用 `get_fund_nav_history`，带上起止日期更省上下文。
- **找基金**：`search_funds(keyword)`；**按条件挑基金**：`screen_funds(filters, sort_by)`
  （先 `get_screening_status` 看富化覆盖度：`risk_metrics_pending > 0` 时部分基金没有夏普/回撤值）。
  要刷新筛选库/重试失败项用 `refresh_screening(enrich_limit?, retry?)`（只写缓存、不动用户数据，但会联网；默认一批 300 只）。
- **回测**：`run_backtest`（单基金定投/价值平均/均线偏离）、`run_portfolio_backtest`（多资产+再平衡+现金腿）、
  `compare_backtest_strategies`（多策略对比+推荐）。返回的是抽样后的紧凑 JSON（含 summary 与少量 checkpoint）。
- **自由代码回测**：`list_strategy_scripts` 看已保存方案 → `run_strategy_code(script_name=...)` 直接跑；
  或自己写代码（`prepare(sdk)` 用 `sdk.screen()` 从本地基金库选池、`onDay(s)` 按基金代码逐日决策），
  想留档就 `save_strategy_script`。这三者都走 service 的隔离 worker（5s 超时），**执行/写入类需要确认令牌**。
- **看指数历史**：`get_index_kline(code, start_date, end_date)`，两个日期必填。
- **看资讯**：`get_flash_news(count)`。
- **用户自己的东西**：`list_strategies`（策略记忆）/ `get_positions`（持仓）/ `get_watchlist`（自选）—— 分析时先读，再结合行情给建议。
  写自选用 `add_to_watchlist(fund_code)` / `remove_from_watchlist(fund_codes)`（会改用户真实数据，需确认）。
- **告警与异动**：`get_alerts` 看用户设的规则与阈值；`save_alert` / `delete_alert` 改规则（需确认）；
  `check_alerts` 立即评估一遍（命中会写 `last_triggered` 并 6 小时冷却，避免刷屏）；
  `get_market_anomaly` 看当日指数/板块/成交额异动；`save_anomaly_config` 改判定阈值（需确认）。
  `price_*` 比的是实时估值涨跌幅，`return_*` 比的是**持仓收益率**（没有持仓的基金该规则不会触发）。
- **实时组合与交易**：`get_portfolio` 一次拿基金/分组/映射/**推导持仓**；`add_trade` 记一笔（金额与份额只传一个就行，会按净值换算）；
  当天净值未出就传 `status="pending"`，之后 `settle_trades(txn_ids)` 结算；`delete_trade` 删记录。
  分组用 `save_portfolio_group` / `delete_portfolio_group` / `assign_funds_to_group`（均需确认）。
  **持仓是推导值**（只有已结算交易计入；sell 减到 0 就整只消失），不是可以直写的字段。

## 口径与陷阱（必须遵守）

- `data_status: "unavailable"` 表示本次没取到数据 —— 如实说明，不要编造。
- 北向资金自 2024-08-19 起不再披露净流入：`*_net_inflow` **恒为 `null`，不能当 0**；
  只有 `*_deal_amount_yi`（亿元，当日成交总额）有效。
- 涨跌停家数 `limit_up` / `limit_down` 可能为 `null`，不是 0。
- 行业板块走同花顺降级时 `code` 为空串，此时成分股接口不可用。
- 概念板块的 `event_date` 是数据源标注的事件日期，可能早于当日，**不要当作行情日期**。
- `screen_funds` 的过滤语义：`max_drawdown_3m_max`/`_6m_max`/`_3y_max`/`_all_max` 实际都读近一年最大回撤（历史口径），
  `sharpe_ratio_1y` 为 null 表示该基金还没算风险指标（不是 0）。
- 日期一律 `YYYY-MM-DD`；费率/止盈止损/权重用小数（`0.2` = 20%）。
- 结果过大时工具会截断并提示 —— 缩小时间范围或减少 `limit` 重试，不要猜测被截掉的部分。

## 写操作要确认

`add_to_watchlist`、`remove_from_watchlist`、`save_alert`、`delete_alert`、`save_anomaly_config`、
`add_portfolio_fund`、`remove_portfolio_fund`、`save_portfolio_group`、`delete_portfolio_group`、`assign_funds_to_group`、
`add_trade`、`settle_trades`、`delete_trade`、
`save_strategy`、`delete_strategy`、`save_strategy_script`、`delete_strategy_script`
会改用户数据：第一次调用只返回 `confirm_required` + `__confirm_token`，
**必须先把要写入/删除的完整内容展示给用户并拿到明确同意**，再用**完全相同的参数**加上令牌重试。
令牌一次有效、参数改过就失效。

## 执行 / 写入类工具怎么确认

上面这些加 `run_strategy_code` 都是**执行/写入类**（`readOnly: false`）：
第一次调用不会真的执行，而是返回 `confirm_required` + `__confirm_token`。
**必须先把要执行/写入的内容完整展示给用户并取得明确同意**，再用**完全相同的参数**加令牌重调
（改一个字符令牌就失效，会重新要确认）。没跟用户确认过就不要调第二次。

## 边界

- 代码回测与页面 `/backtest` 走的是同一份引擎与缓存，数字应该一致；但页面还能画图、编辑代码，pi 只给数字。
- pi 改不了策略代码的**运行结果**（那是回测）；删除策略/方案用 `delete_strategy` / `delete_strategy_script`（需确认）。
