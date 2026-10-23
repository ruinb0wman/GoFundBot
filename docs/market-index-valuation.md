# 指数估值 (Index Valuation — PE 分位)

## 一、概述

指数详情页（`/index/:code`）底部新增一块「估值」卡片，展示：

| 字段 | 含义 |
|---|---|
| 当前 PE | 加权滚动市盈率（TTM） |
| 分位 | 当前 PE 在该指数**全部可得周频历史**中的排名（0% = 窗口最低，100% = 窗口最高） |
| 机会值 / 中位值 / 危险值 | 窗口内 PE 的 **20% / 50% / 80% 分位值** |

> ⚠️ 「机会/危险」是命名习惯，不是目标价、也不是买卖信号。卡片上固定展示来源、口径、窗口与点数。

**只覆盖 A 股股票指数**，且以数据源收录为准。未覆盖时卡片显示「暂无估值数据（…）」，不显示 0。

## 二、数据流路径

```
前端 IndexValuation.vue（onMounted / indexCode 变化）
  → marketAPI.getIndexValuation(code)
    → GET /api/market/index/:code/valuation
      → market.routes.ts → getIndexValuation()          (service/src/services/valuationService.ts)
        → normalizeIndexSymbol('1.000300'|'000300') → 'sh000300'
        → toDanjuanCode('sh000300') → 'SH000300'        （非 sh/sz → 直接 unavailable）
        → fetchIndexPeHistory()                          (providers/danjuan/danjuanValuationClient.ts)
            GET https://danjuanfunds.com/djapi/index_eva/pe_history/SH000300?day=all
            直连 6s → 失败退一次代理 8s → 仍失败则抛
        → buildValuationBands()                          (packages/core/src/valuation.ts)
        → 缓存 6h（unavailable 不缓存）
  → 卡片：5 个数值 + 纯 CSS 分位条 + 一行口径说明
```

### 关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| Route | `service/src/routes/market.routes.ts` | `GET /api/market/index/:code/valuation` |
| service | `service/src/services/valuationService.ts` | 代码映射、取数、分位/分档组装、6h 缓存、降级 |
| Provider | `service/src/providers/danjuan/danjuanValuationClient.ts` | 蛋卷 `pe_history` 解析（直接/代理两条路） |
| 计算 | `packages/core/src/valuation.ts` | `quantile` / `percentileRank` / `buildValuationBands` |
| DTO | `service/src/types/valuation.ts` | `IndexValuationDto` |
| 缓存 | `service/src/core/cache.ts` | `ttl.marketValuation` = 6h |
| frontend API | `frontend/src/services/api.ts` | `marketAPI.getIndexValuation()` |
| frontend 渲染 | `frontend/src/components/IndexValuation.vue` | 卡片（自取数，三态：loading / available / unavailable） |
| 挂载点 | `frontend/src/components/IndexDetail.vue` | `.stats-section` 之后 |

## 三、口径（跨源不可比）

**同一指数的 PE 会因口径差 1–2 倍**，实测（2026-10-22）：

| 指数 | 蛋卷（本页用） | 乐咕 加权滚动 | 乐咕 等权滚动 | 中证官方 |
|---|---|---|---|---|
| 沪深300 | 12.73 | 12.06 | 28.62 | 13.76 |
| 中证1000 | 37.53 | 25.70 | 53.62 | 29.46 |
| 科创50 | 106.02 | 64.22 | 72.25 | 85.68 |

- **分位窗口也是口径的一部分**：沪深300 同一口径下，全历史（2005 起）分位 41%、近 10 年 50%。
- 因此本项目**只用蛋卷一个源**，不接备源、不做多源平均 —— 混用会得到「谁都不认」的数字。
- 分位算法：`count(pe < 当前) / n`（并列不取中点）。蛋卷自带 `pe_percentile` 是它内部日频算的 0.498，我们按周频复现 0.496。
- 三档带值：线性插值分位数（等价 Excel `PERCENTILE.INC`）。
- 时间戳按**北京时间**格式化：数据源的 `ts` 是北京 00:00（UTC 前一天 16:00），直接 `toISOString()` 会退一天。

## 四、覆盖范围

数据源收录 63 个指数（A 股宽基/行业/主题 + 恒生/纳指/标普/DAX），本项目**只开放 A 股 sh/sz**：

- 有数据：`sh000300` 沪深300、`sz399001` 深证成指、`sz399006` 创业板指、`sh000688` 科创50、`sh000905` 中证500、`sh000852` 中证1000、`sh000016` 上证50、`sh000922` 中证红利、`sz399986` 中证银行、`sz399997` 中证白酒 等。
- **没有数据**（显示「暂无」）：`sh000001` **上证指数**、`sh000510` 中证A500、`sh000698` 科创100、`sz399673` 创业板50、`sz399005` 深证100。
  - 不要用乐咕「沪市平均市盈率」（15.94）冒充上证指数（中证官方 14.93，历史分位完全不同）。

## 五、降级与缓存

- 任何失败都返回 `200` + `data_status: 'unavailable'`（与 `/market/breadth`、`/market/north-flow` 同一约定），DTO 里的数字是 `null`，**不是 0**。
- `unavailable` **不进缓存**：一次瞬时失败不该被钉住 6 小时。
- 成功结果缓存 6h（估值日更，盘中刷新没有意义）。
- 数据源改版/加鉴权时：日志出现 `index valuation unavailable`，页面显示「暂无估值数据（…）」。

## 六、验收

```bash
# 有数据
curl -s localhost:8310/api/market/index/sh000300/valuation | jq '.data | {pe, percentile, bands, as_of, window}'
# → pe 12.73 / percentile 0.4961 / bands {11.74, 12.74, 14.18} / as_of 2026-10-22 / points 516

# 未收录
curl -s localhost:8310/api/market/index/sh000001/valuation | jq '.data | {data_status, error}'
# → {"data_status":"unavailable","error":"数据源未收录该指数"}

# 非 A 股
curl -s localhost:8310/api/market/index/BTC/valuation | jq '.data | {data_status, error}'
# → {"data_status":"unavailable","error":"仅支持 A 股股票指数"}
```

页面：`/index/sh000300` 底部出现估值卡（5 个数值 + 分位条 + 口径行）；`/index/sh000001` 显示「暂无估值数据」。

## 七、不做的事

- 不做 pi 工具 `get_index_valuation`（P2，未排期）。
- 不做基金详情页的 PE / 三档带值（P3，否决：只有 ~13% 的指数基金能映射到有估值的指数，主动基金的组合 PE 语义错位）。
- 不做估值历史折线图、PB/股息率/ROE、低估/高估标签、告警联动。
