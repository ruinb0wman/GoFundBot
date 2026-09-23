# 修复 AI 市场概览的两处数据错误：涨跌家数 & 北向资金

- 日期：2026-09-22
- 状态：待批准
- 触发：用户让 AI 分析今日大盘，AI 自己给出了两段"数据口径存疑"的免责提示

## 0. 一句话结论

两处**都不是"数据没更新"**，而是取数口径写错了：

1. `GET /api/market/breadth` 读的是 `f168/f169/f170`，这三个字段是**上证指数的换手率/涨跌额/涨跌幅**（无 `fltt=2` 时放大 100 倍），不是涨跌家数 → AI 看到 68/873/22 合计 963。
2. `GET /api/market/north-flow` 读的是 `push2 .../kamt.kline/get` 的净额字段，而**北向资金净流入自 2024-08-19 起已停止披露**，该字段恒为 `0`（不是 null），于是既没触发 fallback、又被前端判定为 `data_status: 'available'` → AI 看到"净流入 0"。

## 1. 根因证据（2026-09-22 实测上游响应）

### 1.1 涨跌家数：字段用错

`service/src/providers/eastmoney/eastmoneyMarketProvider.ts:374-409` 现状：

```ts
  // Market breadth – up/down counts
  // Uses the SH index component count fields (f168=up, f169=down, f170=flat).
  // NOTE: Only covers Shanghai market. Shenzhen not available via push2.
  // limitUp/limitDown counts are not reliable from this endpoint.
  async breadth(): Promise<MarketBreadthDto> {
    const url = 'https://push2.eastmoney.com/api/qt/stock/get';
    const params = new URLSearchParams({
      secid: '1.000001',
      fields: 'f58,f168,f169,f170,f292,f293',
      ut: 'bd1d9ddb04089700cf9c27f6f7426281',
    });
    ...
      const name = toString(data.f58 ?? '');
      const upCount = toInt(data.f168);
      const downCount = Math.abs(toInt(data.f169));
      const flatCount = Math.abs(toInt(data.f170));
      const limitUp = Math.abs(toInt(data.f292));
      const limitDown = Math.abs(toInt(data.f293));
      const total = upCount + downCount + flatCount;
      // Sanity check: covers SH+SZ combined (~5000 stocks)
      if (total > 0 && total <= 6000 && (upCount > 0 || downCount > 0)) {
```

实测同一请求：

```
.../api/qt/stock/get?secid=1.000001&fields=f43,f57,f58,f168,f169,f170,f171,f292,f293
→ {"f43":395864,"f58":"上证指数","f168":68,"f169":873,"f170":22,"f171":31,"f292":3,"f293":-1}

.../api/qt/stock/get?secid=1.600519&fields=f43,f57,f58,f168,f169,f170,f171,f292,f293
→ {"f43":125560,"f58":"贵州茅台","f168":13,"f169":303,"f170":24,"f171":142,"f292":3,"f293":0}
```

注意 `f43=395864`（未传 `fltt=2`，价格放大 100 倍 → 3958.64）。据此反推上证指数：`f169=873` = 涨跌额 8.73 点、`f170=22` = 涨跌幅 0.22%、`f168=68` = 换手率 0.68%、`f171=31` = 振幅 0.31%，四者与 3958.64 完全自洽；茅台同样成立（0.13% / 3.03 / 0.24% / 1.42%）。**即 `f168/f169/f170/f171` = 换手率/涨跌额/涨跌幅/振幅（×100），与涨跌家数无关。** `f292/f293` 在指数与个股上恒为 `3` / `-1|0`，也不是涨跌停家数。

正确的字段是 `f104/f105/f106`（上涨/下跌/平盘家数）：

```
.../api/qt/ulist.np/get?fltt=2&invt=2&secids=1.000001,0.399001&fields=f12,f14,f104,f105,f106,f124
→ 上证指数 f104=1240 f105=1031 f106=83  (沪市全体，合计 2354)
   深证成指 f104=1489 f105=1334 f106=109 (深市全体，合计 2932)
   沪深合计 2729 / 2365 / 192，总数 5286（与 A 股不含北交所的规模吻合）
```

涨跌停家数另有来源（东方财富涨跌停池，`data.tc`）：

