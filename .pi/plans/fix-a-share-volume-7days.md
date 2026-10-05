# 修复「近7日A股成交量」为空

## 0. 目标与假设

**目标**：恢复首页「近7日A股成交量」柱状图（实际展示的是沪深两市每日**成交额**，单位亿元）。

**假设**：
- 本方案以「根因修复」为主：`/api/market/volume/7days` 依赖的整条 K 线链路当前全部失效，只修聚合函数无法恢复数据。
- 数据语义保持现状：图表数值 = `上证指数.amount + 深证成指.amount`（元）/1e8 = 亿元，`beijing` 仍为占位 `0亿`（已知问题，不在本次范围）。

---

## 1. 根因（已用运行中的服务与上游实测确认）

### 1.1 现象
```
GET http://localhost:8310/api/market/volume/7days
→ {"success":true,"data":[],"update_time":"2026-09-29T14:40:31.222Z"}
```

### 1.2 直接原因：akshare 回退不返回 `amount`，聚合过滤器把全部行丢光

`service/src/services/marketService.ts` `getAVolume7Days()`（约 1211–1268 行）只收 `item.amount != null` 的行：

```ts
for (const item of shLast7) {
  if (item.date && item.amount != null) {
    volumeMap.set(item.date, { date: item.date, shanghai: item.amount, shenzhen: 0 });
  }
}
...
return { success: true, data: result, update_time: updateTime };   // 即使 result 为空也 success:true
```

而这条链最终落到 Python akshare（Sina），`python/cli/data_complete.py:95` **硬编码**：

```python
"volume": int(row["volume"]),
"amount": None,
```

实测 `/api/market/kline/sh000001?period=daily&startDate=20260915&endDate=20260929`：
```json
{"meta":{"provider":"akshare","fallback":true,"cached":true},
 "data":[{"date":"2026-09-29", ..., "volume":39947339100, "amount":null}, ...]}
```
→ 聚合时全部被 `amount != null` 过滤 → `data: []` → 前端「暂无成交量数据」。

### 1.3 上游原因：ProviderChain 的 4 个 K 线 provider 全部失效

今日日志出现 126 次：
```
"message":"All kline providers failed, trying akshare fallback"
```

| provider | 端点 | 实测结果 |
|---|---|---|
| joinquant | `dataapi.joinquant.com` | 未配置 API key → 直接抛错 |
| tencent | `https://web.ifzq.gtimg.cn/app/app/kline/kline` | `{"code":11,"data":"","msg":"No dispatch info found"}`（**端点已失效/写错**）→ `[]` |
| stock-sdk | `push2his.eastmoney.com`（含 33/63/7/91 子域） | `RemoteDisconnected` / `ERR_EMPTY_RESPONSE` |
| eastmoney | `https://push2his.eastmoney.com/api/qt/stock/kline/get` | 同上 |

实测（Python `requests` 直连，排除代理干扰）：
```
push2his.eastmoney.com       -> ERR ConnectionError RemoteDisconnected
33.push2his.eastmoney.com    -> ERR ...
63.push2his.eastmoney.com    -> ERR ...
7.push2his.eastmoney.com     -> ERR ...
91.push2his.eastmoney.com    -> ERR ...
push2.eastmoney.com          -> ERR ...
datacenter-web.eastmoney.com -> 200        # 北向资金仍正常
push2ex.eastmoney.com        -> 404（可达）
```
即 `push2`/`push2his` 系列已被反爬切断（与 `docs/market-money-flow.md` 记载的 push2his 反爬一致），而 K 线链路（stock-sdk 与 eastmoney provider）**完全依赖它**。`docs/architecture/fallback-strategy.md` 里「A 股 K 线：stock-sdk → eastmoney」的备选形同虚设。

### 1.4 影响范围
同一根因还导致个股 K 线失效：`/api/market/kline/600000?...` 返回 `meta.provider:"none", data:[]`，即 StockPopup（`frontend/src/composables/useStockPopup.ts:55` → `/market/kline/:code`）也拿不到数据。

### 1.5 已验证的可用替代源
腾讯「新格式」K 线接口（akshare 内部同源 host）：
```
GET https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get
    ?param=sh000001,day,2026-09-15,2026-09-30,10,qfq
→ {"code":0,"data":{"sh000001":{"day":[
    ["2026-09-29","3816.15","3830.45","3843.84","3810.81","399473391.00",{},"0.82","66170429.28","0.00","0.00"],
    ...]}}}
```
字段（0-based）实测确认：
- `[0]` date、`[1]` open、`[2]` close、`[3]` high、`[4]` low
- `[5]` volume（**手**）、`[7]` 换手率(%)、**`[8]` 成交额（万元）**
- 交叉验证：2026-09-29 上证 `[8]=66170429.28` 万元 = `661,704,292,801` 元，与该接口同响应里 `qt[35]=661704292801` 完全一致；`sh600000` `[8]=73974.10` 万元 ≈ 撮合量 `805097 手 × 100 × 9.18 元`。
- node key：指数为 `day/week/month`，个股（复权时）为 `qfqday/hfqday` 等；`code` 非 0 表示失败。
- 备选 host `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get` 同样可用，但**只有 6 个字段（无 amount）**，仅能作无 amount 场景的回退。
- 注意：`count` 参数决定返回条数（`start` 更像下限钳制），请求 `count=640` 即使窗口很窄也会返回 640 行 → **必须按 `[startDate,endDate]` 过滤后再用**。

