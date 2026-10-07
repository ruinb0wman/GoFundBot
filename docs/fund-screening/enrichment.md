# 指标丰富化

「富化」= 在原始筛选数据上补三类字段：**风险指标**、**行业标签**、**排名与 4433 结论**。全部在 service 完成并落库。

## 1. 风险指标（`computeRiskMetricsLocal`）

- 代码：`packages/core/src/number.ts`（纯函数，前端与 service 同源）。
- 输入：该基金的**完整净值序列**（`/api/funds/:code/nav-history`，走 SQLite 缓存）；不足 10 个点直接返回全 null。
- 输出：`max_drawdown_1y`、`sharpe_ratio_1y`、`sharpe_ratio_3y`、`volatility_1y`、`calmar_ratio_1y`。
- 窗口：近一年需 200+ 交易日、近三年需 600+ 交易日，否则相应字段为 null（**null ≠ 0**，页面与工具都要按「没算出来」对待）。

执行方式（`screeningService.enrichScreening`）：

```ts
SELECT fund_code FROM screening_funds
 WHERE sharpe_ratio_1y IS NULL AND risk_attempted = 0 LIMIT 300   -- 一批
→ getFundNavBatch(codes)        // 并发 10，命中 SQLite 净值缓存
→ computeRiskMetricsLocal(...)  // 逐只
→ UPDATE ... risk_attempted = 1 // 无论成功失败都标记，避免死循环
```

- 每次 `/sync` 顺手跑首批；前端循环 `/compute` 到 `remaining = 0`。
- 需要重试取不到净值的基金时传 `{ retry: true }`（重置 `risk_attempted`）。

## 2. 行业标签（`classifyFundIndustry`）

- 代码：`packages/core/src/industryClassifier.ts`（规则表 `INDUSTRY_RULES`，按名称匹配）。
- 时机：写快照时算一次，`industry_tag_name` 为 null 才写（`COALESCE`），不覆盖已有值。
- 计数接口：`GET /api/screening/industry-tags` → 筛选面板的「板块」下拉；
  按标签过滤仍走 `/query` 的 `industry_tags`。

## 3. 排名与 4433

`recomputeRanks()`（`/sync` 末尾与 `/ranks` 调用）：

1. 按 `fund_type` 分组（缺省 `(untyped)`）；组内 < 3 只 → 全部排名为 null、`pass_4433 = 0`；
2. 每个周期在**有该周期收益**的样本里按收益降序算百分位 `i / n * 100`；该周期有效样本 < 3 → 该周期排名保持 null；
3. `check4433Rule` 判定 → `pass_4433`（0/1）。

算法唯一实现：`packages/core/src/screeningEnrich.ts`；判定细节见 [4433 法则](/fund-screening/4433-rule)。

## 4. 覆盖度怎么看

- `GET /api/screening/status`：`basic_count` / `risk_metrics_count` / `risk_metrics_pending` / `pass_4433_count` / `type_counts`。
- 页面顶部状态条显示「N 只基金 · M 完整」；`risk_metrics_pending > 0` 说明还有基金没算风险指标。
- pi：`get_screening_status` 或 `screen_funds`（`sharpe_ratio_1y` 为 null 表示未算出来，不是 0）。

## 5. 迁移前（历史）

前端在 `useScreeningDb.syncFromServer()` 里：拉全量 → 写 Dexie → `fillMissingRiskMetrics()` 逐只取净值算指标，
用 `localStorage` 记「指标算到哪天」；4433 在 `compute4433()` 里算完 `bulkPut`。
现在同样的算法在 service 跑一次、落一次库，所有消费者共用。