```
.../push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=1&sort=fbt:asc&date=20260922 → {"tc":57,...}
.../push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=1&sort=fund:asc&date=20260922 → {"tc":0,...}
.../getTopicZTPool?...&date=20260921 → {"tc":103,...}   （date 参数生效）
.../getTopicZTPool?（不带 date）        → {"rc":102,"data":null}  （必须带 date）
```

### 1.2 北向资金：净流入已永久停止披露

`eastmoneyMarketProvider.ts:411-452` 现状：解析 `push2.eastmoney.com/api/qt/kamt.kline/get` 的 `hk2sh` / `hk2sz`，取 `parts[1]` 当净流入。

实测：

```
.../kamt.kline/get?fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54&klt=101&lmt=10&secid=1.000001
→ {"hk2sh":["2026-09-22,0.00,5200000.00,0.00"],"hk2sz":["2026-09-22,0.00,5200000.00,0.00"], ...}
```

净额恒 `0.00`（`lmt=10` 也只回一天）。同源 `kamt/get` 更清楚：`hk2sh.dayNetAmtIn=0.0, buyAmt=0.0, sellAmt=0.0, netBuyAmt=0.0`（北向全 0）；而 `sh2hk`（南向）`buyAmt=2304775.12, sellAmt=1965027.1, netBuyAmt=339748.02`（南向仍完整披露）。

**根因：2024-08-19 起沪深交易所调整沪深港通交易信息披露机制，北向资金不再披露实时买入额/卖出额/净买入，只在每交易日收市后公布成交总额。**（依据：财联社/中国金融信息网 2024-07-26 沪深交易所通知报道）

唯一还活着的北向数据源就是 `python/cli/data_complete.py: complete_north_flow()` 用的那个 datacenter 接口：

```
.../datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_DEAL_HISTORY
   &columns=TRADE_DATE,FUND_INFLOW,NET_DEAL_AMT,DEAL_AMT&sortColumns=TRADE_DATE&sortTypes=-1&pageSize=1&pageNumber=1
MUTUAL_TYPE="005"（北向）→ {"TRADE_DATE":"2026-09-21","FUND_INFLOW":null,"NET_DEAL_AMT":null,"DEAL_AMT":283911.86}
MUTUAL_TYPE="001"（沪股通）→ DEAL_AMT=133832.25
MUTUAL_TYPE="003"（深股通）→ DEAL_AMT=150079.61      （133832.25+150079.61=283911.86 ✓，单位万元 → 2839 亿）
```

**链路为什么没走到这个 fallback**：`marketService.getNorthFlow()`（`marketService.ts:665-700`）只在 provider **抛错**时才降级。push2 返回的是 `0` 而不是 `null`，`chain.run` 视为成功 → 直接返回 0 → 前端 `toolHandlers.get_north_flow` 的 `isAvailable = d.totalNetInflow != null` 判为 `true` → `data_status: 'available'` → AI 拿到"净流入 0"。用户看到的那段提示，是 AI 自己发现口径可疑后加上的。

## 2. 已确认的口径决策

| # | 项 | 决策 |
|---|---|---|
| 1 | 北向资金 | **改报当日成交总额（DEAL_AMT），净流入标记为不可用**：DTO 增成交额字段，`*NetInflow` 一律 `null`，`data_status: 'unavailable'` + note 写明 2024-08-19 披露变更与数据日期 |
| 2 | 涨跌停家数 | **改用 push2ex 涨/跌停池 `tc` 真实计数**；DTO 的 `limitUp/limitDown` 改为 `number \| null`，取不到就是 `null`（不再填假值） |
| 3 | 涨跌家数口径 | **沪深两市合计**（上证指数 + 深证成指 的 `f104/f105/f106` 相加）；DTO 增 `scope: '沪深两市'` 与 `date`（取指数行情 `f124`） |

## 3. 改动文件清单

