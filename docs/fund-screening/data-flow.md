# 数据流与回退机制

## 一、数据流路径

### 1.1 全量同步流程

```
前端 onMounted
  → useFundScreening → useScreeningDb.syncFromServer()
    → 检测 localStorage('screening-last-sync') 是否当日 9AM 前过期
    → 过期则 force=true
    → GET /api/screening/sync?force=true
      → screening.routes.ts
        → getFundScreeningSnapshot({ limitPerType: 500 })
          → cacheThrough(`fund:screening-snapshot:*`, TTL=次日9AM)
            → EastMoneyFundProvider.screeningSnapshot()
              → 遍历基金类型 (股票/混合/债券/指数/FOF/QDII)
              → 每类型 fetchFundRankingPage(type, page, 500, sort)
              → 合并去重 (appendUniqueFundItems)
              → 类型字段丰富: fetchFundCodeSearchList() 补充 fund_type
          → 返回 FundScreeningSnapshotDto
        → 每条 mapping: enrichResponseFund(code, name, snapshotItem)
          → 合并 snapshot + enrichmentMap (若有) → 返回基础字段
      → 返回 funds[]
    → 写入 IndexedDB: clear + bulkPut (基础数据)
    → 检测 localStorage('screening-risk-metrics-date') 是否今日已算过
      → 今天已算 + 非 force → 跳过 NAV batch
      → 未算过或 force → POST /api/funds/nav-batch
        → 服务端 getFundNavBatch(codes) → 并发 10 取 NAV 历史
        → 返回 { code: [{date, nav}] }
      → 前端 computeRiskMetricsLocal(navs) → 本地计算风险指标
      → bulkPut 写回 IndexedDB (含风险指标)
      → 存入 localStorage('screening-risk-metrics-date') = 今日日期
    → compute4433(): 按 fund_type 分组 → 计算 rank_pct → 标记 pass_4433
    → 完成
```

### 1.2 手动更新流程（遗留路径）

> 风险指标已由前端本地计算，不再依赖服务端 `enrichmentMap`。手动按钮保留作为遗留入口。

```
点击"更新数据" → openUpdateDialog() → 选择任务 → startUpdate()
  → POST /api/screening/update
    → runBatchUpdate()
      → getFundScreeningSnapshot() (同1.1)
      → 并发 10 条 enrichFund(code)
        → getFundNavHistory(code) → computeRiskMetrics(navPoints)
        → fetchFundCodeSearchList() → fund_type
        → classifyFundIndustry(name) → industry_tag
        → 写入 enrichmentMap
      → GET /api/screening/progress (轮询进度)
    → 完成 → 前端 syncFromServer() 刷新 IndexedDB
      → 同步时 force=true → 重新计算风险指标
```

### 1.3 筛选查询流程

```
用户点击"查询" → search(true)
  → 关键词搜索 → POST /api/screening/query (keyword)
    → searchFunds(keyword) → EastMoney 本地 searchList
    → enrichResponseFund → 返回
  → 条件筛选 → useScreeningDb.queryFunds(filters, sortBy, page)
    → IndexedDB 本地过滤: fund_type/industry_tag/return/sharpe... 等 30+ 条件
    → 内存排序 + 分页切片 → 返回前端
  → 表格渲染 (vxe-grid)
```

## 二、东方财富数据源

### 2.1 基金排行 API

```http
GET https://fund.eastmoney.com/data/rankhandler.aspx
?op=ph&dt=kf&ft={typeCode}&sc={sortField}&st=desc&pi={page}&pn={pageSize}
```

字段映射见 `Service/src/providers/eastmoney/eastmoneyFundProvider.ts:868` `mapRankingRow()`。

### 2.2 基金类型映射

| 前端分类 | ft 参数 | 说明 |
|---------|---------|------|
| 股票型 | `gp` | 股票型基金 |
| 混合型 | `hh` | 混合型（偏股/偏债/灵活/平衡） |
| 债券型 | `zq` | 债券型 |
| 指数型 | `zs` | 股票指数 |
| QDII | `qdii` | QDII |
| FOF | `fof` | FOF |
| 货币型 | `hb` | 货币型 |

### 2.3 搜索结果 API

基金搜索依赖内置 `fetchFundCodeSearchList()`（`eastmoneyFundProvider.ts:635`），从东方财富缓存的基金代码列表中进行本地模糊匹配，支持代码、名称、拼音搜索。

## 三、数据持久化

四层存储：

