# 指数详情页「成交量 / 成交额」拿不到 — 优化方案

> 状态：**Step 1 + 2 + 3 已实现并验收（2026-10-15）**
> 现场：`http://localhost:8517/#/index/sh000001`

## 1. 现状（2026-10-15 实测）

| 页面 | 成交量卡片 | 成交额卡片 |
|---|---|---|
| `#/index/sh000001`（上证） | `510163189`（裸数字，手） | `--` |
| `#/index/sh000300`（沪深300） | 同上 | `--` |
| `#/index/DJI` / `HSI` | `--` | `--` |
| `#/index/BTC` | `--` | `--` |

K 线主图/副图正常渲染；坏的是「报价 → detail DTO」这条路，不是 K 线。

后端直接证据：

```
GET /api/market/index/sh000001/detail
→ "volume":510163189, "amount":0            # amount=0 才是 `--` 的直接原因
GET /api/market/index/DJI/detail
→ "volume":null,       "amount":null
```

## 2. 根因（四条独立链路）

### 2.1 A 股（含个股）：腾讯报价解析取错字段 —— `parseQtQuotes`

`service/src/providers/tencent/tencentMarketProvider.ts:315`

```ts
const volume = parseFloat(parts[6]) || 0;   // [6] = 成交量(手)   ✅
const amount = parseFloat(parts[7]) || 0;   // [7] = 外盘(买卖盘口) ❌ 指数恒 0
```

腾讯原始行（`qt.gtimg.cn`，2026-10-15）：

```
v_sh000001="1~上证指数~000001~3707.48~3767.23~3710.70~510163189~0~0~
            ...~3707.48/510163189/774391973455~510163189~77439197~...";
                                  ^^^^^^^^^^^^^ [35] 价/量/额(元)      ^^^^^^ [37] 万元
```

- `[35]` = `价/成交量/成交额` 三段，第三段 **单位元** = `774391973455`（7743.9 亿）✅ 与盘面口径一致
- `[37]` = 成交额 **万元** = `77439197`
- 个股同样：
  ```
  v_sh600519="...~1312.97/57677/7537706224~57677~753771~..."
  ```
  现在 `amount=32619`（其实是外盘手数），真实成交额 = `7,537,706,224` 元。

> 影响面**超出指数页**：`/api/market/quotes` 的所有消费方（组合页、指数卡片、`getCombinedIndices` / `getMarketOverview`）拿到的 amount 都是外盘手数。

### 2.2 全球指数：DTO 里根本没这两个字段

- `GlobalIndexDto`（`service/src/providers/types.ts:193`）没有 `volume` / `amount`
- `parseTencentGlobalQuotes`（同文件:164）也不映射
- `getGlobalIndexDetail`（`service/src/services/marketService.ts:290`）声明了 `let volume/amount` 后 **从未赋值**，DTO 原样带 null

腾讯原始行其实有（`usDJI` / `hkHSI` 一致）：

```
[36] = 成交量（美股 442523838 / 港股 22416456.5414）
[37] = 成交额（usDJI 22830851046927 / hkHSI 22416456.541）
```

**但两市场量纲不同**（§2.6 实测定案）：港股**指数**行的 `[36]/[37]` 都是「万」（×1e4 → 股/港元）；
美股指数 `[37]` = 成交量 × 指数点位（腾讯合成值）**不可用**，而 `[36]` 是真实成分股成交量（新浪同值）。

Step 2 的实现就是这段：港股 ×1e4，美股指数 amount → null、volume 原值。

### 2.3 加密货币：Binance 报价没带

`service/src/providers/binance/binanceClient.ts:86` 的 `items.push` 只映射 price/open/high/low，
而 24hr ticker 里本来就有 `volume` / `quoteVolume`，只是没用。

### 2.4 前端：裸值透传 + `||` 掩掉真实 0

`frontend/src/components/IndexDetail.vue:46-47`

```vue
<span class="stat-value">{{ detail.volume || '--' }}</span>
<span class="stat-value">{{ detail.amount || '--' }}</span>
```

- 没有单位、没有万/亿缩写
- `||` 会把**真实 0** 也当成缺失（本次恰好因 bug 救场，修完数据源后要换成 `== null`）
- 项目里其实已有现成实现：`useStockPopup.ts:232` 的 `formatVolume`（手/万手）、`formatAmount`（万/亿），指数页没复用
- K 线 tooltip（`成交量: ${d.volume || 0}`）与成交量副图同样吃原始值

### 2.5 附带：腾讯 K 线 amount 的「万元」假设对海外是错的

`fetchKlineFromTencent`（`tencentMarketProvider.ts:128`）对 `row[8]` 统一 `×1e4`：

| 标的 | row[8] | ×1e4 后 | 判断 |
|---|---|---|---|
| sh000001 | 77439197.35 | 7743.9 亿元 | ✅ 万元成立 |
| hkHSI | 22416456.54 | 2241.6 亿港元 | ✅ 万元成立 |
| usDJI | 22830851046927 | 2.28e17 | ❌ 荒谬 |