| 文件 | 改什么 |
|---|---|
| `service/src/providers/types.ts` | `MarketBreadthDto`：`limitUp/limitDown` 改 `number \| null`，新增 `scope`、`date`；`NorthFlowDto`：新增 `shDealAmount/szDealAmount/totalDealAmount`（万元），删除恒为 null 且无消费价值的 `shUpCount/shDownCount/szUpCount/szDownCount` |
| `service/src/providers/eastmoney/eastmoneyRequest.ts` | `fetchText/fetchJson` 增加可选 `referer` 参数（默认不变 `https://fund.eastmoney.com/`）；datacenter 需 `https://data.eastmoney.com/`，push2ex 需 `https://quote.eastmoney.com/` |
| **新增** `service/src/providers/eastmoney/marketBreadth.ts` | `fetchMarketBreadth(): Promise<MarketBreadthDto>`：ulist 取 f104/f105/f106 + f124 → 沪深合计；push2ex 涨跌停池取 `tc` |
| **新增** `service/src/providers/eastmoney/marketNorthFlow.ts` | `fetchMarketNorthFlow(): Promise<NorthFlowDto>`：datacenter `RPT_MUTUAL_DEAL_HISTORY` 取 005/001/003 的 `DEAL_AMT` |
| `service/src/providers/eastmoney/eastmoneyMarketProvider.ts` | `breadth()` / `northFlow()` 改为薄委托（删除已死的 kamt.kline 逻辑与错误注释），文件从 573 行降下来 |
| `service/src/services/marketService.ts` | `getNorthFlowFromAkshare()`（163-190 行）补 `*DealAmount` 映射、删 4 个 `*UpCount: null`；`getNorthFlow()` 注释/日志说明主源已改为 datacenter |
| `frontend/src/services/chatEngine/toolHandlers.ts` | `get_market_breadth`：透传 `scope`/`date`，涨跌停取不到时给 note；`get_north_flow`：固定 `data_status: 'unavailable'`，输出 `*_deal_amount_yi`（亿元）+ 新 note |
| `frontend/src/services/chatEngine/toolContract.ts` | 两个工具的 `description` 写明口径（沪深两市合计 / 净流入自 2024-08-19 停止披露） |
| `frontend/src/services/chatEngine/skills.ts` | `MARKET_OVERVIEW_PROMPT` 职责范围与回答策略补北向口径说明 |
| **新增** `service/src/__tests__/providers/eastmoney-market-provider.test.ts` | 单测（见步骤 7） |
| `docs/architecture/module-data-sources.md` | 路由表 breadth/north-flow 的 provider 链与 TTL；删掉不存在的 `/api/market/limit-up` 行 |
| `docs/data-sources-and-runtime.md` | 100-101 行同上 |
| `docs/architecture/data-sources.md` | 第 18 行 eastmoney 能力表：`northFlow` 标注改走 datacenter |
| `docs/architecture/fallback-strategy.md` | TTL 表「涨停股/涨跌家数 30s」→ 15s（实际 `ttl.marketBreadth = 15s`） |
| `AGENTS.md` | `Known issues` 增两条：北向资金净流入停止披露、`f168-f170` 字段误用 |

## 4. 实施步骤

### 步骤 0 — 前置验证（不写代码，必须先做）
本计划阶段用无自定义头的抓取验证了**响应内容**，但没验证 `eastmoneyRequest` 默认带的 `Referer` 会不会被反爬拦截：

```bash
curl -s -H 'Referer: https://quote.eastmoney.com/' \
  'https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=1&sort=fbt:asc&date=20260922'
curl -s -H 'Referer: https://data.eastmoney.com/' \
  'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_DEAL_HISTORY&columns=TRADE_DATE,FUND_INFLOW,NET_DEAL_AMT,DEAL_AMT&filter=(MUTUAL_TYPE%3D%22005%22)&sortColumns=TRADE_DATE&sortTypes=-1&pageSize=1&pageNumber=1&source=WEB&client=WEB'
```
两个都要回正常 JSON。若 push2ex 拒绝该 Referer，退化为 `https://quote.eastmoney.com/center/gridlist.html` 或省略 Referer（此时涨跌停字段降级为 null，不影响涨跌家数）。

### 步骤 1 — 扩展 DTO
`service/src/providers/types.ts`：

