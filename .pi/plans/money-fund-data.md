# 货币基金数据链路修复（方案 B）

状态：**已完成**。`bun run check` 全绿（service 226 tests / frontend 263 tests / docs build）。

## 根因

货币基金**没有单位净值序列**：东财 `pingzhongdata/<code>.js` 在 `ishb=true` 时不含
`Data_netWorthTrend` / `Data_ACWorthTrend`，只有

| 变量 | 含义 |
|---|---|
| `Data_millionCopiesIncome` | 每万份收益（日） |
| `Data_sevenDaysYearIncome` | 7 日年化 % |
| `Data_grandTotal` | 累计收益率 % |
| `syl_1y/3y/6y/1n` | 近 1 月/3 月/6 月/1 年收益 |

业绩走势 / 回撤修复 / 风险指标 / 回测 / 筛选富化全走净值序列 → 货币基金整片空白；
`estimate()` 内部回落到 `estimateFromPingZhongData()` → `navHistory()` → 抛
`Missing EastMoney variable Data_netWorthTrend`，所以 000682 连估值都取不到。
（另：腾讯 `web.ifzq.gtimg.cn/app/fund/funddaily` 已整体下线，对所有基金都返回
`Can't load controller:FundController`，货币基金实际只剩东财一条路。）

## 口径决定

1. **净值序列（`nav`）= 累计收益指数**：`nav_i = ∏(1 + 每万份收益_i / 10000)`，起点 ≈ 1。
   与官方 `Data_grandTotal` 一致（000682：实算 37.26% vs 官方 37.24%；近 1 年 1.465% vs 排行 1.46%）。
   → 图表 / 回撤 / 波动 / 回测 / 筛选富化一次性全部正确。
2. **货币基金真实单位净值恒为 1**：展示/成交/持仓层把 `dwjz` 覆写成 1（`isMoneyFund` 分支），
   展示口径换成「7 日年化 / 每万份收益」，绝不把这条指数当净值用。
3. **7 日年化 / 每万份收益端到端透出**。

## 改动清单

### service
- `types/fund.ts`：`FundEstimateDto` 增 `isMoneyFund` / `sevenDayYield` / `unitIncome`。
- 四个 provider 的 `estimate()` 补这三个字段（默认 false/null）。
- `eastmoneyFundProvider.ts`
  - `navHistory()`：`Data_netWorthTrend` 缺失且 `Data_millionCopiesIncome` 存在 → 货币分支合成序列；
    两者都没有才抛错。顺带把 `Data_ACWorthTrend` 改成 safeParse（缺累计净值不再拖垮整条序列）；
  - 新增 `buildMoneyFundNavPoints()`（复利累计指数 + `dailyReturn = 每万份收益/100`）与 `parseMoneyFundStats()`；
  - `estimateFromPingZhongData()` 改为**只取一次 script**（原先还要经 `navHistory` 二次取），
    货币基金返回 `nav=1 + 7日年化 + 每万份收益`。
- `fundService.toLegacyRealtimeEstimate()`（新增，`/api/fund/:code` 与 `/:code/compare-data` 共用）
  输出 `is_money_fund / seven_day_yield / unit_income`；`basic_info` 增 `is_hb`。
- `packages/core/src/number.ts`：`calcSharpe` 对**年化波动 < 0.1%** 返回 null。
  理由：σ→0 时 (R−Rf)/σ 会被极小分母放大成任意值 —— 货币基金会算出 **−121** 这种
  「除以 ~0 的假象」，不是业绩差；与已有的 `vol > 500` 荒谬值保护对称。

### frontend
- `types.ts` `RealtimeFund` 增 `isMoneyFund / sevenDayYield / unitIncome`。
- `useFundRealtimeBase.mapFundDetailToRealtime()`：识别货币基金 → `dwjz='1'`、
  `prevDwjz = 1 - 每万份收益/10000`（使「今日盈亏 = 份额 × 每万份收益/10000」成立）、
  `gszzl` 放 7 日年化、`gsz/gztime` 置空；`getFundNavByDate()` 对货币基金恒返回 1。
- `watchlistStore.refreshEstimates()` 映射三个字段，货币基金用 7 日年化占 `estimate_change` 位。
- `FundListItems.vue` / `FundRealtime.vue` / `FundBasicInfo.vue`：货币基金展示
  「7 日年化 + 每万份收益」；`FundBasicInfo` 顺带修掉 `最大回撤 0` 显示成 `-0.00%`。
- `FundChart.vue`：最大回撤为 0 时显示「无回撤」而非「正在修复中...」。
- **`useFundRealtimeData.fetchFundData()` 修两层信封解包**（`?.data` → `?.data?.data`）：
  这是**先前就存在的 bug**，实时页卡片对**所有**基金都把信封当载荷 → 基金名显示成代码、
  单位净值/涨跌全是 `-`。用户没有实时组合数据所以一直没暴露。
  （真机用「拦截 `/api/user/portfolio/funds` + 注入 000682/000961」复现与验证，未写用户数据。）

## 验证

- `bun run check`：service 226 tests、frontend 263 tests（+5）、docs build 全绿。
  新增测试：货币基金 navHistory/estimate（service provider）、`mapFundDetailToRealtime` +
  持仓公式（frontend）、`fetchFundData` 两层解包（frontend，反向验证过会失败）、
  `calcSharpe` 近零波动、watchlist 货币基金映射。
- 真机（bow，真实 service + 前端）：
  - `/fund/000682` 头部 `7日年化 1.32% / 每万份收益 0.3604`；业绩走势有曲线（近 1 年 +1.45%）；
    回撤修复 `0.00% / 无回撤`；夏普 `--`、回撤 `0.00%`、波动 `0.01%`。
  - `/` 自选行：000682 → `0.3604`（每万份收益）+ `1.32%`（title=7日年化）；其余基金不变。
  - 实时页卡片（注入数据）：000682 → `1.32% / 7日年化 / 每万份收益 0.3604`；
    000961 → `-1.07% / 已更新净值涨跌 / 单位净值 1.5609`。
  - 普通基金回归 `/fund/000961`：头部 `涨跌幅 +0.29% / 单位净值 1.5778`、
    夏普 −0.41、回撤 −12.34%、波动 16.93% —— 与改动前一致。
- 筛选库：`retry` + 分批 `/compute` 后货币型 500 只 `max_drawdown_1y=0`、`volatility_1y≈0.01~0.04`，
  `sharpe_ratio_1y` 为 null（近零波动保护）。总风险指标 2697 → 2699。

## 已知取舍 / 遗留

- 货币基金 `nav`（净值序列）语义 = 累计收益指数。已覆盖的展示/成交面见上；
  **未覆盖**：`useMyPositions` 的成本自动带出走 `/api/fund/:code/trend`（没有 `isMoneyFund` 标记），
  货币基金会填出 1.37 而不是 1。用户当前无持仓，暂不处理。
- `useFundComparison`（基金对比，`App.vue` 对比模式）**另有同类问题**：它读
  `response.data`（信封）且期望 `basic_info / scale_fluctuation / performance_evaluation`
  等 `/api/fund/:code` 才有的字段，却调的是 `/compare-data` —— 对比图表疑似整体失效。
  本次未动，另开任务。