所以即使指数卡片走了兜底，任何按 `kline.amount` 聚合的地方（含美股 K 线副图）对美股仍是脏数据。

> **已在 Step 3 修复**：`fetchKlineFromTencent` 改为调 `parseTencentKlineAmount(row[8], qtCode)` ——
> `sh/sz/bj/hk` ×1e4，`us*` 个股原值，`us*` 指数（`GLOBAL_INDEX_DEFS` 里那三个）直接 `null`。

## 3. 方案（分层，三步独立可发布）

### Step 1 — A 股 amount 取对字段 + 前端格式化（收益最大、风险最低）

1. `parseQtQuotes`：amount 优先 `parts[35].split('/')[2]`（元），退化 `parts[37] * 1e4`；volume 保持 `[6]`（手）。
2. 空值 null-safe（去掉 `|| 0` 的伪 0）。
3. 前端指数页复用共享格式化：`成交量 → 万手/亿手`、`成交额 → 亿元`，仅 `== null` 才 `--`。

落实后上证/深证/沪深300/科创50/创业板全部恢复，顺带修好组合页成交额 = 外盘手数的问题。

### Step 2 — 全球指数 + 加密补齐这两列

1. `GlobalIndexDto` 加 `volume?: number | null` / `amount?: number | null`。
2. `parseTencentGlobalQuotes`：按市场映射 `[36]`/`[37]`，并做**单位归一**（依赖 §5 探针结论）。
3. `fetchBinanceCryptoQuotes`：映射 `volume`（base 量）/ `quoteVolume`（USDT 额）。
4. `getIndexDetail` / `getGlobalIndexDetail` / `getCryptoIndexDetail`：
   - 抽一个「报价 + 最近一根日 K 合并」的小工具：报价缺 volume/amount 时用 `kline.at(-1)` 兜底（A 股 kline 单位已正确）
   - 三个分支目前各复制 ~40 行 fill 逻辑，顺手合并到一个 `buildIndexDetail()`
5. 注意：前端 `getIndexKline` 走 `/market/kline/:code`，global 会被 `isGlobalIndexSymbol` 路由到 global kline；兜底取值时别取错源。

### Step 3 — K 线 amount 按市场定单位

`fetchKlineFromTencent` 的 `×1e4` 只在 A 股/港股成立。按 §5 探针结论：
- 美股若确认为「美分」→ 除以 100 归一到美元；若无法确认 → **返回 null**，宁缺勿脏
- 同步补 `docs/market-kline.md`（若有）与代码注释

### 契约约定（写进 DTO 注释，避免下次再踩）

- `volume`：A 股 = 手；全球指数/加密 = 各自市场原始量（单位随市场，注释注明）
- `amount`：统一为「计价货币的元」（A 股元 / 港股港元 / 美股美元 / 加密 USDT）
- （可选 follow-up）新增 `volume_unit` / `amount_unit` 字段；不建议现在动，收益小、改动面大

## 4. 测试与验收

**provider 单测**（fixture 用真实 `qt.gtimg.cn` 字符串，随用例带日期注释）：
- `sh000001` / `sh600519`：`amount === Number(parts[35].split('/')[2])`，`volume === Number(parts[6])`
- `usDJI` / `hkHSI`：global DTO 的 volume/amount 非空且落在合理量级
- binance：`volume` / `quoteVolume` 正确映射

**service 测试**：
- `getIndexDetail` 在 quote 缺 volume/amount 时用 kline 兜底（两边都 mock）
- 回归：quote 正常时不覆盖成 kline 值

**前端测试**：格式化函数边界（null / 0 / 亿级）

**人工验收（bow 已能复现现状，直接对比）**：
1. `#/index/sh000001` → 成交量 `5.10亿手`、成交额 `7743.9亿`（与东财/腾讯页面一致）
2. `#/index/DJI`、`#/index/HSI` → 两张卡片都有值
3. `#/index/BTC` → 有值
4. 回归：组合页/指数卡片的成交额不再是「外盘手数」级别的小数字

## 2.6 探针实测结论（2026-10-15，决定 Step 2/3 的量纲）

抓 `qt.gtimg.cn` 报价行 + `newfqkline` K 线行 + 新浪/东财交叉验证：

| 标的 | `[6]`/`row[5]` 成交量 | `[37]`/`row[8]` 成交额 | 与价格自洽性 | 结论 |
|---|---|---|---|---|
| sh000001 | 510163189（手） | `[37]`=77439197、`[35]`末段=774391973455 | 77439197×1e4 ≈ 774391973455 | **万元**，`[35]` 是元 ✅ |
| hkHSI | quote `[6]`=22416456.54 / kline row[5]=224164565414 | `[37]`=row[8]=22416456.54 | ×1e4 = 2241.6 亿 HKD | **万港元**；注意 kline volume 是「股」而 quote 是「万股」 |
| usAAPL | 50061053 股 | `[37]`=17222673505 | 17222673505/342.96 ≈ 5021 万股 ≈ 5006 万股 | **真实美元成交额** ✅ |
| usDJI | 442523838 | `[37]`=22830851046927 | 442523838 × 51621.48 = 2.284e13 **恒等** | **不是货币**：≈ 成交量 × 指数点位（腾讯合成值）❌ |
| usNDX / usINX | 同理 | 3.90e13 / 2.62e13 | 同样恒等于 量 × 点位 | 同上 ❌ |

