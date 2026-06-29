# Section 7: DataService Migration Wrap-up — Execution Plan

> 创建: 2026-06-29 | 关联文档: `docs/优化与待完善功能清单.md §7`

## 现状基线

DataService 在文档撰写后已获得大量实现。Section 7 中列出的 6 个"缺失" provider 方法中有 6 个现已存在（7.2 部分完成）。计划聚焦于文档撰写后仍未实现的剩余桩代码及清理工作。

| 检查清单项 | 现状 | 桩代码位置 |
|-----------|------|-----------|
| 7.2a `rankHistory` (eastmoney) | 桩代码 | `eastmoneyFundProvider.ts:229` |
| 7.2b `dividends` (eastmoney) | 桩代码 | `eastmoneyFundProvider.ts:233` |
| 7.4 `AkShareMarketProvider` | 全量桩代码 | `akshareMarketProvider.ts:31-77` |
| 7.5 `EastMoneyMarketProvider.quotes` | 桩代码 | `eastmoneyMarketProvider.ts:21` |
| 7.5 `EastMoneyMarketProvider.kline` | 桩代码 | `eastmoneyMarketProvider.ts:25` |
| 7.1 completeness score | 硬编码为 70 | `fund_routes.py:102` |

---

## Phase 1: EastMoney Fund rankHistory + dividends 实现

**前置条件:** DataService 可构建、测试可运行。已有 `eastmoneyRequest.ts` 及 `fetchJson`/`fetchText` 工具函数。

### 任务

#### 1a — 在 eastmoneyFundProvider 中实现 `rankHistory`

**数据源:** `https://fund.eastmoney.com/pingzhongdata/{code}.js` (已在 `fetchFundDetailScript` 中使用)

**在脚本中定位数据:**
- `Data_rateInSimilarPersent` — 数组 `[[timestamp, percentile], ...]`
- `Data_rateInSimilarFoundType` — 数组 `[[timestamp, rank], [timestamp, rank], ...]`

**实现:**
```
async rankHistory(code: string): Promise<FundRankHistoryDto> {
  const script = await this.fetchFundDetailScript(code);
  const percentileData = safeParseJsJson<number[][]>(script, 'Data_rateInSimilarPersent', []);
  const rankingData = safeParseJsJson<number[][]>(script, 'Data_rateInSimilarFoundType', []);

  // 分别构建 date → 值的 map
  // 对两个序列按日期合并为 { date, percentile, rank } 条目
  // 返回 { code, name, items: FundRankPointDto[] }
}
```

**FundRankPointDto 结构** (来自 `fund.ts`): `{ date, timestamp, rank, total, percentile }`

#### 1b — 在 eastmoneyFundProvider 中实现 `dividends`

**数据源:** 东方财富基金分红接口

**API endpoint:** `https://fundf10.eastmoney.com/fhsp_{code}.js` 的 JSON 变体，或 `https://api.fund.eastmoney.com/f10/FundFHSP?fundCode={code}`

**备选:** 用 spider 路径获取 `https://fundf10.eastmoney.com/fhsp_{code}.html`，提取 HTML 中嵌入的分红数据 JSON。

**FundDividendDto 结构:** `{ code, name, equityRecordDate, exDividendDate, dividendPerShare, payDate, dividendType }`

### 验证检查清单

- [ ] `npm run typecheck` 通过
- [ ] `npm test` — 所有现有测试通过
- [ ] 对已知基金代码手动验证 curl：
  ```
  curl http://localhost:3100/api/funds/000001/rank-history
  curl http://localhost:3100/api/funds/000001/dividends
  ```
  → 两者均返回 200 JSON，`items` 数组非空
- [ ] `rankHistory` 条目含 date + rank + percentile
- [ ] `dividends` 条目含 exDividendDate + dividendPerShare

**回滚:** 无数据库变更。直接还原 `eastmoneyFundProvider.ts` 即可。

---

## Phase 2: EastMoney Market Provider — quotes + kline 实现

**前置条件:** Phase 1 完成。已有 `eastmoneyMarketProvider.ts` 含 `sectors`/`indices` 等可参照的 API。

### 任务

#### 2a — 实现 `quotes(symbols: string[])`

**数据源:** `https://push2.eastmoney.com/api/qt/ulist.np/get`

