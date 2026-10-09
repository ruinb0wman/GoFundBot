# 海外行情源重构：腾讯 + Binance 取代 Yahoo（首屏 84s → <1s）

- 日期：2026-10-09
- 状态：**已完成**（P0-a → P0-d 全部落地，`bun run check` 全绿 + 真机验证；结果见 §10）
- 触发：分析 `python/Data/logs/dataservice-2026-10-08.jsonl`（08:00 → 次日 00:46 CST）时发现
  `/api/market/indices/combined` 一天 15 次 ≈84.0s、`/api/market/crypto` 30 次 = 30.00s

## 0. 一句话结论

**不是"Yahoo 慢"，是"Yahoo 在这台机器上根本不通，而代码把 11 个代码按 2 并发串行等 15s 超时"**
—— 6 个批次 × ~14s ≈ 84s（crypto 4 个代码 = 2 批 = 30.00s，与日志分秒不差）。

三条独立缺陷叠加：

1. `fetchYahooGlobalIndices()` / `fetchCryptoQuotes()` 用 `concurrency = 2` 串行分批 + `timeoutMs: 15000`；
2. `getGlobalIndices()` 调 `chain.run()` 时**没传 `timeoutMs`**（对比 `getMarketQuotes` 传了 5000）→ 没有总预算；
3. `getCombinedIndices()` 用 `Promise.allSettled` 把全球分支的 rejection **直接丢弃、不打日志**，
   且 `cacheThrough` 只缓存成功 → 每轮 poll 重新等一遍（前端 poller 成功间隔 10min，于是是"每 11 分钟卡一次"）。

## 1. 证据

### 1.1 日志（dataservice-2026-10-08.jsonl）

| 证据 | 数字 |
|---|---|
| `/indices/combined` | n=83，中位 1.35s，**15 次 ≈84.0s**，14:26→16:42 约 11 分钟一轮；最后一条 16:46:25 在日志结束时仍挂起 |
| `/crypto` | n=143，中位 1.12s，**30 次 = 30.00s** |
| 全天 ≥30s 的请求 | 53 次（≥3s 97 次） |
| 日志里的 error | 192 条，其中 168 条是板块降级，**没有一条**提到全球指数拿不到（静默） |

### 1.2 2026-10-09 实测上游

```bash
# 东财 push2 已全挂（不只是板块 clist）
push2.eastmoney.com  .../ulist.np/get?secids=1.000001,0.399001   → http=000, 0.17s
91.push2.eastmoney.com 同接口                                     → http=000, 0.23s

# Yahoo：直连与代理都不通
query1.finance.yahoo.com/v8/finance/chart/^GSPC   直连            → 16.1s 超时
                                    ... 走 127.0.0.1:7890         → 15.8s 超时
www.google.com/generate_204        走 127.0.0.1:7890              → 204, 0.88s   ← 代理本身是好的
api.binance.com/api/v3/ping        直连                           → 200, 0.75s

# 腾讯：行情 + K 线都有
qt.gtimg.cn/q=usNDX,usDJI,usINX,hkHSI,hkHSCEI,hkHSTECH            → 有数据（jpNI225/ksKS11/ukFTSE/deDAX/frCAC/inSENSEX → pv_none_match）
proxy.finance.qq.com/.../newfqkline/get?param=usDJI,day,,,4,qfq    → code:0 有数据
```

### 1.3 代码位置

```
/indices/combined  →  getCombinedIndices()                        marketService.ts:1306
   ├─ getMarketQuotes(5只A股)     [tencent → stock-sdk → eastmoney]  ✅ 秒回
   └─ getGlobalIndices()          [eastmoney → yahoo]                ❌ 84s
        eastmoney.globalIndices()  → push2 .../ulist.np/get   实测 0.17s 直接失败
        yahoo.globalIndices()      → fetchYahooGlobalIndices()      yahooClient.ts:259
             for (i += 2) 11 代码 → 6 串行批次 × fetchUrl(15000)
```

## 2. 目标数据源矩阵