```ts
export interface MarketBreadthDto {
  upCount: number;
  downCount: number;
  flatCount: number;
  limitUp: number | null;    // 取不到为 null，不再填假值
  limitDown: number | null;
  total: number;
  scope: string;             // '沪深两市'
  date: string;              // 数据日期 YYYY-MM-DD（来自指数行情 f124）
}

export interface NorthFlowDto {
  date: string;
  shNetInflow: number | null;    // 恒 null：2024-08-19 起停止披露
  szNetInflow: number | null;
  totalNetInflow: number | null;
  shDealAmount: number | null;   // 当日成交总额，万元
  szDealAmount: number | null;
  totalDealAmount: number | null;
}
```

**验证**：`cd service && npm run typecheck` —— 报错点即所有需要同步修改的调用方（应只有 `eastmoneyMarketProvider.ts`、`marketService.ts`）。

### 步骤 2 — `fetchJson` 支持自定义 Referer
`eastmoneyRequest.ts`（52 行，小改）：

```ts
export async function fetchText(url: string, timeoutMs = 10000, referer = 'https://fund.eastmoney.com/'): Promise<string> {
  return fetchUrl<string>(url, { timeoutMs, proxy: 'auto', headers: { Referer: referer } });
}
export async function fetchJson(url: string, timeoutMs = 10000, referer?: string): Promise<Record<string, unknown>> { ... }
```
现有调用不传第三参 → 行为不变。

**验证**：`cd service && npm test`（现有 `eastmoney-fund-provider.test.ts` 等全绿）。

### 步骤 3 — 新增 `marketBreadth.ts`
`service/src/providers/eastmoney/marketBreadth.ts`：

1. `GET https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&secids=1.000001,0.399001&fields=f12,f14,f104,f105,f106,f124`（`Referer: https://quote.eastmoney.com/`）
2. 按 `f12` 归位（`000001`=沪、`399001`=深）后累加 `f104/f105/f106`；**不依赖数组顺序**
3. `f124`（Unix 秒）按东八区换算成 `YYYY-MM-DD` 与 `YYYYMMDD`（注意不能直接用 `toISOString()`，那是 UTC）
4. 合理性校验：`total >= 3000 && total <= 7000 && (up > 0 || down > 0)`；不满足 → 走"全 0 + `scope:'沪深两市', date:''`"的降级返回（这正是本次用户踩到的场景，宁可报"不可用"也不报半截数据）
5. 涨跌停：并行请求 `getTopicZTPool` / `getTopicDTPool`（`Pageindex=0&pagesize=1`，`date=YYYYMMDD`），读 `data.tc`；`rc !== 0` 或 `data == null` → 该字段 `null`。不做日期回退：休市日 `f124` 本身会停在最近交易日，天然正确
6. 删除死变量 `const name = toString(data.f58 ?? '')`

### 步骤 4 — 新增 `marketNorthFlow.ts`
`service/src/providers/eastmoney/marketNorthFlow.ts`：

- 并行请求 datacenter 三次（`MUTUAL_TYPE` = `005` / `001` / `003`），`Referer: https://data.eastmoney.com/`（与 `data_complete.py:41-44` 一致）
- 映射：`date = TRADE_DATE.slice(0,10)`、`*DealAmount = DEAL_AMT`（万元）、`*NetInflow = null`
- 任一请求失败或 `result.data` 为空 → 抛 `AppError('PROVIDER_UNAVAILABLE', ...)`，交给 `getNorthFlow()` 既有的 python fallback
- 文件顶部注释说明：为什么不再用 `push2 .../kamt.kline/get`（2024-08-19 披露机制调整后净额恒 0）

### 步骤 5 — provider 薄委托 + service 侧对齐
- `eastmoneyMarketProvider.ts`：`async breadth() { return fetchMarketBreadth(); }`、`async northFlow() { return fetchMarketNorthFlow(); }`，替换原 374-452 行整段
- `marketService.ts: getNorthFlowFromAkshare()`：补 `shDealAmount: toNullableNumber(sh.deal_amt)`、`szDealAmount`、`totalDealAmount`，删掉 4 个 `*UpCount: null`
- `marketService.ts: getNorthFlow()`：日志文案改为"主源 datacenter 失败，回退 akshare"

**验证**：`cd service && npm run lint && npm run typecheck && npm test`

### 步骤 6 — 前端工具契约与 handler
`toolHandlers.ts`：

