# push2 韧性修复：真直连 + 熔断 + 失败显式化

- 日期：2026-10-09
- 状态：**已完成**（P0-1 → P0-3；结果见 §7）
- 触发：上一轮修完海外行情后，怀疑「东财 push2 全挂」还影响 `breadth` / `moneyFlow` 同源链路，遂排查

## 0. 一句话结论

**不是「push2 全挂」，是三层问题叠在一起，其中第一层是我们自己的配置错误：**

1. **东财所有请求都走代理**（不是直连）：`eastmoneyRequest.ts` 写的是 `proxy: 'auto'`，
   而环境里有 `HTTPS_PROXY=http://127.0.0.1:7890` → 全部经 Clash 出去。
   push2 在代理出口下会被 RST，直连却能过。**这是最大的一块**。
   （另外 `proxy: 'never'` 也名不副实：`NODE_USE_ENV_PROXY=1` 让 Node 全局 dispatcher 变成
   `EnvHttpProxyAgent`，`never` 传 `dispatcher: undefined` 等于「随全局」，见 §1.1。）
2. **push2 自身是限流式的**：即使真直连，密集请求后也会整段 RST，静默一会儿再部分恢复。
3. **失败被吞成「0 / 空 + success:true」**：`/api/market/breadth` 现在返回全 0 且
   `provider:'eastmoney', fallback:false`，还被缓存 15s。

> ⚠️ 排查期间为定位问题往 push2 打了约 200 次请求，**失败率被自己拉高了**（同一 URL 同一客户端
> 几分钟内 4/4 → 0/3）。下面的「可用/不可用」结论都标注了当时的探测条件。

## 1. 实测证据（2026-10-09）

### 1.1 `proxy: 'never'` 不等于直连

`service/src/core/fetch.ts`：

```ts
case 'never': return undefined;          // ← 不传 dispatcher
...(dispatcher ? { dispatcher } : {})    // ← 落到「全局 dispatcher」
```

环境有 `NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY` → Node 把全局 dispatcher 装成 `EnvHttpProxyAgent`
→ `never` 的请求照样过代理。实测：

| 环境 | `fetch('https://api.ipify.org')` | push2 七个路径 | push2ex / datacenter / fund |
|---|---|---|---|
| `NODE_USE_ENV_PROXY=1` + 代理 | **216.236.36.28（美国 IP）** | **0/3 全 RST** | 3/3 ✅ |
| 干净 env（无代理变量） | 直连 | `stock/get` 3/3、`clist/get` 3/3、`91.push2` 3/3、`push2his fflow` 3/3 | 3/3 ✅ |

### 1.2 但东财根本没用 `never` —— 它写的是 `auto`

`eastmoneyRequest.ts`（**所有东财调用的唯一出入口**：market / breadth / north-flow / stock / fund / news）：

```ts
return fetchUrl<string>(url, { timeoutMs, proxy: 'auto', headers: { Referer: referer } });
```

所以「国内接口一律 `proxy: never` 直连」这句 AGENTS/README 里的说法**是错的**（文档漂移）。
唯一显式写 `never` 的东财调用是 `eastmoneyFundProvider.fetchFundDetailScript`（pingzhongdata）。

**结论：今天东财全系流量都经 Clash 出去；push2/push2his/91.push2 被 RST，其余（fund / datacenter / push2ex）恰好被放行。**

### 1.3 直连可达性复核（`curl --noproxy '*'`，各 1 次）

| host | 结果 |
|---|---|
| `fund.eastmoney.com`（fundcode_search / rankhandler） | 200 / 0.34s、200 / 2.25s |
| `api.fund.eastmoney.com`（f10 JJFL） | 200 / 0.25s |
| `fundgz.1234567.com.cn` | 200 / 0.17s |
| `newsapi.eastmoney.com` | 200 / 0.23s |
| `api.jijinhao.com`（黄金） | 200 / 0.22s |
| `push2ex.eastmoney.com` | 200 / 0.19s |
| `datacenter-web.eastmoney.com` | 200 / 0.19s |
| `qt.gtimg.cn`（腾讯） | 200 / 0.2s |
| `api.binance.com` | 200 / 0.75s |

→ **把这些调用改回真直连是安全的**（国内接口 + 黄金 + 币安直连都通）。

### 1.4 push2 的限流特征