---

## 2. 建议方案（根因修复，推荐）

**一句话**：修好 `TencentMarketProvider.kline`，让它用可用的腾讯新接口并填充 `amount`（万元→元）；这样 `getMarketKline()` → `getAVolume7Days()` 与个股 K 线一起恢复；再顺手让 `getAVolume7Days` 不再静默成功。

### 2.1 需要改动的文件

| 文件 | 改动 | 为什么 |
|---|---|---|
| `service/src/providers/tencent/tencentMarketProvider.ts` | **重写 `kline()`**：换端点 + 解析数组格式 + `amount = row[8] × 1e4` + 按窗口过滤 + 计算 change | 当前端点 `app/app/kline/kline` 返回 `code:11`，provider 永远返回空 |
| `service/src/services/marketService.ts` | `getAVolume7Days()`：记录失败原因；`result` 为空时返回 `success:false` 并 `logger.error` | 现在 `allSettled` 吞掉所有异常、空结果仍 `success:true`，无法定位 |
| `service/src/__tests__/providers/tencent-market-kline.test.ts` | **新增** | 固定新解析逻辑（金额换算、node key、窗口过滤） |
| `docs/market-volume.md` | 更新数据流/数据源章节 | 当前文档称主源是 push2his（已失效） |
| `docs/architecture/module-data-sources.md` | 第 33 行 `[stock-sdk → eastmoney]` → `[tencent → stock-sdk → eastmoney]` | 与代码/实际一致 |
| `docs/architecture/data-sources.md`、`docs/data-sources-and-runtime.md` | tencent provider 能力栏加 `kline` | 文档漂移 |
| `AGENTS.md` Known issues | 增加 push2his K 线反爬 + 腾讯新端点 | 避免下次再查一遍 |

`python/cli/data_complete.py` 的 `amount: None` **本次不改**：Sina 日线没有成交额，改也拿不到；腾讯已在 Node 侧兜住。可在文档注明该回退不具备成交额能力。

### 2.2 `TencentMarketProvider.kline` 目标实现（伪代码）

```ts
const KLINE_URL = 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get';

async kline(symbol, options) {
  const qtCode = toQtCode(symbol);
  if (!qtCode) throw new AppError('PROVIDER_UNAVAILABLE', ...);

  const period = { daily: 'day', weekly: 'week', monthly: 'month' }[options.period] ?? 'day';
  const fq = options.adjust === 'hfq' ? 'hfq' : options.adjust === 'qfq' ? 'qfq' : '';
  const start = toDashed(options.startDate);   // YYYYMMDD → YYYY-MM-DD
  const end   = toDashed(options.endDate);
  // count 决定返回条数，start 只是钳制；给够条数再按窗口过滤
  const count = start && end
    ? Math.min(640, Math.max(20, calendarDays(start, end) + 10))
    : period === 'day' ? 320 : 200;

  const param = [qtCode, period, start, end, count, fq].join(',');
  const data = await fetchUrl<Record<string, unknown>>(
    `${KLINE_URL}?${new URLSearchParams({ param })}`,
    { timeoutMs: 8000, proxy: 'never', as: 'json', headers: { Referer: 'https://gu.qq.com/' } },
  );
  if (Number(data.code) !== 0) return [];

  const node = (data.data as any)?.[qtCode];
  const rows = pickRows(node, period, fq);        // 依次尝试 `${fq}${period}` / `${period}`
  if (!Array.isArray(rows)) return [];

  const cleanCode = qtCode.replace(/^(sh|sz|bj)/i, '');
  let prevClose: number | null = null;
  const mapped: KlineDto[] = [];
  for (const row of rows) {
    const date = String(row?.[0] ?? '');
    if (!date) continue;
    const close = toNullableNum(row[2]);
    const change = prevClose != null && close != null ? close - prevClose : null;
    const changePercent =
      prevClose != null && prevClose !== 0 && close != null ? (change! / prevClose) * 100 : null;
    const amountWan = toNullableNum(row[8]);      // 万元
    mapped.push({
      code: cleanCode, date, timestamp: new Date(date).getTime(),
      open: toNullableNum(row[1]), close, high: toNullableNum(row[3]), low: toNullableNum(row[4]),
      volume: toNullableNum(row[5]),               // 手
      amount: amountWan != null ? amountWan * 1e4 : null,  // → 元（与其他 provider 对齐）
      change, changePercent,
      turnoverRate: toNullableNum(row[7]),
    });
    prevClose = close;
  }

  // 腾讯会返回超过窗口的行，按 [startDate,endDate] 过滤（YYYYMMDD 比较）
  return mapped.filter((k) => {
    const d = k.date.replace(/-/g, '');
    return (!options.startDate || d >= options.startDate) && (!options.endDate || d <= options.endDate);
  });
}
```