```ts
get_north_flow: async () => {
  try {
    const res = await api.get('/market/north-flow')
    const d = unpack(res)?.data ?? unpack(res) ?? {}
    const toYi = (v: unknown) => (typeof v === 'number' ? +(v / 10000).toFixed(2) : null)
    const hasDealAmount = d.totalDealAmount != null
    return {
      data_status: 'unavailable',
      date: d.date ?? '',
      net_inflow_available: false,
      sh_net_inflow: null, sz_net_inflow: null, total_net_inflow: null,
      total_deal_amount_yi: toYi(d.totalDealAmount),
      sh_deal_amount_yi: toYi(d.shDealAmount),
      sz_deal_amount_yi: toYi(d.szDealAmount),
      note: hasDealAmount
        ? '自 2024-08-19 起沪深港通不再披露北向资金净流入（*_net_inflow 恒为 null，勿解读为 0）；仅公布当日成交总额。以上 *_deal_amount_yi 为最新交易日成交总额（亿元）。'
        : '北向资金数据暂不可用（净流入自 2024-08-19 起停止披露，成交总额也尚未更新）。',
    }
  } catch (error) {
    return { data_status: 'error', note: String(error) }
  }
}
```

`data_status` 恒为 `'unavailable'` 是刻意的：若报 `available` 而 `total_net_inflow: null`，按 `DATA_RULES`/`MARKET_OVERVIEW_PROMPT` 第 3 条 AI 会"使用返回的真实数值"，有把 null 当 0 的风险；报 unavailable 会强制 AI 读 note，而成交额就写在 note 与字段里。

`get_market_breadth`：透传 `scope`、`date`，`limit_up/limit_down` 为 null 时附 note；`data_status` 仍用 `d.total > 0`。

`toolContract.ts` / `skills.ts`：更新 description 与 `MARKET_OVERVIEW_PROMPT`（职责范围里"查询北向资金流向数据"→"查询北向资金成交总额（净流入自 2024-08-19 起停止披露）"）。

**验证**：`cd frontend && npx vue-tsc --noEmit && npm test`

### 步骤 7 — 单测
新增 `service/src/__tests__/providers/eastmoney-market-provider.test.ts`，沿用 `eastmoney-fund-provider.test.ts` 的 `vi.hoisted` + `vi.mock('../../providers/eastmoney/eastmoneyRequest.js')` 模式，mock `fetchJson` 按 URL 分派：

1. breadth 正常 → `{upCount:2729,downCount:2365,flatCount:192,total:5286,limitUp:57,limitDown:0,scope:'沪深两市',date:'2026-09-22'}`
2. breadth 只回一个市场（total=2354）→ 触发 `>= 3000` 校验失败 → 全 0 降级
3. breadth 涨跌停池失败 → `limitUp/limitDown` 为 `null`，家数仍正确
4. northFlow 正常 → `totalNetInflow: null`、`totalDealAmount: 283911.86`、`date: '2026-09-21'`
5. northFlow datacenter 抛错 → 抛 `AppError`

**验证**：`cd service && npm test`（基线 67+ 例）

### 步骤 8 — 文档
按第 3 节表格更新 4 处 docs + `AGENTS.md` 的 Known issues（仿照既有"今日资金流向"条目的写法）。

### 步骤 9 — 端到端人工验证
1. `cd service && npm run dev`
2. `curl localhost:8310/api/market/breadth` → 期望 `total` 在 5200~5700、`limitUp` 为真实值、`scope:"沪深两市"`、`date` 为最近交易日
3. `curl localhost:8310/api/market/north-flow` → `totalNetInflow: null`、`totalDealAmount ≈ 283911`、`date: "2026-09-21"`
4. `cd frontend && npm run dev` → 聊天里问"今天大盘怎么样"，检查 AI 引用的涨跌家数/涨停家数与北向段落的措辞

## 5. 风险与未决

