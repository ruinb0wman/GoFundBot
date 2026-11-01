# 全球行情 (Global Market Indices)

> 2026-10-09 换源：**全球指数主源改为腾讯**，Yahoo 降为「腾讯未收录标的」的兜底；
> 加密货币从 Yahoo 迁到 Binance。背景与实测证据见仓库内 `.pi/plans/global-market-sources.md`（不进文档站）。

## 一、概述

展示 A 股五大指数（上证、深证、创业板、沪深300、科创50）、港股指数（恒生、国企）
和全球主要股指（纳斯达克100、道琼斯、标普500），以及加密货币实时行情。
前端分「中国市场（A股/港股）」与「全球指数」两个子区域。

**为什么港股归「中国市场」**：`useMarketOverview.indices` 的 `chinaNames` 里本来就含
「恒生指数/国企指数」，而 global 过滤只看 `market === '全球'`。腾讯 provider 给 hk*
标的标 `market: '港股'`，卡片就只会出现在「中国市场」栏，不会两栏重复。

## 二、数据流路径

```
GET /api/market/indices/combined
  → market.routes.ts → getCombinedIndices()
    ├── getMarketQuotes() — A 股指数
    │     → ProviderChain([tencent, stock-sdk, eastmoney], timeoutMs: 5000)
    └── getGlobalIndices() — 全球指数
          → ProviderChain([tencent, eastmoney, yahoo], timeoutMs: 6000,
                           validate: items.length > 0)
            → tencent `qt.gtimg.cn`（主，国内直连，覆盖 usNDX/usDJI/usINX/hkHSI/hkHSCEI）
              → 成功 → 返回 + 缓存 15s
              → 失败/未收录 → eastmoney push2（直连可用但会限流，180ms 级失败）→ yahoo（3.5s 预算）
    → 前端 MarketOverview → marketIndex → indices.china + indices.global

GET /api/market/crypto
  → getCryptoQuotes() → binance `/api/v3/ticker/24hr`（直连）→ 缓存 15s
```

### 关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| Route | `service/src/routes/market.routes.ts` | `/indices/combined`、`/crypto`、`/crypto/:symbol/detail`、`/index/:code/detail`、`/kline/global/:symbol` |
| service | `service/src/services/marketService.ts` | `getCombinedIndices()` 合并 / `getGlobalIndices()` / `getGlobalIndexKline()` / `getGlobalIndexDetail()` / `getCryptoQuotes()` / `getCryptoKline()` |
| 标的真源 | `service/src/providers/globalIndexDefs.ts` | `GLOBAL_INDEX_DEFS`（含 `tencentSymbol`/`eastmoneySecid`/`yahooSymbol`）、`CRYPTO_DEFS`（含 `binanceSymbol`）、`isGlobalIndexSymbol` / `isCryptoSymbol` / `findGlobalIndexDef` / `findCryptoDef` |
| Provider | `service/src/providers/tencent/tencentMarketProvider.ts` | `globalIndices()` + `kline()` 的海外分支 |
| Provider | `service/src/providers/eastmoney/eastmoneyMarketProvider.ts` | `globalIndices()`（push2 `ulist.np/get`，一次拿全部 11 个）+ `kline()` 的海外分支（`100.<code>`） |
| Provider | `service/src/providers/yahoo/yahooMarketProvider.ts` | `globalIndices()` / `kline()` 兜底（`fetchYahooGlobalIndices(timeoutMs = 3500)`） |
| Provider | `service/src/providers/binance/binanceClient.ts` | `fetchBinanceCryptoQuotes()` / `fetchBinanceCryptoKline()` |
| frontend API | `frontend/src/services/api.ts` | `getCombinedIndices()` / `getCryptoQuotes()` |
| frontend 渲染 | `frontend/src/components/MarketOverview.vue` | 「全球行情」section（中国市场 / 全球指数 / 加密货币） |
| frontend 分组 | `frontend/src/composables/useMarketOverview.ts` | `indices` computed 的 china/global 过滤器 + poller |
| 缓存 | `service/src/core/cache.ts` | `marketQuotes` 15s、`marketGlobalIndices` 15s（加密行情共用） |