**参数映射:**
- `secids` = 以逗号连接的入参 symbols（格式: `sh000001,sz399001,sh000300,...`）
- `fields` = `f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18` (price、change%、change、volume、amount、code、name、high、low、open、preClose)
- `fltt=2`, `invt=2`

**实现:**
```
async quotes(symbols: string[]): Promise<MarketQuoteDto[]> {
  const secids = symbols.join(',');
  const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get';
  const params = new URLSearchParams({
    fltt: '2', invt: '2',
    fields: 'f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18',
    secids,
  });
  const resp = await fetchJson(`${url}?${params}`);
  const diff = (resp.data?.diff ?? []) as Record<string, unknown>[];
  return diff.map(mapToMarketQuoteDto);
}
```

**symbol 格式规范:** `sh000001`（小写 sh/sz 前缀 + 6 位代码）

#### 2b — 实现 `kline(symbol: string, options: KlineOptions)`

**数据源:** `https://push2his.eastmoney.com/api/qt/stock/kline/get` (历史日K线) 或 `https://push2.eastmoney.com/api/qt/stock/trends2/get`（日内分时）。市场报价场景使用日 K 线端点。

**Parameters:**
- `secid` = `1.{code}` (沪市) 或 `0.{code}` (深市)，从 symbol 映射
- `klt` = `101` (日), `102` (周), `103` (月)，从 `options.period` 映射
- `fqt` = `1` (前复权 qfq), `2` (后复权 hfq), `0` (不复权)，从 `options.adjust` 映射
- `beg`/`end` = 可选 begin date / end date (YYYYMMDD)
- `fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11`、`fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`

**KlineDto 结构:** `{ code, date, time, timestamp, open, close, high, low, volume, amount, change, changePercent, turnoverRate }`

### 验证检查清单

- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过
- [ ] curl 验证：
  ```
  curl "http://localhost:3100/api/market/quotes?symbols=sh000001,sz399001"
  curl "http://localhost:3100/api/market/kline/sh000001?period=daily&adjust=qfq"
  ```
  → 均返回 200，quotes 有 price/change/name 等字段，kline items 数组非空
- [ ] Phase 1 回归：rankHistory + dividends 仍可用

**回滚:** 还原 `eastmoneyMarketProvider.ts` 即可。

---

## Phase 3: ProviderChain 后备连接

**前置条件:** Phase 1 + 2 完成。

### 任务

#### 3a — 基金 rankHistory 链路添加 eastmoney 后备

**文件:** `DataService/src/services/fundService.ts`

**现状 (line 167):**
```typescript
const chain = new ProviderChain<FundProvider>([stockSdkFundProvider]);
```

**新:**
```typescript
const chain = new ProviderChain<FundProvider>([stockSdkFundProvider, eastmoneyFundProvider]);
```

#### 3b — 基金 dividends 链路添加 eastmoney 后备

**文件:** `DataService/src/services/fundService.ts`

**现状 (line 180):**
```typescript
const chain = new ProviderChain<FundProvider>([stockSdkFundProvider]);
```

**新:**
```typescript
const chain = new ProviderChain<FundProvider>([stockSdkFundProvider, eastmoneyFundProvider]);
```

#### 3c — 市场 quotes 链路添加 eastmoney 后备

**文件:** `DataService/src/services/marketService.ts`

将 `eastmoneyMarketProvider` 在 `stockSdkMarketProvider` 之后加入 ProviderChain 中（不影响第二位的 akshare 桩代码 — Phase 4 中处理）。

#### 3d — 市场 kline 链路添加 eastmoney 后备

**文件:** `DataService/src/services/marketService.ts`

同上，将 `eastmoneyMarketProvider` 加入 kline ProviderChain。

### 验证检查清单

- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过
- [ ] 集成测试：`curl http://localhost:3100/api/funds/000001/detail` → `failedSections` 不再包含 `rankHistory` 或 `dividends`
- [ ] `curl http://localhost:3100/api/market/quotes?symbols=sh000001` → 返回数据，不抛错
- [ ] `curl http://localhost:3100/api/market/kline/sh000001?period=daily` → 返回 K 线数据

**回滚:** 从各 ProviderChain 中移除 eastmoney provider 即可。

