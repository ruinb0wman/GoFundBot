# 行业板块排行 (Industry Sector Rankings)

## 一、概述

展示 A 股行业板块的涨跌幅排行，支持前 N 名显示、涨跌分布概览、展开全屏模态；缓存只在 service 内存里（TTL 15s），前端不再持久化。

## 二、数据流路径

```
GET /api/market/sectors?limit=90
  → market.routes.ts → getMarketSectorsFromAkshare()
    ├── getMarketSectors() — EastMoney 主数据源
    │     → EastMoneyMarketProvider.sectors()
    │       → push2.eastmoney.com 板块列表 + 行情
    │       → 成功 → 返回 + 缓存 30s
    └── Python akshare 回退
          → data_complete.py --source akshare --type sector_spot
          → 同花顺板块数据
    → 前端 SectorRank.vue → adaptiveRefresh + service 内存缓存（15s）
```

### 关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| Route | `service/src/routes/market.routes.ts:88` | `GET /api/market/sectors` |
| service | `service/src/services/marketService.ts:1003` | `getMarketSectorsFromAkshare()` 编排 |
| service | `service/src/services/marketService.ts:522` | `getMarketSectors()` EastMoney 主路 |
| service | `service/src/services/marketService.ts:1156` | `getMarketConceptSectorsFromAkshare()` 概念板块 |
| Provider | `service/src/providers/eastmoney/eastmoneyMarketProvider.ts:143` | `sectors()` 东方财富实现 |
| Python 回退 | `python/cli/data_complete.py` | `--source akshare --type sector_spot` |
| frontend API | `frontend/src/services/api.ts:106` | `getSectorRank()` |
| frontend 渲染 | `frontend/src/components/SectorRank.vue` | 排行列表 + 模态框 |
| 缓存 | `service/src/core/cache.ts:180` | `marketAkshare` TTL 30s |

## 三、东方财富 API 数据源

### 3.1 板块列表查询

```
GET https://push2.eastmoney.com/api/qt/clist/get
```

| 参数 | 值 | 说明 |
|------|----|------|
| `fs` | `m:90+t:2` | 行业板块分类（实测 `total=496`，含 Ⅱ/Ⅲ 级细分行业） |
| `fields` | `f12,f14` | 代码、名称 |
| `pz` | `100` | 单页条数：**东财硬上限 100**（传 200/500 也只回 100），取更多要 `pn` 翻页；provider 固定 `pn=1` |

### 3.2 板块行情查询

```
GET https://push2.eastmoney.com/api/qt/ulist.np/get
```

| 参数 | 值 | 说明 |
|------|----|------|
| `secids` | `90.BKxxxx,...` | 板块 secid（最多 200 个） |
| `fields` | `f2,f3,f4,f12,f14,f62,f8` | 价格、涨跌幅、主力净流、换手率 |

### 3.3 字段映射

| API 字段 | DTO 字段 | 说明 |
|---------|---------|------|
| `f12` | `code` | 板块代码（BK 开头） |
| `f14` | `name` | 板块名称 |
| `f2` | `price` | 最新价 |
| `f3` | `changePercent` | 涨跌幅 |
| `f62` | `mainNetInflow` | 主力净流入 |
| `f8` | `turnoverRate` | 换手率 |

## 四、回退方案：Python akshare

当东方财富接口不可用时自动降级：

```
Node.js → child_process.spawn → data_complete.py --source akshare --type sector_spot
  → akshare.stock_board_industry_summary_ths()
  → stdout JSON → Node.js 解析
```

回退数据来源为同花顺（ths），返回格式与 `SectorSpotItem` 一致，`source` 标记为 `akshare_ths`。

> 自 push2 `.../qt/clist/get` 被反爬切断起，这条回退就是**实际生效**的数据源（`akshare_thailand` 这个历史拼写已改为 `akshare_ths`）。
>
> **2026-10-09 更正**：「被反爬切断」实为**经代理**访问所致（`eastmoneyRequest.ts` 当时是 `proxy: 'auto'`）。
> 改 `never` 真直连后 `clist/get` 可用（`source: 'eastmoney'`，且 `code`/`main_inflow` 都有值），
> 但上游会限流，akshare 降级依旧是常态兑底（见 `.pi/plans/push2-resilience.md`）。

## 五、前端渲染