| 层 | 位置 | 数据 | 生命周期 |
|----|------|------|---------|
| 后端内存 | `enrichmentMap` | 丰富化结果（遗留） | 进程生命周期，非必需 |
| 后端缓存 | `MemoryCache` | 排行快照 + NAV 历史 | 排行快照 TTL→次日9AM，NAV 24h |
| 前端 IndexedDB | `db.screeningFunds` | 完整筛选数据（含风险指标） | 持久化，刷新不丢失 |
| 前端 localStorage | `screening-risk-metrics-date` | 风险指标计算日期标记 | 次日自动过期 |

## 四、回退机制

### 4.1 ProviderChain 多提供商降级

`ProviderChain`（`Service/src/core/providerChain.ts:9`）对所有 provider 调用提供统一的降级机制：

```
try provider[0] → 失败 → try provider[1] → 失败 → ... → 全部失败抛异常
```

各操作对应的 Provider 链：

| 操作 | Provider 链 | 回退级数 |
|------|-------------|---------|
| `fund.screeningSnapshot` | `[eastMoneyFundProvider]` | 1 (无替代) |
| `fund.navHistory` | `[joinQuantFundProvider, tencentFundProvider, stockSdkFundProvider, eastMoneyFundProvider]` | 4 级 |
| `fund.search` | `[eastMoneyFundProvider]` | 1 |
| `fund.basic` | `[eastMoneyFundProvider]` | 1 |

对于 `getFundScreeningSnapshot`，虽然只有 EastMoney 一个 provider 实现 `screeningSnapshot`，但内部**分页容错**：

```typescript
// screeningSnapshot() 遍历每类型每页，独立 try/catch
for (const type of types) {
  try { firstPage = await fetchFundRankingPage(type, 1, ...) } catch { /* 记录失败，继续下一类型 */ }
  for (const pageBatch of chunkArray(pages, 4)) {
    await Promise.allSettled(pageBatch.map(page => fetchFundRankingPage(...)));
  }
}
```

类型字段补充（`fetchFundCodeSearchList`）失败时会**静默跳过**，不影响排行数据本身。

### 4.2 前端行业标签双保险

第一层：后端 `classifyFundIndustry(fundName)` 基于正则匹配实现（`industryService.ts:1`）：

```
/创新药|医疗|医药|生物|医美|健康/ → '医药医疗'
/新能源|光伏|风电|氢能|锂电|电池|能源/ → '新能源'
/半导体|芯片|集成电路|电子/ → '半导体/芯片'
/AI|人工智能|智能|机器人|大模型|算力/ → '人工智能'
... 共 19 条规则，最终未匹配 → '其他'
```

第二层（前端兜底）：当后端 tag 不足以满足前端分组需求时，`useFundScreening.ts:237` 使用 `fallbackSectorBuckets` 对任意 `industry_tag_name` 做二次分类：

```typescript
const fallbackSectorBuckets = [
  { name: '全球市场', patterns: ['全球', '海外', '港股', ...] },
  { name: '科技制造', patterns: ['科技', '半导体', '芯片', ...] },
  { name: '消费医药', patterns: ['消费', '食品', '饮料', ...] },
  { name: '周期资源', patterns: ['煤炭', '钢铁', '有色', ...] },
  { name: '金融地产', patterns: ['银行', '证券', '保险', ...] },
  { name: '固收与策略', patterns: ['债券', '纯债', '短债', ...] },
]
```

### 4.3 缓存策略

```
getFundScreeningSnapshot()
  → cacheThrough(`fund:screening-snapshot:{types}:{sort}:{pageSize}:{limitPerType}`, TTL)
    → TTL = getTtlUntil9AM()  // 到次日 9AM 的毫秒数
    → 命中 → 直接返回 cached 数据
    → 未命中 → 调用 loader → 写入缓存
```

前端绕过缓存：`?force=true` 参数会使后端 `cache.clear()`（`screening.routes.ts:154`），且前端 `isBefore9am()` 检测上次同步时间是否在当日 9AM 之前，自动触发强制刷新。

### 4.4 更新任务容错

手动更新时并发 10 条 `enrichFund(code)`，使用 `Promise.allSettled` + 独立 try/catch，单条失败不影响其他基金：

```typescript
await Promise.allSettled(chunk.map(async (fund) => {
  try { await enrichFund(fund.code); success_count++; }
  catch { fail_count++; }
}));
```

支持手动停止（`stopFlag = true`），已完成的写入 enrichmentMap，下次同步不会重复计算。

## 五、已知问题

1. **首次 NAV batch 耗时较长**：首次加载时服务端无 NAV 缓存，500+ 只基金约需几十秒（服务端并发 10 + 缓存写入），之后 24h 内秒级。
2. **行业分类依赖名称**：`classifyFundIndustry()` 基于基金名称关键词匹配，部分跨界基金分类可能不准确。
3. **服务端 enrichmentMap 降级**：`enrichmentMap` 不再是风险指标的必需路径，前端本地计算已覆盖。服务重启不影响筛选数据。