| 标的 | 主源（新） | 兜底 | 实测 |
|---|---|---|---|
| NDX / DJI / SPX | 腾讯 `usNDX / usDJI / usINX` | eastmoney → yahoo | 0.2s，字段完整 |
| HSI / HSCEI | 腾讯 `hkHSI / hkHSCEI` | 同上 | 0.2s |
| N225 / KS11 / FTSE / GDAXI / FCHI / SENSEX | 腾讯未收录 | yahoo（3.5s 预算） | 多数情况为空 |
| 海外指数 K 线 | 腾讯 `newfqkline/get` | yahoo | 0.3s |
| BTC/ETH/SOL/BNB 行情 | Binance `ticker/24hr` | — | 0.75s **直连** |
| 加密 K 线 | Binance `klines` | — | 直连 |

> **预期内的覆盖损失**：N225/KS11/FTSE/GDAXI/FCHI/SENSEX 今天本来就从未显示（84s 后被静默丢弃），
> 改造后是"明确拿不到"而不是"变慢"。akshare 的 `index_global_*` 也走东财 push2，同样死；
> 要恢复这 6 张卡需另开任务找源。

## 3. 验收标准

| 目标 | 硬指标 |
|---|---|
| `/api/market/indices/combined` | p90 **< 1s**（今天 p90 = 83,953ms） |
| `/api/market/crypto` | **< 1s**（今天 30 次 = 30.00s） |
| 海外指数 K 线 | `get_index_kline(DJI/HSI/SPX/NDX)` **< 1s** |
| 失败可观测 | `getCombinedIndices` 全球分支失败必须打日志 |
| 不回归 | `bun run check` 全绿；A 股指数/板块/K 线行为不变 |

## 4. 改造步骤

### Step 1 · 新增 `service/src/providers/globalIndexDefs.ts`（标的单一真源）

`GLOBAL_INDEX_DEFS` / `CRYPTO_DEFS` / `isGlobalIndexSymbol` / `isCryptoSymbol` 现在都塞在
`yahooClient.ts`，但腾讯/Yahoo/Binance 三家都要用，`marketService` 还在 import yahoo 内部实现。抽成独立模块：

- `GlobalIndexDef { code, name, tencentSymbol?, yahooSymbol }`，`CryptoDef { code, name, binanceSymbol, yahooSymbol, icon }`
- `findGlobalIndexDef` / `findCryptoDef` / `isGlobalIndexSymbol` / `isCryptoSymbol`
- **保留** `yahooClient.ts` 里的 `YAHOO_SYMBOL_MAP`（`gb_ixic → ^IXIC` 历史映射，`toYahooSymbol()` 仍在用）
- **不加 HSTECH**：前端 `useMarketOverview.indices` 的 `chinaNames` 也含「恒生科技」，
  加了会让卡片同时出现在沪深/全球两栏（需先改前端分组）

### Step 2 · 扩展 `service/src/providers/tencent/tencentMarketProvider.ts`

同一 class（+~90 行，远低于 500 行上限），复用其 `fetchKlineNode / pickKlineRows / toNullableNum`：

- `globalIndices()`：一次批量 `qt.gtimg.cn?q=usNDX,usDJI,...`，`proxy: 'never'` + GBK + Referer
- `kline()` 顶部加海外分支：`findGlobalIndexDef(symbol)` 命中 → 走海外 K 线；原 A 股路径一行不动

腾讯全球指数字段（实测）：

| 下标 | 含义 |
|---|---|
| `[1]` | 名称 |
| `[2]` | 代码 |
| `[3]/[4]/[5]` | 现价 / 昨收 / 今开 |
| `[6]` | 成交量 |
| `[30]` | 时间（**美 `YYYY-MM-DD HH:mm:ss`，港 `YYYY/MM/DD HH:mm:ss`**） |
| `[31]/[32]` | 涨跌额 / 涨跌幅（**不要依赖**） |
| `[33]/[34]` | 最高 / 最低 |

坑：
1. 港股那行 `[35]` 是现价不是币种 → 统一用 `[3]/[4]` **自算** change/changePercent（与 A 股 `parseQtQuotes` 一致）；
2. `[30]` 两种日期分隔符都匹配不上现有 `toQuoteDate()` 的正则 → 新写 `parseTencentGlobalTime()`。

