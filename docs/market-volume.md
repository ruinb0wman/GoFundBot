# 近7日A股成交量 (A-share Trading Volume — 7 Days)

## 一、概述

展示沪深两市近 7 个交易日合计成交量（金额），以柱状图呈现，支持查看每日沪/深/北分市场成交明细。

## 二、数据流路径

```
GET /api/market/volume/7days
  → market.routes.ts → getAVolume7Days()
    → getMarketKline('sh000001') + getMarketKline('sz399001')
      → ProviderChain([joinquant, tencent, stock-sdk, eastmoney])
        → 腾讯 newfqkline（含 amount，万元→元）   ← 当前实际命中
        → 成功 → 聚合最近 7 日成交额 → 返回
        → 全部失败 → Python (baostock/akshare) 回退（akshare 无 amount）
    → 前端 useMarketOverview → volumePoller → volumeOption → ECharts 柱状图
```

### 关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| Route | `service/src/routes/market.routes.ts:210` | `GET /api/market/volume/7days` |
| service | `service/src/services/marketService.ts:1211` | `getAVolume7Days()` 聚合逻辑（空结果返回 `success:false`） |
| Provider | `service/src/providers/tencent/tencentMarketProvider.ts` | `kline()` 走腾讯 newfqkline，提供 `amount` |
| Python 回退 | `python/cli/data_complete.py` | `--source baostock/akshare --type kline` |
| frontend API | `frontend/src/services/api.ts:91` | `getVolume7Days()` |
| frontend 渲染 | `frontend/src/composables/useMarketOverview.ts:242` | `volumeOption` ECharts option |
| 缓存 | `service/src/core/cache.ts:170` | `marketKline` TTL 1h |

## 三、API 数据源 — 腾讯新格式 K 线（主）

> EastMoney `push2his.eastmoney.com`（stock-sdk 与 eastmoney provider 的 K 线来源）在 2026-09 被切断
> （`RemoteDisconnected`/`ERR_EMPTY_RESPONSE`），旧的腾讯 `web.ifzq.gtimg.cn/app/app/kline/kline`
> 端点亦失效（返回 `code:11`）。`TencentMarketProvider.kline()` 改用下面的腾讯新接口，
> ProviderChain 顺序为 `[joinquant → tencent → stock-sdk → eastmoney]`，全部失败才落到 Python。
>
> **2026-10-09 补充**：那次「切断」绝大多数是**经代理**访问造成的（`eastmoneyRequest` 当时是 `proxy: 'auto'`）；
> 但 K 线另有一层真问题 —— 真直连下 `push2his .../stock/kline/get` 返回 `rc:102, data:null`，
> 也就是该端点对 A 股 K 线**确实取不到数据**（所以它作为兜底没用，腾讯才是主源）。

### 3.1 端点

```
GET https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get
    ?param=<code>,<period>,<start>,<end>,<count>,<fq>
```

备用 host：`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get`（同样的行结构，但只有前 6 列、无成交额）。

### 3.2 请求参数

| 参数 | 值 | 说明 |
|------|----|------|
| `code` | `sh000001` / `sz399001` | 带市场前缀 |
| `period` | `day` | 日线（周/月为 `week` / `month`） |
| `start` / `end` | `YYYY-MM-DD` | 窗口；`start` 仅作下限钳制 |
| `count` | 条数 | 决定返回行数，先取足量再按窗口过滤 |
| `fq` | `qfq` | 前复权（指数忽略） |

### 3.3 响应行字段（0-based）

| 下标 | 含义 |
|------|------|
| `[0]` | 日期 |
| `[1]`–`[4]` | 开 / 收 / 高 / 低 |
| `[5]` | 成交量（手） |
| `[7]` | 换手率（%） |
| `[8]` | **成交额（万元）** → `KlineDto.amount = [8] × 1e4`（元） |

已验证：2026-09-29 上证 `[8] = 66170429.28` 万元 == 同响应 `qt` 的 `661704292801` 元。

### 3.4 聚合逻辑

1. 请求上证 (`sh000001`) 和深证 (`sz399001`) 最近 14 天日线
2. 按日期合并，计算合计 = `shanghai.amount + shenzhen.amount`
3. 取最近 7 个交易日，每项包含 `date` / `total` / `shanghai` / `shenzhen` / `beijing`
4. 金额单位：元 → 亿（后端 `/ 1e8` 转换）
5. 两个市场都取不到（或都缺 `amount`）时返回 `success: false` 并记录日志，不再谎报成功

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
4. **成交额来源依赖腾讯**：`push2his.eastmoney.com` 反爬 + 旧腾讯端点失效时，链路上只剩无 `amount` 的源（Sina/akshare），此时接口返回 `success:false`，图表显示「获取失败」。