---

## Phase 4: AkShare 废弃及清理

**前置条件:** Phase 2 + 3 完成（eastmoney 行情/K 线在经过验证的生产环境中可作为后备）。

### 任务

#### 4a — 从 marketService ProviderChain 中移除 AkShareMarketProvider

**文件:** `DataService/src/services/marketService.ts`

将 `akshareMarketProvider` 从所有 ProviderChain 定义中移除。market 链路变为：
```
stock-sdk → eastmoney
```

#### 4b — 删除 AkShareMarketProvider 桩代码文件

**文件:** `DataService/src/providers/akshare/akshareMarketProvider.ts`

检查 marketService 或 index.ts 中是否还有 import 残留，一并清理。

#### 4c — 清理 Backend akshare 残留引用

- `Backend/services/market_data.py` (标记为 `# DEPRECATED:`) — 暂不删除（6.2 延期），但确认不再有活跃调用路径
- 检查 akshare 是否仍作为 market routes 的最终后备被引用

#### 4d — 更新 DataService index.ts 中的 provider 注册

从 provider registry 中移除 `akshareMarketProvider` 导出。

### 验证检查清单

- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过
- [ ] 代码库中不再有 `akshareMarketProvider` 的 import（`marketService.ts`、`index.ts` 等）
- [ ] 代码库中不再有 `akshare/` import（`providers/index.ts`/registry 等）
- [ ] `DISABLE_AKSHARE_FALLBACK=1` 环境变量若无其他消费者则同时移除（`AGENTS.md`、`README.md`、`marketService.ts`）
- [ ] Phase 3 回归：quotes + kline 仍可用（stock-sdk 优先，eastmoney 后备）

**回滚:** `git revert` 本阶段 commit。

---

## Phase 5: 完整性评分升级

**前置条件:** Phase 1-4 完成。

### 任务

#### 5a — 验证检查清单 7.1 的实际完整性

**文件:** `Backend/routes/fund_routes.py:95-105`、`Backend/routes/fund_routes.py:62-92`

`_validate_data_service_fund_quality()` 所检查的项目：
- `basic_info.fund_code` / `fund_name` ← 已在 ✓
- `realtime_estimate` ← 已在 ✓
- `net_worth_trend` ← 已在 ✓
- `portfolio.stock_codes` ← 已在 ✓
- `risk_metrics` ← 由 navHistory 计算 ✓
- `performance` (1_year/1_month/3_month/6_month) ← 在 ✓
- `asset_allocation` ← 已在 ✓

**尚未被检查的内容（数据服务实际返回但质量门禁未验证的内容）：**
- `ranking_trend` / `ranking_percentage` (rankHistory)
- `subscription_redemption`
- `holder_structure`
- `scale_fluctuation`
- `position_trend`
- `total_return_trend`
- `fund_managers`
- `same_type_funds`
- `performance_evaluation`
- `dividends`

#### 5b — 升级 `_validate_data_service_fund_quality()`

增加检查项：
- `ranking_trend` 数组非空
- `scale_fluctuation` 非空或含 categories
- `fund_managers` 数组 items[0] 含 name
- `performance_evaluation` 含 data 或 avr

#### 5c — 将 `completeness_score` 从硬编码的 70 升级为从质量校验计算的实际值

```python
checks_total = len(checks)
checks_passed = checks_total - len(issues)
completeness_score = int(checks_passed / checks_total * 100)
```

#### 5d — 在质量门禁中提高 `auto` 模式下对 DataService 的接受度

**文件:** `Backend/routes/fund_routes.py:440-466`

当前仅在所有检查项全部通过时才使用 data_service。可调整为允许关键字段（basic_info、estimate、nav、performance、portfolio）全部就绪即视为满足条件，非必要字段可缺失。

### 验证检查清单

- [ ] `python -m pytest Backend/tests/test_data_service_client.py -v` 通过（如有适配）
- [ ] 实际请求中 `_data_source.completeness_score` > 85
- [ ] `source=auto` 在 DataService 启动时质量门禁通过（而非回退至 legacy）
- [ ] `source=legacy` 仍可正常工作（回归）

**回滚:** 还原 `fund_routes.py` 中的变更。

---

## Phase 6: 最终验证及 `FUND_DEFAULT_SOURCE` 切换