要点：
- `amount` 必须是**元**：`frontend/src/composables/useStockPopup.ts:233 formatAmount` 与 `getAVolume7Days` 的 `/1e8` 都按元处理。
- `volume` 保持**手**：`formatKlineVolume` 按手展示。
- 内部回退：若 `proxy.finance.qq.com` 抛错，可再试 `web.ifzq.gtimg.cn/appstock/app/fqkline/get`（无 amount，`amount:null`），避免整条链路失败。
- 保留 `toQtCode`（已支持 sh/sz/bj + 指数）与错误抛出语义（空数组让 ProviderChain 继续降级）。

### 2.3 `getAVolume7Days` 的健壮性（小改）

- `Promise.allSettled` 后把 rejected 的 reason 用 `logger.error` 打出（含 sh/sz），避免再次出现「静默空数据」。
- `result.length === 0` 时 `logger.error('a-volume-7days empty', {...})` 并返回 `{ success: false, data: [], update_time }`。

### 2.4 备选方案（若不想动共享 provider，可接受范围更小的补丁）

只改 `getAVolume7Days()`：直接 `fetchUrl` 上面那个腾讯端点，取 `row[8]`（万元）算沪深合计，不再走 `getMarketKline`。
- 优点：改动面最小，只影响这一个接口。
- 缺点：个股 K 线（StockPopup）仍旧是坏的；解析逻辑重复。**不推荐**，除非明确只想修这一个图表。

---

## 3. 实施步骤（每步可独立验证）

1. **改 `TencentMarketProvider.kline`**（`service/src/providers/tencent/tencentMarketProvider.ts`）
   验证：`cd service && bun run typecheck`。
2. **加单元测试** `service/src/__tests__/providers/tencent-market-kline.test.ts`
   - `vi.mock('../../core/fetch.js', ...)` stub `fetchUrl`；
   - 用例：① 指数行 `amount` 万元→元、change/changePercent 由前收算出；② 个股 key=`qfqday` 且按窗口过滤掉多余行；③ `code:11` → `[]`；④ 请求 URL 含正确 `param`。
   验证：`cd service && bun run test`。
3. **改 `getAVolume7Days`**（`service/src/services/marketService.ts`）加日志与空结果 `success:false`。
   验证：`cd service && bun run lint && bun run typecheck && bun run test`（单文件 ≤500 行）。
4. **重启 service 清缓存**（`market:kline:*` TTL=1h，内存缓存需重启即时生效，`cache.ts:170`）。
   验证（浏览器/curl 直打 8310）：
   - `GET /api/market/kline/sh000001?period=daily&startDate=20260915&endDate=20260929` → `meta.provider:"tencent"`、`amount != null`；
   - `GET /api/market/kline/sz399001?...` 同上；
   - `GET /api/market/volume/7days` → `data.length === 7`，形如 `total:"1xxxx.xx亿"`；
   - `GET /api/market/kline/600000?...` → 个股也有数据（回归 StockPopup）。
5. **前端目视验证**：首页「近7日A股成交量」出现 7 根柱、tooltip 有沪/深明细；打开个股弹窗确认 K 线恢复（`cd frontend && bun run dev`，8517）。
6. **更新文档**：`docs/market-volume.md`、`docs/architecture/module-data-sources.md`、`docs/architecture/data-sources.md`、`docs/data-sources-and-runtime.md`、`AGENTS.md` Known issues。
   验证：`cd docs && bun run build`（可选）。

---

## 4. 风险 / 未知

| 风险 | 说明 | 缓解 |
|---|---|---|
| `proxy.finance.qq.com` 也可能被临时封 | 目前可用且是 akshare 同源 host；一旦失效，链路上只剩无 amount 的源 | provider 内保留 `web.ifzq.gtimg.cn/appstock/app/fqkline/get` 回退；py akshare 仍兜底（但无 amount） |
| 腾讯 `count/start` 语义变化 | 文档未公开；实测 `count` 决定条数、`start` 仅钳制 | 统一「先取足量、后按窗口过滤」，并加单测锁定 |
| 缓存导致看不到即时效果 | `market:kline:*` TTL 1h | 重启 service（内存缓存） |
| push2his 是否永久不可用未知 | 与已知 push2 clist 反爬同源，可能长期 | 本次修复后 K 线不再依赖它，属净收益 |
| Python baostock 回退无输出 | `600000` 走 Python 时 baostock/akshare 都返回空（akshare 的 `stock_zh_index_daily` 只支持指数） | 不在本次范围；修 Tencent 后个股不再需要它，可另立 issue |

**未确定**：`push2his` 是全网封锁还是本机/出口 IP 问题；`baostock` 是否安装可用（对本次修复不阻塞）。