### Step 3 · 新增 `service/src/providers/binance/binanceClient.ts`

- `fetchBinanceCryptoQuotes()`：`/api/v3/ticker/24hr?symbols=[...]`，`proxy: 'never'`（实测直连 0.75s），
  失败再试一次 `proxy: 'auto'`
- `fetchBinanceCryptoKline(code, opts)`：`/api/v3/klines?symbol=&interval=&startTime=&endTime=&limit=`
  （interval：daily `1d` / weekly `1w` / monthly `1M`）
- **顺带修既有缺口**：`getCryptoKline` 现在把 `startDate/endDate` 丢掉了，一并接上

### Step 4 · `service/src/providers/yahoo/yahooClient.ts` 瘦身 + 加预算

- `fetchSingleGlobalQuote(def, timeoutMs = 3500)`：单次尝试，仅 429 允许 1 次重试（受 deadline 约束）
- `fetchYahooGlobalIndices(timeoutMs = 3500)`：11 个一次性并发 `Promise.allSettled`，结果 push 进共享数组
  （慢的不阻塞已拿到的），删掉 `concurrency = 2` 的串行批次
- **删除** `fetchCryptoQuotes` / `fetchCryptoKline` / `fetchGlobalIndexQuoteByCode`（分别被 Binance、
  `getGlobalIndices()` 批量结果取代）

### Step 5 · `service/src/services/marketService.ts` 接线

| 位置 | 改动 |
|---|---|
| `getGlobalIndices()` | chain → `[tencent, eastmoney, yahoo]`，加 `{ timeoutMs: 6000, validate: items.length > 0 }`（**validate 是关键**，否则腾讯空数组会被当成功、不再降级） |
| `getGlobalIndexKline()` | chain → `[tencent, yahoo]` + `validate: length > 0` + `timeoutMs: 6000` |
| `getGlobalIndexDetail()` | 报价改用 `getGlobalIndices()` 结果 `find(code)`（15s 缓存、批量一次）；`provider` 按实际填，不写死 `'yahoo'` |
| `getCryptoQuotes()` | → `fetchBinanceCryptoQuotes()`，`provider: 'binance'` |
| `getCryptoKline()` | → Binance，接 start/end，`provider: 'binance'` |
| `getCryptoIndexDetail()` | → Binance；`CRYPTO_DEFS` 改从 `globalIndexDefs.js` 引 |
| `getCombinedIndices()` | 补 `logger.warn('global indices unavailable', { error })`（今天完全静默） |
| 顶部 import | defs 改从 `providers/globalIndexDefs.js` 引 |

**语义陷阱（有意为之）**：ProviderChain 第一个非空结果即返回 → 腾讯成功（5 条）后永远不再问 Yahoo，
N225 等 6 个必然缺失。换来 <1s。若要两源合并需每次 miss +2.5s，不划算（见 §7）。

### Step 6 · `service/src/agent/toolsMarket.ts`

`get_index_kline` 描述里「海外指数走 Yahoo，可能较慢」已不成立 → 改为
「美股/港股指数（DJI/SPX/NDX/HSI）走腾讯源秒回；日经/欧股等走 Yahoo 兜底，拿不到时返回空」。
**改完必须 `bun run gen:tools`**（`toolsManifest.test.ts` 拦漂移）。

## 5. 测试计划（`service/src/__tests__/providers/`，净增 3 个）

| 文件 | 覆盖 |
|---|---|
| `tencent-global-indices.test.ts` | mock `core/fetch.js`；真实 GBK 行 → 字段映射；`[30]` 两种日期格式；`pv_none_match` 跳过；请求带 `proxy: 'never'` |
| `binance-client.test.ts` | 24hr → `GlobalIndexDto`（含 `updateTime`）；klines → candle；网络错误抛出（让上层降级） |
| `yahoo-global-budget.test.ts` | **84s 回归**：mock 全 reject / 不 resolve，断言 `fetchYahooGlobalIndices()` 在预算内返回 `{items: []}` |