1. **push2ex 的 Referer 未验证**（步骤 0）。若被拦，涨跌停字段降级为 `null`（涨跌家数不受影响），工具契约里已允许 null。
2. **push2ex `date` 参数语义存疑**：实测 `date=20260921` 回 `tc=103` 但 `qdate` 仍是 `20260922`（`qdate` 疑似"查询当日"而非池日期）。数值确实随 `date` 变化 → 参数生效；仍建议步骤 9 盘中交叉核对一次涨停家数。
3. **非交易日**：设计上依赖指数行情 `f124` 停在最近交易日。若某次休市期间 `f124` 前进，`tc` 可能为 0（表现为"涨停 0 家"）——可接受但不精确。
4. **fallback 多样性名存实亡**：Node 主源改成 datacenter 后，与 python fallback 打同一个端点（仅 client 不同）。`data_complete.py` 里 "providing genuine fallback diversity" 的注释需要改写；是否另找一路北向源（`docs/tushare.md` 提到 tushare `moneyflow_hsgt` 需 2000 积分）留待后续。
5. **北向净流入是永久性缺失，不是 bug**：任何"修复"都只是把 `0` 换成"不可用 + 成交总额"。若产品上更希望有一个北向方向的代理指标，可考虑南向资金（实测仍在实时披露）或"前十大成交活跃股"——属新增功能，不在本轮。
6. **`NorthFlowDto` 删除 4 个 `*UpCount` 字段**是小幅契约变更，消费方只有 `toolHandlers.get_north_flow`（本就在改）。若想零契约变更，可保留这 4 个恒 null 字段。
7. **前端 `toolHandlers` 没有测试文件**，本轮前端改动只能靠步骤 9 人工验证。若想补测，需要先搭一个 mock `api` 的 handler 测试 harness——本轮不做。

## 6. 附带发现（不在本轮范围，仅记录）

1. **service 的 500 行限制实际未生效**：`service/eslint.config.js` 的规则对象没有 `files` 字段、也没装 `@typescript-eslint/parser`，所以 `eslint .` 只 lint `.js` 文件（等于只 lint `eslint.config.js` 自己）。证据：`service/src/services/marketService.ts` 有 1378 行（去空行/注释后 ~1210），若规则生效必然报错。frontend 的配置写了 `files: ['**/*.ts', '**/*.vue']`，是真生效的。**本轮不修**——一旦补上 `files`，service 里所有超 500 行的文件会集体爆错，需要单独一轮拆分。
2. `MarketBreadthDto` 之外还有一批死代码/死文档：`LimitUpStockDto`、`MarketProvider.limitUpStocks`、`ttl.marketLimitUp`、文档里的 `GET /api/market/limit-up`（无实现、无路由）。本轮只在文档里删掉那一行。
3. `SettingsAnomalyThreshold.vue` 的「北向资金异动」阈值（`north_inflow_threshold` / `north_outflow_threshold`）全仓库无消费方，且在北向净流入永久缺失后更不可能有数据驱动。建议单独清理或明确标注"预留"。
4. 前端 `get_north_flow` 的 `sh_net_inflow` 等字段一直没标单位（DTO 里是万元）。本轮新增的成交额字段显式带 `_yi` 后缀并写进 note，避免同类歧义。

---

## 7. 实施记录（2026-09-22，已完成）

### 实际落地与计划的差异

1. **拆文件按计划执行**：新增 `service/src/providers/eastmoney/marketBreadth.ts`、`marketNorthFlow.ts`，
   `eastmoneyMarketProvider.ts` 的 `breadth()`/`northFlow()` 变成薄委托，并顺手删掉已死的 `toInt()` 本地辅助函数。
2. **【计划外的重大发现】`DEAL_AMT` 的单位是百万元，不是万元** —— 计划里按「万元」写，实际错了 100 倍。
   证据链：
   - `push2 kamt/get` 是万元：`dayAmtThreshold = 5200000` 即沪股通 520 亿每日额度；且页面渲染的
     港股通(沪) 成交净买额 37.89 亿元 ↔ kamt `netBuyAmt = 378319.07` 完全吻合。
   - 但同一个「港股通(沪) 成交总额」，datacenter 给全天 `59388.4`，kamt 给当天盘中 `4581216.29`
     —— 全天不可能比盘中还小 77 倍，说明两边单位差 100 倍。
   - 最终定论（新闻口径）：2026-09-21 北向 `283911.86` / 沪股通 `133832.25` / 深股通 `150079.61`，
     对应报道「**沪深股通今日合计成交 2839.12 亿** … 沪股通总成交金额 **1338.32 亿**」→ **亿元 = 值 / 100**。
   - 因此前端 `toYi()` 用 `/100`（不是 `/10000`），DTO 的 JSDoc、`marketNorthFlow.ts` 顶部注释、
     `marketService.ts` 注释、`AGENTS.md` 都写明了这个单位坑。