- 同一 URL、同一客户端、几分钟内：`ulist.np` **4/4 → 0/3**。
- 同一轮里同 host 的 `stock/get`、`clist/get` 却 3/3 → 不是 host 全封。
- 我用 `--dns-result-order=ipv4first` 复测**没有改善**（失败样本里出现过 IPv6 `2402:4e00:...`）
  → IPv4 优先**不是解法**，别当药方。
- 机制未完全定位（WAF 限流 / TLS 指纹 / CDN 边缘差异都可能），所以**不要指望恢复到 100%**，
  兜底 + 熔断才是长期解。

### 1.5 失败被吞成 0

`/api/market/breadth` 抓到的真实响应：

```json
{"success":true,"data":{"upCount":0,"downCount":0,"flatCount":0,
 "limitUp":null,"limitDown":null,"total":0,"scope":"沪深两市","date":""},
 "meta":{"provider":"eastmoney","fallback":false}}
```

`fetchMarketBreadth()` 里 `catch { return empty }` → ProviderChain 视为成功 → 空结果被
`cacheThrough` **缓存 15s**。与「北向资金 null 被读成 0」同一类陷阱，只是这次落在 HTTP 契约上。

## 2. 影响面

| 接口 / 能力 | 上游 | 失败时表现 | 兜底 | 严重度 |
|---|---|---|---|---|
| `/api/market/sectors` | push2 `clist/get` | akshare 降级（每次 spawn Python ~1s）；全挂 → 「暂无数据」 | ✅ | **高**（今天 168 次失败 / 142 次 Python） |
| `/api/market/breadth` | push2 `ulist.np` | **全 0 + success:true + 缓存 15s** | ❌ | **高**（静默撒谎） |
| `/api/stocks/:code/reference` | push2 `stock/get` | 抛错 → 个股弹窗缺信息 | ❌ | 中 |
| `/api/market/sectors/:code/constituents`、pi `get_sector_constituents` | push2 `clist/get` | 503 | ❌ | 中 |
| `/api/alerts/market-anomaly` | sectors | 少报板块异动（静默） | — | 中 |
| `/api/market/money-flow` | push2his `fflow` | warn + akshare 兜底 | ✅ | 低 |
| `/api/market/money-flow/:symbol` | push2 `fflow` | 上游恒 `rc:100, data:null`；**无任何调用方** | — | 低（建议删） |
| `/api/market/kline` | push2his kline（兜底） | `rc:102` 空 → tencent 主源已覆盖 | ✅ | 低 |
| `/api/market/indices` | stock-sdk（不依赖 push2） | — | ✅ | 无 |

pi 工具侧已经用 `data_status` 兜住（`get_market_breadth` / `get_main_flow`），**HTTP 契约没有**。

## 3. 修改计划

### P0-1a 让 `proxy: 'never'` 真的直连（`service/src/core/fetch.ts`）

- 新增记忆化的直连 `Agent`（`undici`），`getDispatcher('never')` 返回它而不是 `undefined`。
- 只动 `never` 分支；`auto` / `always` 行为不变（settings 里配的 proxy 仍生效）。
- 语义写进注释，并补一条**能抓住这个 bug 的回归测试**（见 §4-1）。

### P0-1b 东财请求改直连（`service/src/providers/eastmoney/eastmoneyRequest.ts`）

- `fetchText()` 的 `proxy: 'auto'` → `'never'`。东财全系域名都是国内接口（§1.3 实测直连都通），
  不该绕美国代理。
- 影响面：market / breadth / north-flow / stock / fund / news 全部东财调用。
- 保留 `timeoutMs` / `referer` 参数签名不变。

### P0-2 push2 熔断 + 失败冷却（`eastmoneyRequest.ts`）

现在的循环是「每次都去撞死路、等 10s 超时才降级」。加一个端点级熔断：

- key = `host + pathname`（例如 `push2.eastmoney.com/api/qt/ulist.np/get`）——
  **必须精确到端点**，否则 `ulist.np` 挂了会连带 `clist/get`。
- 连续失败 ≥ 3 次 → 冷却 60s；冷却期内直接抛 `PROVIDER_UNAVAILABLE`（不发起网络请求），
  让上层立刻落到 akshare / tencent。
- 成功一次即清零并关闭。
- 开闸时 `logger.warn` 一次（可观测），短路时刻不打日志（避免刷屏）。
- 失败计数用「抛错」判定（网络 RST、非 2xx、JSON 解析失败都算）；4xx 且返回 200 业务体
  （如 f10 `ErrCode:4`）不算失败。

