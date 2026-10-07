---
name: gofund-data
description: 查询 GoFundBot 的实时行情、行业与概念板块、资金流、涨跌统计、指数 K 线、基金详情与净值、市场快讯。当用户问及 A 股大盘、板块热点、北向资金、主力资金、涨跌家数、某只基金/净值/持仓/基金经理、市场快讯时使用。
---

# GoFundBot 数据查询

这些工具通过 `.pi/extensions/gofund/` 扩展直接读本仓库的 service（默认 `http://localhost:8310`），全部只读。
service 未启动时工具会明确报错 —— 如实转述，**不要据此编造数据**。

## 组合套路

- **看大盘**：`get_market_indices` 定基调 → 需要结构就 `get_hot_sectors` / `get_concept_sectors`；
  需要资金面就 `get_main_flow` / `get_north_flow` / `get_market_breadth`。
- **看单只基金**：`get_fund_detail` 一把拿全（净值走势 / 区间收益 / 排名 / 持仓 / 经理 / 资产配置）；
  只要净值序列（算回撤、波动、区间收益）用 `get_fund_nav_history`，带上起止日期更省上下文。
- **找基金**：`search_funds(keyword)`。
- **看指数历史**：`get_index_kline(code, start_date, end_date)`，两个日期必填。
- **看资讯**：`get_flash_news(count)`。

## 口径与陷阱（必须遵守）

- `data_status: "unavailable"` 表示本次没取到数据 —— 如实说明，不要编造。
- 北向资金自 2024-08-19 起不再披露净流入：`*_net_inflow` **恒为 `null`，不能当 0**；
  只有 `*_deal_amount_yi`（亿元，当日成交总额）有效。
- 涨跌停家数 `limit_up` / `limit_down` 可能为 `null`，不是 0。
- 行业板块走同花顺降级时 `code` 为空串，此时 `/market/sectors/:code/constituents` 不可用。
- 概念板块的 `event_date` 是数据源标注的事件日期，可能早于当日，**不要当作行情日期**。
- 日期一律 `YYYY-MM-DD`。
- 结果过大时工具会截断并提示 —— 缩小时间范围或减少 `limit` 重试，不要猜测被截掉的部分。

## 这里没有的能力

回测（`run_backtest` / `run_strategy_code` / 组合回测）、4433 筛选、行业分类/行业业绩、
「我的持仓」与已保存回测方案、联网搜索 —— 这些仍在 web 前端里（依赖浏览器 IndexedDB / Web Worker /
localStorage 里的 key）。需要这些能力时告诉用户去前端页面操作，不要假装能调用。
