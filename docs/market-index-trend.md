# 市场指数近一月走势 (Market Index Trend — Monthly)

## 一、概述

展示上证指数、深证成指、沪深300 三大指数近一个月的收盘价走势折线图，支持 Tab 切换查看不同指数。

## 二、数据流路径

```
前端 onMounted / 每 600s
  → marketAPI.getIndexKline(code, { period: 'daily', startDate })
    → GET /api/market/kline/:symbol
      → market.routes.ts → getMarketKline()
        → ProviderChain([joinquant, tencent, stock-sdk, eastmoney])
          → push2his.eastmoney.com Kline API
          → 成功 → 返回 + 缓存 1h
          → 全部失败 → Python (baostock/akshare) 回退
      → 前端截取最近 22 个交易日 → currentChartOption → ECharts 折线图
```

### 关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| Route | `service/src/routes/market.routes.ts:41` | `GET /api/market/kline/:symbol` |
| service | `service/src/services/marketService.ts:75` | `getMarketKline()` 编排 |
| Provider | 各 MarketProvider 实现 | `kline()` 方法 |
| Python 回退 | `service/src/services/marketService.ts:115` | `getMarketKlineFromPython()` |
| frontend API | `frontend/src/services/api.ts:98` | `getIndexKline()` |
| frontend 渲染 | `frontend/src/composables/useMarketOverview.ts:130` | `klinePoller` |
| frontend 渲染 | `frontend/src/composables/useMarketOverview.ts:204` | `currentChartOption` ECharts option |
| 缓存 | `service/src/core/cache.ts:170` | `marketKline` TTL 1h |

## 三、数据获取逻辑

### 3.1 请求参数

```
GET /api/market/kline/sh000001?period=daily&startDate=20260623
```

| 参数 | 值 | 说明 |
|------|----|------|
| `symbol` | `sh000001` / `sz399001` / `sh000300` | 三大指数 |
| `period` | `daily` | 日线 |
| `startDate` | 35 天前日期 | 取足够数据保证 22 个交易日 |

### 3.2 前端处理

1. 并发请求三大指数 K 线
2. 每项截取最近 22 个交易日（约一个月交易日数）
3. 仅提取 `date` / `close` / `changePercent` 三个字段
4. 按 Tab 切换显示不同指数的折线图

## 四、前端渲染

| 项 | 说明 |
|----|------|
| 组件 | `frontend/src/components/MarketOverview.vue` — "市场指数近一月走势" section |
| Composable | `frontend/src/composables/useMarketOverview.ts:130` — `klinePoller` |
| Tab 切换 | 上证指数 / 深证成指 / 沪深300 |
| 图表类型 | ECharts 折线图（`type: 'line'`），平滑曲线 + 面积填充 |
| 颜色规则 | 最新价 ≥ 起始价 红色，< 起始价 绿色 |
| Tooltip | 显示日期、收盘价、涨跌幅 |
| 轮询间隔 | 每 600s 刷新一次（`klinePoller`） |

## 五、缓存配置

| 缓存键 | TTL | 说明 |
|--------|-----|------|
| `market:kline:{symbol}:{"period":"daily",...}` | 1h | 指数日线缓存 |

## 六、已知问题

1. **数据延迟**：依赖 EastMoney Kline 接口，收盘后约 30 分钟数据才完整。
2. **非交易日断点**：周末和节假日不产生数据，折线图跳过空日期。
3. **回退较慢**：Python 回退（baostock/akshare）需要 10-60 秒，仅作为最后的降级保障。