| 项 | 说明 |
|----|------|
| 组件 | `frontend/src/components/SectorRank.vue` |
| 数据刷新 | `useAdaptiveRefresh`（按交易时段调刷新间隔）+ service 内存缓存 |
| 涨跌分布 | 顶部概览条（上涨/平盘/下跌计数 + 比例条） |
| 排序 | 默认按涨跌幅降序，前 90 个板块 |
| 颜色规则 | 涨跌幅 ≥ 0 红色，< 0 绿色 |
| 主力净流 | 显示 `+/-XX亿` |
| 展开模态 | 全屏显示完整板块列表（`Maximize2` 按钮） |
| 展开状态过滤 | 可筛选上涨/下跌/全部 |

## 六、缓存配置

| 缓存键 | TTL | 说明 |
|--------|-----|------|
| `market:sectors` | 15s | 板块行情缓存 |
| `marketAkshare` | 30s | Python 回退数据缓存 |
| — | — | 前端**不再缓存**板块数据（旧的 Dexie `marketCache` 表已在 P6 删除） |

## 七、已知问题

1. **只取第一页 100 个板块（真实缺口）**：东财 `clist/get` 单页硬上限 **100**（`pz` 传 200/500 都只回 100，要 `pn` 翻页），而 `EastMoneyMarketProvider.sectors()` 固定 `pn=1&pz=100` → 只能拿到「按涨跌幅降序的**前 100 名**」。实测 `fs=m:90+t:2` 的 `total=496`（含 Ⅱ/Ⅲ 级细分行业），其余 396 个要翻 5 页才拿得到。同花顺回退固定 90 个。
2. **`limit` 上限**：route 与 service 都 clamp 到 1..`MARKET_SECTOR_MAX_LIMIT`（=120），比上面两个真实天花板都大，所以调大 `limit` 不会拿到更多（原先有个传 `:limit="500"` 的旧组件 `MarketDashboard.vue`，无人引用，2026-10-13 已删）。
3. **Python 回退较慢**：akshare 数据通常在 10-30 秒内返回，超时 60s。
4. **数据日期标记**：非交易日返回最后交易日数据，前端标记 `stale`。
5. **退化的 `code`**：同花顺回退不提供**东财**板块代码，`code` 为空串；因此成分股接口现在两种传法都支持 ——
   `/api/market/sectors/:code/constituents`（`code` 可以是 `BKxxxx`，**也可以是板块名**）、或 `?name=<板块名>` 配合 BK 代码做回退。
   板块名走同花顺 `q.10jqka.com.cn` 成分股页（`provider: akshare_ths`，60s 缓存），不再受 push2 限流影响。
6. **push2 `clist/get` 不稳（2026-10-14 实测仍未恢复）**：`push2.eastmoney.com/api/qt/clist/get`（行业+概念板块列表）常被切断（`SSL_read: unexpected eof`）；同一 host 的 `ulist.np/get`（涨跌家数）正常。2026-10-14 复测：`m:90+t:3`（概念）1/5、`m:90+t:2`（行业）**0/5** 成功，日志里 `eastmoney breaker open`。同一域名 DNS 是 CNAME 到 **`push2ipv6.trafficmanager.cn`（带 AAAA）**，`curl -6` 必挂、`-4` 才可能通 → 想治得先强制 IPv4（尚未做）。
7. **`fs=m:90+t:3` 才是概念板块**（东财口径，`total=506`，字段比同花顺全：真实 `code`=BKxxxx / `f62` 主力净额 / `f128`+`f136` 领涨股 / `f104`+`f105` 涨跌家数）。上面第 6 条修好后可作为**备源**，好处是能拿到真实板块代码（同花顺那条 `code` 恒为空串）。现在**没接**，因为成功率太低。

## 八、概念板块（AI 对话工具）

概念板块目前只在 AI 对话/分析里通过 `get_concept_sectors` 工具暴露，没有独立页面。它**不走** EastMoney（原因见 §七.6），直接以同花顺为唯一数据源（**自己翻页抓**，不再经由 akshare 的资金流函数）。