### P0-3 失败必须显式（`marketBreadth.ts` + DTO + route + pi 工具）

- `MarketBreadthDto` 加 `data_status: 'available' | 'unavailable'` + 可选 `error?: string`。
- `fetchMarketBreadth()`：
  - 成功 → `data_status: 'available'`；
  - 抛错 → `{...empty, data_status:'unavailable', error}`（**不 throw**，保持 HTTP 200 契约）；
  - 上游正常但 total 越界 → 同样 `unavailable`（区分「上游不可用」与「非交易日/尚未更新」写进 `error`）。
- `marketService.getMarketBreadth()`：**unavailable 不进 15s 缓存**（照 `getMarketMoneyFlow` 的
  「先 chain 后按条件 cache.set」写法）。
- `toolsMarket.get_market_breadth`：直接读 `data_status`，去掉 `total > 0` 的重复推断。
- 前端不用 breadth（已 grep 确认），无需改前端。

### P1 恢复被误判的链路（P0-1 落地后验证，不在本次范围）

- 板块 `source` 应长期是 `eastmoney`；`get_sector_constituents` 的「已知缺口」可关闭（同步 AGENTS/docs）。
- 若 eastmoney 稳定了，再给 akshare 降级结果加 60s 缓存 + single-flight（省 Python spawn）。

### P2 清理（可选）

- 删 `/api/market/money-flow/:symbol` + `marketService.getStockMoneyFlow()` +
  `EastMoneyMarketProvider.moneyFlow()`：上游恒空、无调用方、无测试。

## 4. 验收清单

**1）`proxy: 'never'` 真直连（单测，不需要外网）**
起一个「假代理」http server（收到请求就记 hit 并回 200），用 undici 的
`setGlobalDispatcher(new EnvHttpProxyAgent(...))` 模拟 `NODE_USE_ENV_PROXY=1` 的效果，然后：

- `fetchUrl('http://upstream.invalid/', { proxy: 'never' })` → 断言**假代理 hit == 0** 且调用抛错（DNS）；
- `setGlobalProxyUrl('http://127.0.0.1:<假代理端口>')` 后 `fetchUrl(..., { proxy: 'auto' })` → 断言 hit == 1、
  返回假代理的响应（证明 `auto` 仍走代理）。
- 每个用例后还原：`setGlobalProxyUrl(null)` + `setGlobalDispatcher(new Agent())`。

**2）东财请求确实直连（真机）**
起服务后：

```bash
# breadth 应有 data_status: available（或 unavailable 时不再报 0 为真）
curl -s localhost:8310/api/market/breadth | python3 -m json.tool | head -14
# 板块 source 应为 eastmoney（直连下 clist/get 实测可用）
curl -s 'localhost:8310/api/market/sectors?limit=3' | python3 -c "import json,sys;print(json.load(sys.stdin)['source'])"
# 个股参考（StockPopup 用）
curl -s localhost:8310/api/stocks/600519/reference | head -c 200
# 成分股（AGENTS 里的已知缺口）
curl -s localhost:8310/api/market/sectors/BK0491/constituents | head -c 200
```

**3）熔断生效（可观测）**

```bash
# 连续请求同一端点 → 日志里出现一次 breaker open 的 warn；之后同一端点请求应在 <50ms 返回
grep -c "eastmoney breaker open" python/Data/logs/dataservice-$(date +%F).jsonl
grep -c "EastMoney sectors failed" python/Data/logs/dataservice-$(date +%F).jsonl   # 期望显著下降
```

**4）不回归**

```bash
bun run check          # service lint/typecheck/test + frontend + docs
bun run gen:tools      # 若改了 agent/ 下工具描述
```

**5）静置后再下结论**
排查期把 push2 打热了；验证 breadth/板块前**先静置 10~30 分钟**，否则会把限流当成代码问题。

## 5. 取舍与风险

| 项 | 说明 |
|---|---|
| 直连 vs 代理 | 已验证：tencent / fund / fundgz / newsapi / jijinhao / push2ex / datacenter / binance 直连全通（§1.3）。改完全部走直连，少一跳美国代理，延迟下降。 |
| 熔断粒度 | 按 `host+pathname`，互不牵连；冷却 60s、阈值 3，误判代价是「60s 内该端点直接降级」。 |
| breadth 契约 | `success:true` + `data_status:'unavailable'`（与 `get_north_flow` 的先例一致），不改 HTTP 状态码，前端零改动。 |
| push2 仍会限流 | 所以**不要**把熔断当成「修好了」——兜底链（akshare / tencent）必须保留。 |
| 文档漂移 | AGENTS/README 里「国内接口一律 `proxy: never` 直连」与代码不符，本次一并改成事实。 |