3. **`limitUp/limitDown` 与 `scope`/`date`** 按计划加入；合理性校验区间用 `3000~7000`。
4. **前端 `get_north_flow` 固定 `data_status: 'unavailable'`**，成交额以 `*_deal_amount_yi`（亿元）给出并写进 note。
5. **文档**：改了 `module-data-sources.md`、`data-sources-and-runtime.md`（含 provider 表与能力表）、
   `data-sources.md`、`fallback-strategy.md`（TTL 30s→15s），删掉文档里不存在的 `/api/market/limit-up` 行，
   `AGENTS.md` 新增「北向资金」Known issue 与 2026-09-22 涨跌家数修复条目，并改写
   `python/cli/data_complete.py` 里「genuine fallback diversity」的过时注释。

### 验证结果

| 项 | 结果 |
|---|---|
| `service` lint / typecheck / test | 干净 / 干净 / **12 文件 96 例全绿**（基线 89，新增 7） |
| `frontend` lint / vue-tsc / test / build | 干净 / 干净 / **20 文件 238 例全绿** / 构建成功 |
| `GET /api/market/breadth`（真机） | `{upCount:2323,downCount:2789,flatCount:174,total:5286,limitUp:55,limitDown:1,scope:"沪深两市",date:"2026-09-22"}` |
| `GET /api/market/north-flow`（真机） | `{date:"2026-09-21", *NetInflow:null, totalDealAmount:283911.86, shDealAmount:133832.25, szDealAmount:150079.61}` |
| AI 视角 payload（按 handler 映射后） | breadth 5286 只 + 涨跌停真实值；north `total_deal_amount_yi: 2839.12` / `1338.32` / `1500.8`，与新闻口径一致 |

### 踩到的坑（已记入 MEMORY）

- **`beforeEach(() => mock.mockReset())` 会被 Vitest 当成 teardown 回调**：`mockReset()` 返回 mock 自身，
  Vitest 认为 hook 返回了一个清理函数，于是在测试结束后**再调用一次 mock（无参）**，表现为
  `Cannot read properties of undefined (reading 'includes')`。必须写成块体 `beforeEach(() => { mock.mockReset(); })`
  （仓库里既有的 `eastmoney-fund-provider.test.ts` 恰好就是块体写法，所以一直没暴露）。

### 仍未做 / 待跟进

- 未在真实聊天里跑一次「今天大盘怎么样」（需要 LLM key + 跑起前端）；已用脚本复现了 handler 映射后的 payload。
- `docs` 构建有一个**与本次改动无关**的既有 dead link：`docs/architecture/ai-overview.md:54` 的 `/settings`
  （指向不存在的文档页）。本轮未修。
- 计划 §6 的四条附带发现（service 的 max-lines 未生效、`limitUpStocks` 死代码、
  `SettingsAnomalyThreshold` 的北向阈值无消费方、net-flow 字段缺单位）仍待单独处理。

### 复验补充（2026-09-22 第二轮：真实回退链路）

按「用真实测试验证」的要求补跑了两项上一轮没做的事：

1. **akshare 回退链路真机验证**：临时在 `fetchMarketNorthFlow()` 顶部插一句 `throw`，
   等 `tsx watch` 热重载后 curl `/api/market/north-flow`（等过 15s 缓存窗口）→
   `meta.provider = "akshare"`、`meta.fallback = true`，DTO 数值与主源完全一致
   （`totalDealAmount: 283911.86` / `133832.25` / `150079.61`，净流入全 null）。随后已还原并复验
   `provider: eastmoney / fallback: false`；`grep TEMP-FALLBACK-TEST` 无残留。
2. **Python 侧输出核对**：`python/.venv/bin/python python/cli/data_complete.py --source akshare --type north_flow`
   对 `total/sh/sz` 三键都返回 `deal_amt`（283911.86 / 133832.25 / 150079.61），
   与 `getNorthFlowFromAkshare()` 的映射字段一一对应，`net_deal_amt`/`fund_inflow` 均为 null。

复验后重跑：service lint / typecheck / **96 例**、frontend lint / vue-tsc / **238 例** / build 全部通过。