**前置条件:** Phase 5 完成，`auto` 模式质量门禁实际通过。

### 任务

#### 6a — 全服务端到端冒烟测试

1. 三服务全量启动（`DataService` → `Backend` → `Frontend`）
2. 测试基金详情页：使用代码 `000001` 发起 `/api/fund/000001?source=data_service`
   - 验证所有 16 个 section 返回数据（`failedSections` 为空或仅非关键字段缺失）
3. 测试市场页面：`/api/market/overview`、`/api/market/sectors`、`/api/market/index`
4. 测试搜索：`/api/fund/search?q=沪深300`
5. 测试自选列表：`/api/watchlist`
6. 测试筛选：`/api/screening/strategies`
7. 测试 AI 分析：`/api/fund/000001/analyze`

#### 6b — 更新默认 `FUND_DEFAULT_SOURCE`

在 `Backend/.env.example` 中添加注释：
```ini
# 数据源模式（默认: data_service）
# data_service — 全量通过 DataService
# auto — DataService 优先，质量不达标时回退 legacy
# legacy — 旧 fund_api.py 路径
FUND_DEFAULT_SOURCE=data_service
```

将 `fund_routes.py:426` 默认值更新为：
```python
source = os.environ.get("FUND_DEFAULT_SOURCE", "data_service").strip().lower()
```

#### 6c — 同步更新文档

- `README.md` — 近期演进章节，反射 Section 7 改变
- `AGENTS.md` — 数据流规范章节，将默认值从 `legacy` 更新为 `data_service`
- `docs/优化与待完善功能清单.md` — 将 Section 7 标记为 ✅ 完成

### 验证检查清单

- [ ] `source=legacy` 仍可正常工作（降级路径）
- [ ] `source=data_service` 在无 DataService 运行时正确报错、不回退
- [ ] `source=auto` 在 DataService 启动时使用 data_service、不可用时回退并正常降级
- [ ] 前端在无额外 source 参数请求 `/api/fund/000001` 时正确使用 `data_service`
- [ ] CI 通过：ruff lint、ruff format --check、python unittest、vitest、vue-tsc

**回滚:** 还原 `.env.example` 默认值及 `fund_routes.py`。

---

## 恢复点汇总

每完成一个 Phase 即以该 phase 的描述创建 git commit（除非明确要求不提交）。若被中断：

| 从…继续 | 运行以验证状态 |
|---------|--------------|
| Phase 1 之后 | `curl localhost:3100/api/funds/000001/rank-history` → 应返回数据 |
| Phase 2 之后 | `curl localhost:3100/api/market/quotes?symbols=sh000001` → 应返回数据 |
| Phase 3 之后 | `curl localhost:3100/api/funds/000001/detail` → failedSections 不应含 rankHistory/dividends |
| Phase 4 之后 | `rg akshareMarketProvider DataService/src/` → 不应有结果 |
| Phase 5 之后 | `curl "localhost:5000/api/fund/000001?source=data_service"` → `_data_source.completeness_score` > 85 |
| Phase 6 之后 | `curl localhost:5000/api/fund/000001` (无 source 参数) → 默认使用 data_service |

## 涉及文件

| 文件 | Phases | 变更类型 |
|------|--------|---------|
| `DataService/src/providers/eastmoney/eastmoneyFundProvider.ts` | 1 | 新增 2 个方法 |
| `DataService/src/providers/eastmoney/eastmoneyMarketProvider.ts` | 2 | 新增 2 个方法 |
| `DataService/src/services/fundService.ts` | 3 | ProviderChain 添加 eastmoney |
| `DataService/src/services/marketService.ts` | 3, 4 | ProviderChain 变更、移除 akshare |
| `DataService/src/providers/akshare/akshareMarketProvider.ts` | 4 | **删除** |
| `DataService/src/providers/index.ts` (或 registry) | 4 | 移除 import |
| `Backend/routes/fund_routes.py` | 5, 6 | 质量校验、默认值 |
| `Backend/.env.example` | 6 | 默认值注释 |
| `README.md` | 6 | 文档同步 |
| `AGENTS.md` | 6 | 文档同步 |
| `docs/优化与待完善功能清单.md` | 6 | 标记完成 |
