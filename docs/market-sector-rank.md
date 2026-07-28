# 行业板块排行 (Industry Sector Rankings)

## 一、概述

展示 A 股行业板块的涨跌幅排行，支持前 N 名显示、涨跌分布概览、展开全屏模态，数据有本地 IndexedDB 缓存。

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
    → 前端 SectorRank.vue → adaptiveRefresh + Dexie 缓存
```

### 关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| Route | `Service/src/routes/market.routes.ts:84` | `GET /api/market/sectors` |
| Service | `Service/src/services/marketService.ts:820` | `getMarketSectorsFromAkshare()` 编排 |
| Service | `Service/src/services/marketService.ts:463` | `getMarketSectors()` EastMoney 主路 |
| Provider | `Service/src/providers/eastmoney/eastmoneyMarketProvider.ts:140` | `sectors()` 东方财富实现 |
| Python 回退 | `Scripts/cli/data_complete.py` | `--source akshare --type sector_spot` |
| Frontend API | `Frontend/src/services/api.ts:85` | `getSectorRank()` |
| Frontend 渲染 | `Frontend/src/components/SectorRank.vue` | 排行列表 + 模态框 |
| 缓存 | `Service/src/core/cache.ts:180` | `marketAkshare` TTL 30s |

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
  → akshare.stock_board_industry_name_em() + stock_board_industry_hist()
  → stdout JSON → Node.js 解析
```

回退数据来源为同花顺（ths），返回格式与 `SectorSpotItem` 一致。

## 五、前端渲染

| 项 | 说明 |
|----|------|
| 组件 | `Frontend/src/components/SectorRank.vue` |
| 数据刷新 | `useAdaptiveRefresh` + Dexie `marketCache` 持久化 |
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
| 前端 Dexie `marketCache` | 持久化 | 本地缓存+过期检测（次日 9AM） |

## 七、已知问题

1. **板块数量限制**：最多返回 200 个板块，超出部分截断。
2. **Python 回退较慢**：akshare 数据通常在 10-30 秒内返回，超时 60s。
3. **数据日期标记**：非交易日返回最后交易日数据，前端标记 `stale`。
