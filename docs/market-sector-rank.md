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
| service | `service/src/services/marketService.ts:1091` | `getMarketConceptSectorsFromAkshare()` 概念板块 |
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
| `fs` | `m:90+t:2` | 行业板块分类 |
| `fields` | `f12,f14` | 代码、名称 |
| `pz` | `500` | 最多 500 个板块 |

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

1. **板块数量限制**：最多返回 200 个板块，超出部分截断。
2. **Python 回退较慢**：akshare 数据通常在 10-30 秒内返回，超时 60s。
3. **数据日期标记**：非交易日返回最后交易日数据，前端标记 `stale`。
4. **退化的 `code`**：同花顺回退不提供板块代码，`code` 为空串，因此 `/api/market/sectors/:code/constituents` 对该批数据不可用。
5. **push2 `clist/get` 被封**：`push2.eastmoney.com/api/qt/clist/get`（行业+概念板块列表）在本机直连与代理下均被切断（`SSL_read: unexpected eof`）；同一 host 的 `ulist.np/get`（涨跌家数）与 `push2his`/`push2ex`/`datacenter-web` 正常。实测 2026-09-29 服务日志里板块是该日**唯一**持续报错的调用（26/26 次）。

## 八、概念板块（AI 对话工具）

概念板块目前只在 AI 对话/分析里通过 `get_concept_sectors` 工具暴露，没有独立页面。它**不走** EastMoney（原因见 §七.5），直接以 akshare 为唯一数据源。

```
GET /api/market/concept-sectors?limit=20
  → market.routes.ts → getMarketConceptSectorsFromAkshare()
    → data_complete.py --source akshare --type concept_spot
      ├── ak.stock_fund_flow_concept(symbol="即时")   # 行情主表：387 个概念，按涨跌幅降序（每次现取 ~2s）
      └── ak.stock_board_concept_summary_ths()        # 驱动事件（约 10s，单独 file_cache 24h，失败即忽略）
    → {success, data: [...], total_count, data_date, source}
  → 消费方（服务端工具 `service/src/agent/toolsMarket.ts` 的 get_concept_sectors、前端概念板块面板）
    注意：该路由的 `data` 是**扁平数组**（不是 `{items}`），按数组解析
```

| 字段 | 来源 | 说明 |
|------|------|------|
| `name` | 资金流 `行业` | 概念名 |
| `change_pct` / `raw_change` | 资金流 `行业-涨跌幅` | 当日涨跌幅（字符串 / 数值） |
| `main_inflow` / `raw_main_inflow` | 资金流 `净额`（亿元 → 元） | 主力净流入 |
| `index_value` | 资金流 `行业指数` | 概念指数点位 |
| `company_count` | 资金流 `公司家数` | 成分股数量 |
| `leader` / `leader_change_pct` | 资金流 `领涨股` / `领涨股-涨跌幅` | 领涨股 |
| `event` / `event_date` | 概念简介 `驱动事件` / `日期` | 两张表按概念名 join（先精确、后去「概念」后缀）；`event_date` 是**数据源标注的事件日期，可能早于当日**，不可当作行情日期 |

工具返回 `data_status: 'available'`，`note` 里说明 `event_date` 的口径；数据源失败时返回 `data_status: 'unavailable'` + 空 `items`，避免模型编造概念板块表现。

> 对话里的工具状态条：请求成功但**没有可用数据**时显示黄色感叹号 + 「暂无数据」（`toolResultStatus.ts` 判定，`ToolCallStatus.status = 'empty'`）。注意判定按**数据内容**而非 `data_status`——北向资金恒为 `unavailable` 但成交总额有效，不会触发黄色提示。