## 三、数据源细节

### 3.1 腾讯：全球指数行情（主）

```
GET https://qt.gtimg.cn/?q=usNDX,usDJI,usINX,hkHSI,hkHSCEI
```

- `proxy: 'never'` + GBK 解码 + `Referer: https://gu.qq.com/`
- 行格式：`v_<tencentSymbol>="字段~字段~..."`，用**下标**取数：

| 下标 | 含义 |
|------|------|
| `[1]` | 名称 |
| `[2]` | 代码 |
| `[3]` | 现价 |
| `[4]` | 昨收 |
| `[5]` | 今开 |
| `[6]` | 成交量 |
| `[30]` | 时间（美 `YYYY-MM-DD HH:mm:ss`，港 `YYYY/MM/DD HH:mm:ss`） |
| `[33]` / `[34]` | 最高 / 最低 |

- **涨跌额/涨跌幅由 `[3]` 与 `[4]` 自算**，不用腾讯的 `[31]/[32]`：港股那行 `[35]` 是现价而不是币种，
  字段在美/港之间有漂移。

### 3.2 腾讯：海外指数 K 线

```
GET https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?param=usDJI,day,,,320,
```

行结构 `[date, open, close, high, low, volume, {}, turnover, amount(万元)]`，与 A 股共用同一段映射代码
（`fetchKlineFromTencent`）。`param` 的 `count` 决定条数，`start` 只是下限钳制，所以先取足量再按日期过滤。

### 3.3 Binance：加密货币

```
GET https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT",...]
GET https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=&endTime=&limit=
```

- **直连可用（实测 0.75s）**，`proxy: 'never'`；失败再走一次 `proxy: 'auto'`
- `lastPrice/priceChange/priceChangePercent` → `price/changeAmount/changePercent`
- `closeTime` → `date` + `updateTime`
- 输出顺序按 `CRYPTO_DEFS`（Binance 返回顺序不保证）

### 3.4 支持的标的与覆盖

| 代码 | 名称 | 腾讯 | 东财 | 现状 |
|------|------|------|-------|------|
| `NDX` | 纳斯达克100 | `usNDX` | `100.NDX` | 腾讯 ✅ |
| `DJI` | 道琼斯指数 | `usDJI` | `100.DJIA` | 腾讯 ✅ |
| `SPX` | 标普500 | `usINX` | `100.SPX` | 腾讯 ✅ |
| `HSI` | 恒生指数 | `hkHSI` | `100.HSI` | 腾讯 ✅（`market: 港股`） |
| `HSCEI` | 国企指数 | `hkHSCEI` | `100.HSCEI` | 腾讯 ✅（`market: 港股`） |
| `N225` | 日经225 | — | `100.N225` | 东财 ✅ |
| `KS11` | 韩国综合指数 | — | `100.KS11` | 东财 ✅ |
| `FTSE` / `GDAXI` / `FCHI` / `SENSEX` | 英/德/法/印度 | — | `100.FTSE` / `100.GDAXI` / `100.FCHI` / `100.SENSEX` | 东财 ✅ |
| `BTC` / `ETH` / `SOL` / `BNB` | 加密货币 | — | — | Binance ✅ |

> 东财的 `secid` 与对外代码不是一套（`DJI` ↔ `100.DJIA`），映射表在 `GLOBAL_INDEX_DEFS` 里，别在别处再抄一份。
> akshare 的 `index_global_*` 同样走东财 push2（只是另一个 client），没有额外价值。

## 四、回退方案

### 4.1 A 股指数
ProviderChain 自动降级：`tencent → stock-sdk → eastmoney`（`timeoutMs: 5000`）。

### 4.2 全球指数（2026-11-01 起是并行合并，不再走 ProviderChain）
`tencent` + `eastmoney` **并行**取数，按 `code` 合并（同一个 code 腾讯优先，东财只补腾讯未收录的），
最后按 `GLOBAL_INDEX_DEFS` 顺序输出（`mergeGlobalIndexItems()`）。

