# 近7日A股成交量 (A-share Trading Volume — 7 Days)

## 一、概述

展示沪深两市近 7 个交易日合计成交量（金额），以柱状图呈现，支持查看每日沪/深/北分市场成交明细。

## 二、数据流路径

```
GET /api/market/volume/7days
  → market.routes.ts → getAVolume7Days()
    → getMarketKline('sh000001') + getMarketKline('sz399001')
      → ProviderChain([joinquant, tencent, stock-sdk, eastmoney])
        → push2.eastmoney.com Kline API
        → 成功 → 聚合最近 7 日量 → 返回
        → 全部失败 → Python (baostock/akshare) 回退
    → 前端 useMarketOverview → volumePoller → volumeOption → ECharts 柱状图
```

### 关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| Route | `service/src/routes/market.routes.ts:178` | `GET /api/market/volume/7days` |
| service | `service/src/services/marketService.ts:957` | `getAVolume7Days()` 聚合逻辑 |
| Provider | 复用 `getMarketKline()` → ProviderChain | 获取上证/深证日线 |
| Python 回退 | `python/cli/data_complete.py` | `--source baostock/akshare --type kline` |
| frontend API | `frontend/src/services/api.ts:91` | `getVolume7Days()` |
| frontend 渲染 | `frontend/src/composables/useMarketOverview.ts:242` | `volumeOption` ECharts option |
| 缓存 | `service/src/core/cache.ts:170` | `marketKline` TTL 1h |

## 三、API 数据源 — EastMoney Kline

### 3.1 端点

```
GET https://push2his.eastmoney.com/api/qt/stock/kline/get
```

### 3.2 请求参数

| 参数 | 值 | 说明 |
|------|----|------|
| `secid` | `1.000001` / `0.399001` | 上证指数 / 深证成指 |
| `klt` | `101` | 日线 |
| `fqt` | `1` | 前复权 |
| `beg` | `YYYYMMDD` | 14 天前日期 |
| `end` | `YYYYMMDD` | 当天日期 |

### 3.3 聚合逻辑

1. 请求上证 (`sh000001`) 和深证 (`sz399001`) 最近 14 天日线
2. 按日期合并，计算合计 = `shanghai.amount + shenzhen.amount`
3. 取最近 7 个交易日，每项包含 `date` / `total` / `shanghai` / `shenzhen` / `beijing`
4. 金额单位：元 → 亿（后端 `/ 1e8` 转换）

## 四、前端渲染

| 项 | 说明 |
|----|------|
| 组件 | `frontend/src/components/MarketOverview.vue` — "近7日A股成交量" section |
| Composable | `frontend/src/composables/useMarketOverview.ts:168` — `volumePoller` 轮询 |
| 图表类型 | ECharts 柱状图（`type: 'bar'`），蓝色渐变 |
| Tooltip | 显示总成交、沪、深、北四行明细 |
| Label | 柱顶显示 `{c}亿` |
| 轮询间隔 | 每 600s 刷新一次（`volumePoller`） |

## 五、缓存配置

| 缓存键 | TTL | 说明 |
|--------|-----|------|
| `market:kline:sh000001:{...}` | 1h | 上证指数日线 |
| `market:kline:sz399001:{...}` | 1h | 深证成指日线 |

## 六、已知问题

1. **依赖日线 Kline**：成交量数据实际来自指数日线的 `amount` 字段，无专用成交量接口。
2. **北京证券交易所缺失**：`beijing` 字段硬编码为 `'0亿'`，北交所成交量暂未纳入统计。
3. **非交易日缺失**：周末和节假日无数据，图表可能仅显示 3-5 个点。
