# 全球行情 (Global Market Indices)

## 一、概述

展示 A 股五大指数（上证、深证、创业板、沪深300、科创50）和全球主要股指（纳斯达克、道琼斯、标普500、日经225等）的实时价格与涨跌幅。分为"沪深市场"和"全球指数"两个子区域。

## 二、数据流路径

```
GET /api/market/indices/combined
  → market.routes.ts → getCombinedIndices()
    ├── getMarketQuotes() — A 股指数
    │     → ProviderChain([tencent, stock-sdk, eastmoney])
    │       → eastmoney push2 API (主)
    │         → 成功 → 返回 + 缓存 15s
    │         → 失败 → 依次降级 tencent / stock-sdk
    └── getGlobalIndices() — 全球指数
          → ProviderChain([eastmoney, yahoo])
            → eastmoney push2 API (100.NDX 等 secid)
              → 成功 → 返回 + 缓存 15s
              → 失败 → yahoo finance 回退
    → 前端 MarketOverview → marketIndex → indices.china + indices.global
```

### 关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| Route | `service/src/routes/market.routes.ts:185` | `GET /api/market/indices/combined` |
| service | `service/src/services/marketService.ts:1029` | `getCombinedIndices()` 合并 |
| service | `service/src/services/marketService.ts:619` | `getGlobalIndices()` 全球指数 |
| Provider | `service/src/providers/eastmoney/eastmoneyMarketProvider.ts:236` | A股 `indices()` |
| Provider | `service/src/providers/eastmoney/eastmoneyMarketProvider.ts:479` | 全球 `globalIndices()` |
| Provider | `service/src/providers/stock-sdk/stockSdkMarketProvider.ts:28` | A股 `indices()` |
| Provider | `service/src/providers/yahoo/yahooMarketProvider.ts:40` | 全球 `globalIndices()` |
| frontend API | `frontend/src/services/api.ts:92` | `getCombinedIndices()` |
| frontend 渲染 | `frontend/src/components/MarketOverview.vue:30-50` | 指数卡片渲染 |
| 缓存 | `service/src/core/cache.ts:169` | `marketQuotes` TTL 15s |
| 缓存 | `service/src/core/cache.ts:176` | `marketGlobalIndices` TTL 15s |

## 三、东方财富 API 数据源

### 3.1 A 股指数端点

```
GET https://push2.eastmoney.com/api/qt/ulist.np/get
```

| 参数 | 值 | 说明 |
|------|----|------|
| `secids` | `1.000001,0.399001,0.399006,1.000300,1.000688` | 5 大指数 |
| `fields` | `f2,f3,f4,f12,f14` | 价格、涨跌幅、代码、名称 |

### 3.2 全球指数端点

```
GET https://push2.eastmoney.com/api/qt/ulist.np/get
```

| 参数 | 值 | 说明 |
|------|----|------|
| `secids` | `100.NDX,100.DJIA,100.SPX,100.HSI,100.HSCEI,...` | 12 个全球指数 |
| `fields` | `f2,f3,f4,f12,f14,f15,f16,f17,f18,f371` | 含开高低收 |

### 3.3 支持的全球指数

| 代码 | 名称 |
|------|------|
| `100.NDX` | 纳斯达克100 |
| `100.DJIA` | 道琼斯 |
| `100.SPX` | 标普500 |
| `100.HSI` | 恒生指数 |
| `100.HSCEI` | 国企指数 |
| `100.HSTECH` | 恒生科技 |
| `100.N225` | 日经225 |
| `100.KS11` | 韩国综合 |
| `100.FTSE` | 英国富时100 |
| `100.GDAXI` | 德国DAX |
| `100.FCHI` | 法国CAC40 |
| `100.SENSEX` | 印度SENSEX |

## 四、回退方案

### 4.1 A 股指数
ProviderChain 自动降级：`joinquant → tencent → stock-sdk → eastmoney`。

### 4.2 全球指数
ProviderChain：`eastmoney`（主）→ `yahoo`（回退）。
Yahoo 通过 `fetchYahooGlobalIndices()` 从 `yahooClient.ts` 获取实时行情。

## 五、前端渲染

| 项 | 说明 |
|----|------|
| 组件 | `frontend/src/components/MarketOverview.vue` — "全球行情" section |
| Composable | `frontend/src/composables/useMarketOverview.ts:120` — `indicesPoller` 轮询 |
| 卡片布局 | flex grid，每项显示名称、价格、涨跌幅 |
| 颜色规则 | 涨跌幅 ≥ 0 红色（up），< 0 绿色（down） |
| 点击行为 | 点击卡片跳转到指数详情页（`index-detail` 路由） |
| 轮询间隔 | 每 600s 刷新一次（`indicesPoller`） |

## 六、缓存配置

| 缓存键 | TTL | 说明 |
|--------|-----|------|
| `market:indices` | 15s | A 股指数实时行情 |
| `market:global-indices` | 15s | 全球指数实时行情 |
| `market:quotes:{symbols}` | 15s | 个股/指数报价 |

## 七、已知问题

1. **数据 15 秒缓存**：实时性不高，适合仪表盘概览。
2. **Yahoo 回退可能受限**：部分网络环境 Yahoo Finance API 需要代理（`proxy: 'auto'`）。
3. **A 股指数依赖正常交易时间**：非交易时段返回最后收盘价。
