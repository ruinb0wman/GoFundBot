# 基金数据合并策略

## 多源异构数据合并

不同 Provider 能力参差不齐，系统按**能力交集**和**能力差集**区分处理：

```
stock-sdk:          estimate │ navHistory │ rankHistory │ dividends
eastmoney:          estimate │ navHistory │ rankHistory │ dividends │ search │ basic │
                    holdings │ managers │ assetAllocation │ performance │
                    screeningSnapshot │ subscriptionRedemption │ holderStructure │
                    scaleFluctuation │ positionTrend │ totalReturnTrend

合并规则:
  ┌─ 数据有 Provider 交集 (estimate/nav/rank/dividends) → ProviderChain 自动降级
  └─ 数据仅 eastmoney 提供 → 直接使用 eastmoney only
```

## 基金详情 16 段并行合并

`getFundDetail()` 将 16 个数据段作为独立请求并行执行，每个段独立处理失败：

```
results = await Promise.allSettled(sections.map(...));

for (r of results):
  if (fulfilled) → sections[key] = { data, provider, fallback, cached, updatedAt }
  if (rejected)  → sections[key] = { data: null, error: { code: 'SECTION_FAILED', message } }
                   failedSections.push(section)

return {
  data: { code, sections, failedSections, provider: 'mixed', updatedAt },
  provider: 'mixed',
  fallback: providers.some(p => p === 'eastmoney'),
};
```

**关键设计**：
- 16 个段共享同一个 12s 超时阈值（`DETAIL_SECTION_TIMEOUT_MS = 12000`）
- 响应体包含 `failedSections` 数组，前端可据此选择局部重试
- `provider: 'mixed'` 表示数据来源混合
- 响应返回后通过 `setImmediate` 触发后台 `enrichFund()`，不阻塞用户

## 筛选数据富化 (Screening Enrichment)

> 风险指标 / 行业分类 / 4433 排名自 P3.3 起在 **service** 完成，落 SQLite `screening_funds`。
> 算法本体在 `packages/core`（`number.ts` 的风险指标、`industryClassifier.ts`、`screeningEnrich.ts`），前端与 service 共用。

```typescript
// service: screeningService.syncScreening → 富化
// 1. /api/screening/sync 拉原始清单（fund_code / returns / nav ...）写 screening_funds
// 2. classifyFundIndustry(fund_name) → 行业标签
// 3. recomputeRanks() → 按 fund_type 分组的百分位 + 4433
// 4. enrichScreening()（分批 300）→ computeRiskMetricsLocal(净值得自 nav_history) 写回
// 前端：useScreeningDb 只是薄客户端（/sync → 循环 /compute → /query）
```

  enrichmentMap.set(code, {
    fund_type: fundListItem?.type ?? null,              // 基金类型
    industry_tag: classifyFundIndustry(name),           // 行业标签（19 类）
    ...computeRiskMetrics(navPoints),                   // 风险指标
    updated_at: new Date().toISOString(),
  });
}
```

**富化包含的字段**：

| 字段 | 来源 | 计算方式 |
|------|------|---------|
| `fund_type` | `fetchFundCodeSearchList()` | 东方财富基金分类（股票/混合/债券/指数/货币/FOF/QDII 等） |
| `industry_tag` | `classifyFundIndustry(name)` | 正则匹配基金名称 → 19 个行业类别（科技/医药/消费/新能源/军工等） |
| `max_drawdown_1y` | `computeRiskMetrics()` | 最近 1 年最大回撤率 |
| `sharpe_ratio_1y` / `sharpe_ratio_3y` | `computeRiskMetrics()` | 1 年/3 年夏普比率 |
| `volatility_1y` | `computeRiskMetrics()` | 1 年年化波动率 |
| `calmar_ratio_1y` | `computeRiskMetrics()` | 1 年 Calmar 比率 |

## 缓存层合并

```
cacheThrough(key, TTL, loader):
  → cache.get(key) 命中?
     → 是 → 返回 { value, cached: true, updatedAt }
     → 否 → value = await loader()
           → cache.set(key, value, TTL)
           → 返回 { value, cached: false, updatedAt }

筛选快照特殊处理:
  TTL = getTtlUntil9AM() // 自适应到次日 9:00 AM 过期
```

## 分级合并路径

```
┌─ 单只基金详情:  16 sections 并行 → 各走自己的 cache + ProviderChain
├─ 基金列表/筛选:  screeningSnapshot 全量拉取 → service 富化并落 SQLite（screening_funds）
├─ 基金搜索:      内存缓存 full list → 客户端 JS 匹配+排序
└─ 基金估值:      批量 API → 内存缓存 30s → 逐只匹配
```