- 为什么不用 chain：链只会返回第一个「非空」结果，而腾讯**永远非空**（只有 5 个），
  日经/韩国/英德法/印度就永远轮不到东财 —— 这正是「全球只有 3 种」的成因。
- 为什么把 Yahoo 从这条腿删掉：本机直连与代理都超时，只在缺数时白等 3.5s；东财已覆盖全部 11 个。
- `provider` 字段是 `tencent+eastmoney`；任一家失败时结果仍然返回（只少那几家），
  两家都失败才 503。

### 4.3 海外指数 K 线
`tencent → eastmoney → yahoo`，`validate: length > 0`（腾讯对未收录代码返回 `[]`，必须靠 validate 触发降级）。
东财走 `push2his …/stock/kline/get?secid=100.<code>`，**必须带 `beg`/`end`**（缺了直接 `rc:102`，
所以「所有」用 `beg=0&end=20500101`）；它的行是 `[7]=振幅、[8]=涨跌幅、[9]=涨跌额、[10]=换手率`。

### 4.4 加密货币
Binance 直连 → 代理重试 → 503。没有 Yahoo 分支。

## 五、前端渲染

| 项 | 说明 |
|----|------|
| 组件 | `frontend/src/components/MarketOverview.vue` — 「全球行情」section |
| Composable | `frontend/src/composables/useMarketOverview.ts` — `indicesPoller` / `cryptoPoller` |
| 分组 | `market === 'A股' \|\| '港股' \|\| chinaNames.includes(name)` → 中国市场；`market === '全球' \|\| globalNames.includes(name)` → 全球指数 |
| 颜色规则 | 涨跌幅 ≥ 0 红色（up），< 0 绿色（down） |
| 点击行为 | 点击卡片跳转指数详情页（`index-detail` 路由 → `GET /api/market/index/:code/detail`） |
| 轮询间隔 | 指数 600s（失败 60s）；加密货币 300s |

## 六、缓存配置

| 缓存键 | TTL | 说明 |
|--------|-----|------|
| `market:indices` | 15s | A 股指数实时行情 |
| `market:global-indices` | 15s | 全球指数实时行情 |
| `market:crypto-quotes` | 15s | 加密货币行情 |
| `market:kline:global:{code}:{}` | 1h | 海外指数日/周/月 K 线 |
| `market:kline:crypto:{code}:{}` | 1h | 加密 K 线（键含 startDate/endDate） |
| `market:quotes:{symbols}` | 15s | 个股/指数报价 |

## 七、已知问题

1. **日经/韩国/英德法/印度只靠东财 `push2`**（2026-11-01 补齐）。push2 是**路径级限流**的：
   密集请求后整段拒绝、IPv4/IPv6 一起挂数小时。所以这几只仍可能整段消失
   （此时 `/indices/combined` 只剩腾讯那 5 个 + A 股，不是 0 值，也不是配置丢了）。
   Yahoo 保底在本机直连与代理都不通（2026-10-09 实测 16.1s / 15.8s 超时），已从行情链里摘掉。
2. **不要退回串行分批**：`fetchYahooGlobalIndices` 曾经是 `concurrency = 2` + 15s 超时，
   11 个代码 6 批 ≈ **84s**，`/indices/combined` 一天出现 15 次 84.0s。
   回归测试见 `service/src/__tests__/providers/yahoo-global-budget.test.ts`（断言同一波次发出 + 总耗时 ≈ 单次超时）。
3. **东财 `ulist.np` 一次拿 11 个**（别改成逐个 `stock/get`，那是 11 倍请求量，更容易被限流）。
   它的字段口径是 `f15=最高、f16=最低、f17=今开、f18=昨收` —— 与 `stock/get` 的 `f44/f45/f46` 编号不同，套错过一次。
4. 东财的海外指数 K 线 `volume` 恒为 0 → 详情页成交量给 `null`（「数据源不提供」），不要显示成 0。
4. **数据 15 秒缓存**：实时性不高，适合仪表盘概览。
5. **A 股指数依赖正常交易时间**：非交易时段返回最后收盘价。