现有测试无一覆盖 globalIndices/crypto（已 grep 确认），不动老测试。

## 6. 文档同步清单

| 文件 | 改什么 |
|---|---|
| `AGENTS.md` | Proxy 行；hot spots providers 行；「已知问题」加**海外行情源**（含 push2 全挂、Yahoo 代理也不通） |
| `docs/market-global.md` | **重写**：数据流图 / 回退链 / 缓存 / 已知问题（删「Yahoo 回退可能受限」） |
| `docs/architecture/module-data-sources.md` | `indices/combined`、`kline/global/:symbol` 两行 ProviderChain |
| `docs/architecture/data-sources.md` | yahoo 行 + 新增 tencent 全球 / Binance 加密行 |
| `docs/architecture/fallback-strategy.md` | `GlobalIndexKline` 段 |
| `docs/data-sources-and-runtime.md` | `HTTP_PROXY` 行 |
| `docs/tushare.md` | 「全球指数」行 |
| `README.md` | §313 / §339「Yahoo Finance API 需要代理」两段 |
| `.pi/extensions/gofund/tools.manifest.ts` | `bun run gen:tools` |

## 7. 取舍 / 风险 / 回退

| 取舍 | 说明 |
|---|---|
| 丢 N225/KS11/FTSE/GDAXI/FCHI/SENSEX | 今天本就拿不到；akshare 同名接口走东财 push2，同样死 |
| first-wins 不合并两源 | 保住 <1s；合并要每次 miss +2.5s |
| Binance 直连 | 实测 0.75s；被墙时留一次 `proxy: 'auto'` 重试，再不行回退 `yahooSymbol`（defs 保留） |
| 腾讯字段漂移 | 只用 `[3]/[4]/[5]/[30]/[33]/[34]` 自算；解析失败返回 `[]` 让 chain 继续降级，不抛 |
| 保留 `eastmoney.globalIndices` | push2 已全挂，失败只要 0.17s，留作"恢复即命中"的免费一跳 |
| 不加 HSTECH | 会让卡片同时出现在沪深/全球两栏 |

## 8. 验证

```bash
cd service && bun run lint && bun run typecheck && bun run test
cd .. && bun run gen:tools && bun run check

# 起服务后（TTL 15s，第二次必然命中缓存）
curl -s -o /dev/null -w 'combined  %{time_total}s\n' localhost:8310/api/market/indices/combined
curl -s -o /dev/null -w 'crypto    %{time_total}s\n' localhost:8310/api/market/crypto
curl -s -o /dev/null -w 'globalk   %{time_total}s\n' \
  'localhost:8310/api/market/kline/global/DJI?period=daily&startDate=20260901&endDate=20261008'
curl -s -o /dev/null -w 'cryptodet %{time_total}s\n' localhost:8310/api/market/crypto/BTC/detail
curl -s localhost:8310/api/market/indices/combined | python3 -m json.tool | head -40   # 全球 5 条

# 日志回归：/indices/combined 的 durationMs 必须 < 1000
python3 - <<'EOF'
import json,glob
for f in glob.glob('python/Data/logs/dataservice-*.jsonl'):
    for line in open(f):
        o=json.loads(line); c=o.get('context') or {}
        if o.get('message')=='request end' and c.get('path')=='/indices/combined' and c.get('durationMs',0)>3000:
            print('SLOW', o['time'], c['durationMs'])
EOF
```

前端：bow 打开 `/`，全球指数 5 张卡（NDX/DJI/SPX/HSI/HSCEI）+ 加密货币 4 张，Network 里两个请求 <1s。

## 9. 进度

- [x] P0-a Step 1+2+5（全球指数换源 + 预算 + 日志）
- [x] P0-b Step 4 + 3 个单测
- [x] P0-c Step 3 + 5（加密换 Binance）
- [x] P0-d Step 6 + 文档同步 + `bun run check` + 真机验证

## 10. 落地结果（2026-10-09 01:00-01:45 CST）

### 改动的文件