## 6. 进度

- [x] P0-1a `core/fetch.ts` 直连 dispatcher + 单测（反证：把 `never` 改回 `undefined` 时测试确实失败）
- [x] P0-1b `eastmoneyRequest.ts` 改直连
- [x] P0-2 端点级熔断
- [x] P0-3 breadth `data_status` + 不缓存 unavailable + pi 工具
- [x] 验收（§4）+ 文档同步（AGENTS/README/docs/architecture/*）

## 7. 落地结果（2026-10-09 13:45-14:05 CST）

### 改动

| 文件 | 内容 |
|---|---|
| `service/src/core/fetch.ts` | **`proxy: 'never'` → 记忆化直连 `Agent`**（曾经返回 `undefined` = 随全局 `EnvHttpProxyAgent`） |
| `service/src/providers/eastmoney/eastmoneyRequest.ts` | `proxy: 'auto'` → `'never'`（全东财调用）；新增**端点级熔断**（`host+pathname`，连续 3 次失败 → 60s 冷却，开闸时 `logger.warn`）+ `resetEastmoneyBreakers()` |
| `service/src/providers/eastmoney/marketBreadth.ts` | 失败/半截数据返回 `data_status:'unavailable'` + `error`，不再静默 `return empty` |
| `service/src/providers/types.ts` | `MarketBreadthDto` 加 `data_status` + `error?` |
| `service/src/services/marketService.ts` | `getMarketBreadth()`：只有 `available` 才写 15s 缓存（unavailable 不钉住） |
| `service/src/agent/toolsMarket.ts` | `get_market_breadth` 直接读 DTO 的 `data_status`（保留兼容回退） |
| 新增测试 | `core/fetch-dispatcher.test.ts`（2）+ `providers/eastmoney-breaker.test.ts`（5）+ breadth 单测改/增（+1） |
| 文档 | AGENTS.md（Proxy 条重写、新增「涨跌家数」条、两处「被反爬切断」加 2026-10-09 更正）、`docs/architecture/{fallback-strategy,module-data-sources,data-sources,pi-tools}.md`、`docs/{market-sector-rank,market-money-flow,market-volume,data-sources-and-runtime}.md` |

### 验证

- **单测反证**：把 `getDispatcher('never')` 临时改回 `return undefined` → `fetch-dispatcher` 用例失败（`expected 'proxied' to be 'direct'`）；恢复后全绿。
- `bun run check` 全绿（service **248** tests / frontend 268 / docs build）。
- 真机（`bun run dev` + tsx watch 已热重载）：

| 验收项 | 结果 |
|---|---|
| `/api/market/breadth` | **真数据**：`up=2020 down=3129 total=5287 limitUp=44 data_status=available date=2026-10-09`（首次 0.86s，缓存后 2ms） |
| `/api/market/sectors`（绕缓存三次） | `source: eastmoney`（`code` 有值：`种子 BK1518`、`黄金 BK1617`）—— 之前是 `akshare_ths` + `code` 空串 |
| `/api/market/money-flow` | `provider: eastmoney`、`fallback: false`（直连下 `push2his fflow` 可用） |
| `/api/market/sectors/BK1617/constituents` | 限流窗口内 `PROVIDER_UNAVAILABLE`，**但**日志能看到 `eastmoney breaker open .../91.push2.../stock/get`，无延迟抖动（降级正常） |
| 日志 | `eastmoney breaker open` 出现后，后续请求瞬时降级（不再等 10s 超时） |

### 遗留

1. push2 仍会限流（无法根除）：例子是同一分钟内 `ulist.np` 可用、`clist/get` 与 `91.push2` 被限——所以降级链 + 熔断必须保留。
2. 个股资金流 `push2 .../fflow/daykline` 直连下仍 `rc:100, data:null`，且无调用方 → 建议删（P2）。
3. 开发环境注意：一天 47 次重启时**多个进程会同时写同一个日志文件**（导致行序错乱、`eastmoney breaker open` 重复出现），排查时不要把它当成 bug。
