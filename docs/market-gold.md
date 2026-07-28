# 实时贵金属 (Real-time Precious Metals)

## 一、概述

展示黄金 T+D、国际黄金、国际白银三档贵金属的实时价格、涨跌额、涨跌幅。点击黄金/白银卡片弹出历史走势折线图（7/10/30 天可切换）。

## 二、数据流路径

```
GET /api/market/gold/realtime
  → market.routes.ts → fetchGoldRealtime()
    → api.jijinhao.com/quoteCenter/realTime.htm
    → JSONP 解析 → 字段映射 → 返回 + 缓存 60s
  → 前端 goldPoller → MarketOverview 金价卡片渲染

点击卡片 → openGoldHistory()
  → GET /api/market/gold/history?days=N
    → api.jijinhao.com/quoteCenter/history.htm (JO_52683 + JO_42660)
  → 前端 metalChartOption → ECharts 折线图弹窗
```

### 回退方案

**无** — jijinhao 是贵金属行情的唯一数据源，无 ProviderChain 回退。

## 三、关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| Route | `Service/src/routes/market.routes.ts:148` | `GET /api/market/gold/history` |
| Route | `Service/src/routes/market.routes.ts:156` | `GET /api/market/silver/history` |
| Route | `Service/src/routes/market.routes.ts:171` | `GET /api/market/gold/realtime` |
| Service | `Service/src/services/marketService.ts:633` | `fetchGoldRealtime()` 实时行情 |
| Service | `Service/src/services/marketService.ts:694` | `getGoldHistory()` 金价历史 |
| Service | `Service/src/services/marketService.ts:756` | `getSilverHistory()` 银价历史 |
| 缓存 | `Service/src/core/cache.ts:178` | `goldRealtime` TTL 60s, `goldHistory` TTL 1h |
| Frontend API | `Frontend/src/services/api.ts:87-89` | `getGoldRealtime()`, `getGoldHistory()`, `getSilverHistory()` |
| 前端渲染 | `Frontend/src/components/MarketOverview.vue:84-98` | gold 卡片模板 |
| 前端 Composable | `Frontend/src/composables/useMarketOverview.ts:23-102` | goldPoller、模态框、ECharts option |
| 前端样式 | `Frontend/src/components/MarketOverview.css:30-49` | gold 卡片/弹窗样式 |

## 四、API 数据源 — jijinhao

### 4.1 实时行情端点

```
GET https://api.jijinhao.com/quoteCenter/realTime.htm
```

### 4.2 请求参数

| 参数 | 值 | 说明 |
|------|----|------|
| `codes` | `JO_71,JO_92233,JO_92232` | 黄金T+D, 国际黄金, 国际白银 |
| `_` | `Date.now()` | 时间戳防缓存 |

返回格式为 JSONP：`var quote_json = {...}`

### 4.3 字段映射

| jijinhao 字段 | DTO 字段 | 说明 |
|--------------|---------|------|
| `showName` | `name` | 显示名称 |
| `q63` | `price` | 最新价 |
| `q70` | `change` | 涨跌额 |
| `q80` | `change_pct` | 涨跌幅（原始数值，前端 `fmtPercent` 格式化） |
| `q1` | `open` | 今开盘 |
| `q3` | `high` | 最高价 |
| `q4` | `low` | 最低价 |
| `q2` | `prev_close` | 昨收盘 |
| `unit` | `unit` | 计价单位 |

### 4.4 标的代码

| 代码 | 名称 | 数据类型 |
|------|------|---------|
| `JO_71` | 黄金 T+D | 实时 + 历史 |
| `JO_92233` | 国际黄金 | 实时 |
| `JO_92232` | 国际白银 | 实时 + 历史 |
| `JO_52683` | 中国黄金 | 历史（金价走势） |
| `JO_42660` | 周大福 | 历史（金价走势） |

### 4.5 历史数据端点

```
GET https://api.jijinhao.com/quoteCenter/history.htm
```

| 参数 | 值 | 说明 |
|------|----|------|
| `code` | `JO_52683` / `JO_42660` / `JO_92232` | 标的代码 |
| `style` | `3` | 数据样式 |
| `pageSize` | `7` / `10` / `30` | 天数 |
| `needField` | `128,129,70` (金) / `70` (银) | 返回字段 |

返回同样为 JSONP 格式。

## 五、前端渲染

| 项 | 说明 |
|----|------|
| 组件 | `Frontend/src/components/MarketOverview.vue` — `第 84-98 行` "实时贵金属" section |
| Composable | `Frontend/src/composables/useMarketOverview.ts:158` — `goldPoller` 轮询 |
| 卡片 | flex 卡片布局，显示名称、价格(单位)、涨跌额 + 涨跌幅 |
| 颜色规则 | 涨跌额 ≥ 0 红色（up），< 0 绿色（down） |
| 弹窗图表 | ECharts 折线图（银：单线 + 面积；金：中国黄金 + 周大福双线） |
| 历史天数 | 下拉选择 7/10/30 天，默认 10 天 |
| 轮询间隔 | 每 600s 刷新一次（`goldPoller`） |
| 弹窗切换 | 根据名称包含"白银"/"银"自动判断调用 `getSilverHistory` 或 `getGoldHistory` |

## 六、缓存配置

| 缓存键 | TTL | 说明 |
|--------|-----|------|
| `gold:realtime` | 60s | 实时行情 1 分钟过期 |
| `gold:history:{days}` | 1h | 金价历史 1 小时过期 |
| `silver:history:{days}` | 1h | 银价历史 1 小时过期 |

## 七、已知问题

1. **单源依赖，无回退**：贵金属数据仅来源于 `api.jijinhao.com`，该接口不可用时直接返回空数据，不经过 ProviderChain 降级。
2. **JSONP 劫持解析**：后端通过 `text.replace('var quote_json = ', '')` 剥离 JSONP 包裹，对格式变化敏感。
3. **`change_pct` 格式 Bug（已修复 — 2026-07-28）**：
   - 修复前：server 端 `${to2(d.q80)}%` 预拼接 `%`，client 端 `fmtPercent("0.55%")` 因 `isFiniteNumber` 校验失败返回 `--`
   - 修复后：server 端返回原始数值 `to2(d.q80)`，由 `fmtPercent` 统一格式化
   - 涉及文件：`Service/src/services/marketService.ts:667`
4. **历史数据非交易日缺失**：周末和节假日无数据，图表可能出现断点。