交叉验证：
- 新浪 `gb_$dji` 只给成交量 `442523838`，与腾讯 `[36]` 一致（成交量可信）
- 东财 `push2 stock/get?secid=100.DJIA` → `f47=442523840`、**`f48=0`（成交额不提供）**
- Binance 24hr ticker：BTC `volume=23249.85 BTC`、`quoteVolume=1901765043 USDT`，单位清晰

⇒ Step 2 的定案：
- **港股**：`amount = [37] × 1e4`（港元）；`volume` 要区分 quote 的「万股」与 kline 的「股」，选一个并注释
- **美股指数**：`amount → null`（腾讯给的是合成值、东财也不提供，宁缺勿脏）；`volume = [36]`（股，已交叉验证）
- **美股个股**：`amount = [37]`（美元，**不乘 1e4**）
- **加密**：`volume = ticker.volume`、`amount = ticker.quoteVolume`（USDT）

> 附带：现有 `fetchKlineFromTencent` 的 `×1e4` 也按上面这张表分市场 —— A 股/港股对，美股必须不乘（美股指数建议直接 null）。

## 5. 待确认 / 风险

- **美股成交额已定案**（§2.6）：指数返回 null，个股用 `[37]` 原值。—— 别再回头猜「美分」。
- **`MarketQuoteDto.volume/amount` 仍是 `number`，`'--'` 由前端负责**：Step 1 只改取值，没动类型；
  以后再想让缺失变成 null 需要先 grep 消费方（`getCombinedIndices` / `getMarketOverview` / 前端）。
- **腾讯字段位置可变**，单测 fixture 必须带抓取日期。
- 全球指数报价有 15s 缓存、global kline 有独立 TTL，改 provider 后需重启 service 才看得到。
- 港股 `[37]` 与 `row[8]` 数值接近（22416456 vs 22416456.54），实现时别把「报价 万港元」和「K 线 万港元」重复乘一次。

## 6. 建议排期

1. ~~**Step 1**（半天）：A 股 amount 字段 + 前端格式化 + 单测~~ —— **已完成 2026-10-15**
   - `parseQtQuotes` 新增 `parseQtAmount()`：`[35]` 末段（元）→ 退化 `[37]`×1e4；`volume` 仍是 `[6]`
   - `frontend/src/utils/number.ts` 新增 `fmtVolumeLots()`（手 → 万手/亿手）与 `fmtMagnitude()`（轴/tooltip 用，无单位）
   - `IndexDetail.vue` 两卡片改用格式化器；K 线 tooltip 成交量用 `fmtMagnitude`（避免给港股/美股贴错「手」）
   - 回归测试 `service/src/__tests__/providers/tencent-a-share-quotes.test.ts`（真实行 fixture，3 例）+ `number.test.ts`
   - 验收：上证页 `成交量 5.10亿手 / 成交额 7743.92亿`（与盘面口径一致）；`bun run check` 全绿
2. **Step 2**（一天）：全球/加密补字段 + detail 合并兜底（量纲按 §2.6）—— **已完成 2026-10-15**
   - `GlobalIndexDto` 加 `volume`/`amount`；`parseTencentGlobalQuotes` 映射 `[36]/[37]`，**港股指数 ×1e4**（该行是「万」单位），**美股指数 amount 恒 null**；
   - `binanceClient` 的 `BinanceTicker` 加 `volume`/`quoteVolume` → `amount`（USDT）；
   - 三个 detail 分支接上：A 股用最近一根日 K 兜底 volume/amount；全球/加密只兜底 volume（美股 K 线 amount 是脏值，Step 3 未修前不能回填）；
   - 前端 `fmtVolumeLots` → `fmtVolume(val, unit)`，单位按 market：A 股「手」/港股·美股「股」/加密币种代码；美股指数成交额卡片的 `--` 带 tooltip 说明（非页面故障）。
   - 验收：DJI `4.43亿股 / --`、HSI `2241.65亿股 / 2241.65亿`、BTC `2.31万BTC / 18.90亿 USDT`。
3. **Step 3**（半天）：K 线 amount 单位按市场修正 —— **已完成 2026-10-15**
   - 新增 `parseTencentKlineAmount(row[8], qtCode)`：`us*` 且属于 `GLOBAL_INDEX_DEFS` 的指数代码 → `null`；其余 `us*`（个股）→ 原值；`sh/sz/bj/hk` → `×1e4`。
   - 验收：`/api/market/kline/DJI` 末行 `amount: null`（原 2.28e17）；`HSI` = 224164565400 港元；`sh000001` 不变。