| 文件 | 动作 |
|---|---|
| `service/src/providers/globalIndexDefs.ts` | **新增**：标的单一真源（`GLOBAL_INDEX_DEFS` + `CRYPTO_DEFS` + `LEGACY_GLOBAL_SYMBOL_MAP` + 分类函数） |
| `service/src/providers/tencent/tencentMarketProvider.ts` | `globalIndices()` + `kline()` 海外分支；抽出 `fetchKlineFromTencent`；新增 `parseTencentGlobalQuotes` / `parseTencentGlobalTime` |
| `service/src/providers/binance/binanceClient.ts` | **新增**：`fetchBinanceCryptoQuotes` / `fetchBinanceCryptoKline`（直连优先 + 代理重试） |
| `service/src/providers/yahoo/yahooClient.ts` | 只留全球指数兜底；11 个代码**一次性并发** + `timeoutMs` 3500（含 kline 兜底）；删除 `fetchCryptoQuotes` / `fetchCryptoKline` / `fetchGlobalIndexQuoteByCode` / 本地 defs |
| `service/src/providers/yahoo/yahooMarketProvider.ts` | `isGlobalIndexSymbol` 改从 `globalIndexDefs` 引 |
| `service/src/services/marketService.ts` | `getGlobalIndices`/`getGlobalIndexKline` 换链 + `timeoutMs` + `validate`；`getCryptoQuotes`/`getCryptoKline`/`getCryptoIndexDetail` 改 Binance；`getGlobalIndexDetail` 复用批量结果；`getCombinedIndices` 全球分支失败改 `logger.warn` + `normalizeGlobalMarket()` |
| `service/src/agent/toolsMarket.ts` | `get_index_kline` 描述（`bun run gen:tools` 已重跑） |
| `service/src/__tests__/providers/{tencent-global-indices,yahoo-global-budget,binance-client}.test.ts` | **新增 14 个用例** |
| 文档 | `docs/market-global.md`（重写）、`docs/architecture/{data-sources,module-data-sources,fallback-strategy,data-flow}.md`、`docs/data-sources-and-runtime.md`、`docs/tushare.md`、`README.md`、`AGENTS.md` |

### 验证

服务级（`localhost:8310`）：

| 请求 | 改造前 | 改造后 |
|---|---|---|
| `/api/market/indices/combined` | **83,955ms** | **198ms**（全球 5 条，HSI/HSCEI 带 `market: 港股`） |
| `/api/market/crypto` | **30,006ms** | **762ms**（4 条，provider=binance） |
| `/api/market/kline/global/DJI` | ~15s / 超时 | **225ms**（provider=tencent，26 条） |
| `/api/market/kline/BTC`（带日期窗） | 不支持 | **1.8s**（provider=binance，38 条） |
| `/api/market/index/BTC/detail` | **30,005ms** | **136ms** |
| `/api/market/kline/global/N225`（腾讯未收录） | 84s→静默空 | **3.5s** + 清晰 `providerErrors` |

前端（bow 真机 reload `localhost:8517`）：

- 中国市场 7 张卡（5 A股 + 恒生指数 + 国企指数，**没有重复出现在全球栏**）
- 全球指数 3 张卡（纳斯达克100 / 道琼斯指数 / 标普500）
- 加密货币 4 张卡（BTC/ETH/SOL/BNB，价格与涨跌幅实时）
- 浏览器侧耗时：`/market/indices/combined` **243ms**、`/market/crypto` **1952ms**

`bun run check` 全绿：service 240 tests（+14）/ frontend 268 tests / docs build。
`bun run gen:tools` 已重跑（工具数 59 不变，仅 description 漂移）。

### 遗留（未做，另开任务）

1. N225/KS11/FTSE/GDAXI/FCHI/SENSEX 仍无源（腾讯未收录、Yahoo 不可达、akshare 走东财 push2 同样死）。
2. `fetchYahooGlobalIndices` 的失败没有负缓存 —— 腾讯正常时不会触发，腾讯若整条挂掉才会每 15s 重试一次（有 6s 预算兜着，可接受）。
3. 东财 push2 全挂这件事影响的不只是海外行情（`breadth`、`moneyFlow` 同源），本次未处理。