```
GET /api/market/concept-sectors?limit=20
  → market.routes.ts → getMarketConceptSectorsFromAkshare()
      · 25s 新鲜缓存（挡住连打），失败时 10min 内降级返回上一份好结果并标 stale=true
    → data_complete.py --source akshare --type concept_spot
      ├── cli/shared/ths_concept_flow.py fetch_concept_spot_df()  # 行情主表，按涨跌幅降序（现取 ~2s）
      └── ak.stock_board_concept_summary_ths()                    # 驱动事件（约 10s，单独 file_cache 24h；失败不落盘、降级为空事件表）
    → {success, data: [...], total_count, data_date, source, stale}
  → 消费方（目前只有服务端工具 `service/src/agent/toolsMarket.ts` 的 get_concept_sectors；**前端暂无概念板块面板**）
    注意：路由响应的 `data` 是**扁平数组**，而 `getMarketConceptSectorsFromAkshare()` 返回的是 `{ items, source, data_date }`
    —— 工具 handler 直接调服务函数时**要读 `items`**，照抄路由信封读 `data` 会恒返回空（见下）
```

### 两个已踩的坑（2026-10-14 修）

1. **工具 handler 读错字段 → 永远 `unavailable`**：`toolsMarket.ts` 曾读 `body?.data`，而服务函数返回 `{ items, ... }`，且 `unwrapServiceResult` 对非 ServiceResult 原样穿透 → `items` 恒空。**判据：工具返回里 `date`/`source` 有值但 `count: 0`**，同时 HTTP 路由正常。已加回归测试（`service/src/__tests__/agent/toolsMarket.test.ts`），并约定：工具测试的 mock **按服务函数真实返回形状写**，不要用 `serviceResult()` 信封包。
2. **akshare 依赖 `span.page_info`**：`ak.stock_fund_flow_concept` 先请求列表页、从 HTML 取分页控件算总页数，而同花顺常**只给表格、不给分页控件**（实测同一分钟 5/5 无 page_info、25 行数据都在）→ `AttributeError: 'NoneType' object has no attribute 'text'`。已换成 `python/cli/shared/ths_concept_flow.py` 自己翻页：`page_info` 有就用、没有就翻到空页；拿不到表格才重试（0 行表 = 正常终止页不重试）；带 15s 超时。该端点**不校验 `hexin-v`**，因此不需要 py_mini_racer/akshare 私有 helper。
   - 注意：同花顺的 CDN **同时发多个版本**（同一分钟内 `page_info` 时而 8、时而 3，连续三次取数 337/250/200 行，甚至榜首不同）→ **头部可靠、尾部可能被截短**，按 `limit` 取前 N 名没问题，**别当全量概念清单用**。

| 字段 | 来源 | 说明 |
|------|------|------|
| `name` | 资金流 `行业` | 概念名 |
| `change_pct` / `raw_change` | 资金流 `行业-涨跌幅` | 当日涨跌幅（字符串 / 数值） |
| `main_inflow` / `raw_main_inflow` | 资金流 `净额`（亿元 → 元） | 主力净流入 |
| `index_value` | 资金流 `行业指数` | 概念指数点位 |
| `company_count` | 资金流 `公司家数` | 成分股数量 |
| `leader` / `leader_change_pct` | 资金流 `领涨股` / `领涨股-涨跌幅` | 领涨股 |
| `event` / `event_date` | 概念简介 `驱动事件` / `日期` | 两张表按概念名 join（先精确、后去「概念」后缀）；`event_date` 是**数据源标注的事件日期，可能早于当日**，不可当作行情日期 |

> **将来做前端概念面板时**：概念板块与行业板块同款「`change_pct` 字符串 + `raw_change` 数值」结构，
> 涨跌幅一律用 `fmtPercentPreferNumber(raw_change, change_pct)`（`frontend/src/utils/number.ts`），
> **不要**直接 `fmtPercent(change_pct)` —— 字符串会被 `isFiniteNumber` 判掉、整列显示 `--`
> （行业板块 2026-10-13 就这么踩过：`fix(frontend): 行业板块涨跌幅整列显示 --`）。

工具返回 `data_status: 'available'`，`note` 里说明 `event_date` 的口径；数据源失败时返回 `data_status: 'unavailable'` + 空 `items`，避免模型编造概念板块表现。
若走了 serve-stale 兜底，返回里带 `stale: true` 与 `stale_reason`（`note` 开头会提示“本次抓取失败，items 是上一份快照”），模型应说明数据是快照而非实时。

> 对话里的工具状态条：请求成功但**没有可用数据**时显示黄色感叹号 + 「暂无数据」（`toolResultStatus.ts` 判定，`ToolCallStatus.status = 'empty'`）。注意判定按**数据内容**而非 `data_status`——北向资金恒为 `unavailable` 但成交总额有效，不会触发黄色提示。
