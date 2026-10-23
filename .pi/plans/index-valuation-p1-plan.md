# P1 实施方案：指数详情页估值卡（PE + 分位 + 机会/中位/危险值）

> 前置：`.pi/plans/index-valuation-feasibility.md`（可行性 + 数据源实测）。
> 本文只覆盖 **P1**。**P2（pi 工具）、P3（基金页 PE）不做** —— 见 §10「明确不做」。
> 状态：方案待确认，未改代码。

---

## 1. 范围

**做**：指数详情页（`/index/:code`）加一块估值卡，展示 4 类信息：

| 展示项 | 含义 | 单位 |
|---|---|---|
| 当前 PE | 加权滚动市盈率（TTM） | 倍 |
| 分位 | 当前 PE 在窗口内的排名（`percentileRank`） | 0–100% |
| 机会值 / 中位值 / 危险值 | 窗口内 PE 的 20% / 50% / 80% 分位值 | 倍 |

**只覆盖 A 股股票指数**（蛋卷收录的 63 只里的 A 股部分）。海外/港股/加密/未收录指数 → 卡片显示「暂无估值数据」，不报错、不显示 0。

**不做**：估值历史图、PB/股息率/ROE、买卖信号、告警联动、基金页、pi 工具、第三方数据落库。

---

## 2. 页面形态

```
┌───────────────────────────────────────────────────────────────────────┐
│ 上证指数  000001  A股                    ← 现有 header                │
├───────────────────────────────────────────────────────────────────────┤
│ K 线区（现有，不动）                                                    │
├───────────────────────────────────────────────────────────────────────┤
│ 开/高/低/昨收/成交量/成交额/振幅（现有 7 张 stat-card，不动）             │
├───────────────────────────────────────────────────────────────────────┤
│ 估值  蛋卷 · 加权滚动PE(TTM) · 近 10 年周频 · 20/50/80 分位            │  ← 新增
│                                                                       │
│  当前PE        分位         机会值      中位值      危险值              │
│  12.73        49.6%         11.74       12.74       14.18             │
│                                                                       │
│  20% ─────●─────────────────────── 80%    ← 分位条（纯 CSS）            │
│  当前 PE 处于窗口中间位置，历史分位不等于买卖建议。                      │
└───────────────────────────────────────────────────────────────────────┘
```

- 位置：`.stats-section` 之后（`frontend/src/components/IndexDetail.vue:49` 的闭合标签后）。放在 K 线上方会把主图顶下去，不值得。
- 分位条：一条 8px 高的横条，20%/50%/80% 三个刻度线 + 一个圆点表示当前分位（位置 = `percentile`）。**不引入 echarts**（页面已有一个大图，再挂一个图表实例只为一条线不值）。
- 三个「值」的标签带 `title` 提示：「窗口内 PE 的 20% 分位值（不是目标价，也不是买卖信号）」。

---

## 3. 数据源（唯一，无链）

`https://danjuanfunds.com/djapi/index_eva/pe_history/<CODE>?day=all` → `{data:{index_eva_pe_growths:[{ts, pe}]}}`

- 实测（2026-10-22）：0.30–0.36s，17.8KB/只，周频，约 516 点（10 年；科创50 自 2019-12 起 352 点）。
- 无 key、无签名、无登录。**只这一个源**，没有备源（乐咕口径/频率都不同，混用只会自相矛盾 —— 见可行性报告 §4）。
- 代码映射：我们的 `sh000300` → `SH000300`，`sz399006` → `SZ399006`（前缀大写即可，A 股无需查表）。北交所 `bj*`、`1.600519` 形式先走 `normalizeIndexSymbol`（`marketService.ts:370`，需要 `export`）。
- 已知未覆盖（必须显示「暂无」）：`sh000001 上证指数`、`sh000510 中证A500`、`sh000698 科创100`、`sz399673 创业板50`、`sz399005 深证100`。
  ⚠️ **不要**用乐咕「沪市平均市盈率 15.94」冒充上证指数的 PE（中证官方上证指数是 14.93，且历史分位完全不同）。

**取数策略**：直连优先，失败退一次代理（与 `binanceClient.ts` 同款写法）：

```ts
fetchUrl(url, { timeoutMs: 6000, proxy: 'never', as: 'json' })
  → catch → fetchUrl(url, { timeoutMs: 8000, proxy: 'auto', as: 'json' })
  → 仍失败 → 返回 unavailable（不抛到客户端）
```

---

## 4. 口径（必须写进 UI 与文档）

| 项 | 取值 | 说明 |
|---|---|---|
| 指标 | PE **加权滚动（TTM）** | 蛋卷口径。与乐咕「等权滚动」差 1–2 倍（沪深300 12.73 vs 28.62），跨源不可比 |
| 窗口 | 该指数**全部可得周频历史**（A 股宽基 ≈ 近 10 年） | 由数据源起点决定，不裁剪、不做「近5年」开关 |
| 分位 | `count(pe < 当前) / n` | 与蛋卷自带 `pe_percentile` 复现一致（沪深300：我们 49.6% vs 官方 49.8%） |
| 机会/中位/危险 | 窗口内 PE 的 20% / 50% / 80% 分位值 | 分位法取**线性插值**（`quantile` 定义见 §6） |
| 更新 | 数据源当日值，服务端缓存 6h | 盘中不刷新（估值一天一变，刷也白刷） |

页面文案（固定一行，不折叠）：`蛋卷 · 加权滚动PE(TTM) · 近10年周频（2016-10-24~2026-10-22，516点） · 20/50/80 分位`。

---

## 5. 接口设计

### 5.1 HTTP

```
GET /api/market/index/:code/valuation
```

- `:code` 接受 `sh000300` / `000300` / `1.000300`（复用 `normalizeIndexSymbol`）。
- 成功 `200`：`{ success: true, data: IndexValuationDto, meta: {...} }`（走 `sendSuccess` + `ServiceResult`）。
- **任何失败都是 200 + `data_status: 'unavailable'`**（沿用 breadth / north_flow 的既有约定；结构错误才 400）。
- 缓存：`cached: true` 由 `cache.set` 的返回值带出；`unavailable` **不进缓存**（沿用 `getMarketBreadth` 的做法，`marketService.ts:846`）。

### 5.2 DTO（`service/src/types/valuation.ts`）

```ts
export interface IndexValuationDto {
  code: string;                 // 'sh000300'  （我们的规范代码）
  source_code: string | null;   // 'SH000300'
  name: string | null;          // '沪深300'（数据源不返名称 → null，前端用 detail.name）
  as_of: string;                // '2026-10-21' 历史末点日期
  data_status: 'available' | 'unavailable';
  pe: number | null;
  percentile: number | null;    // 0.496（0..1）
  bands: {
    opportunity: number | null; // 20% 分位
    median: number | null;      // 50%
    danger: number | null;      // 80%
  };
  window: { start: string; end: string; points: number; freq: 'weekly' } | null;
  definition: string;           // 一行口径说明，前端直接渲染
  error?: string;               // 仅 unavailable 时给原因
}
```

示例（2026-10-22 实测值，可直接当验收基准）：

```json
{
  "code": "sh000300", "source_code": "SH000300", "name": null,
  "as_of": "2026-10-22", "data_status": "available",
  "pe": 12.7291, "percentile": 0.496,
  "bands": { "opportunity": 11.7383, "median": 12.737, "danger": 14.1813 },
  "window": { "start": "2016-10-24", "end": "2026-10-22", "points": 516, "freq": "weekly" },
  "definition": "加权滚动PE(TTM) · 近10年周频 · 20/50/80 分位 · 来源 蛋卷"
}
```

---

## 6. 分位算法（`packages/core/src/valuation.ts`，新增 ~45 行）

放 core 的理由：纯函数、与前端同源同值（若以后基金页/策略要用，不必再写一份）；也是唯一需要单测的数学。

```ts
/** 线性插值分位数（与 Excel PERCENTILE.INC 同义）。values 不必有序。 */
export function quantile(values: number[], q: number): number | null
/** 当前值在序列中的排名分位：count(v < current) / n（并列按「小于」计，不取中点）。 */
export function percentileRank(values: number[], current: number): number | null
/** 一次给出 20/50/80 三档 + 当前分位；序列 < MIN_POINTS 时返回 null。 */
export function buildPeBands(values: number[], current: number): {
  percentile: number | null;
  opportunity: number | null; median: number | null; danger: number | null;
}
```

- `MIN_POINTS = 30`（少于 30 个周频点不给分位 —— 科创50 有 352 点，够；新指数不给假精度）。
- 空值/非有限值先过滤；`q` 越界由 `quantile` 内部 clamp。

---

## 7. 后端改动清单

| 文件 | 动作 | 估行数 |
|---|---|---|
| `service/src/providers/danjuan/danjuanValuationClient.ts` | **新增**：`fetchIndexPeHistory(code)`（含直连→代理重试、超时、`{ts,pe}[]` 解析、空数组=未覆盖） | 70–90 |
| `service/src/services/valuationService.ts` | **新增**：`getIndexValuation(symbol)` —— 代码映射 → 取数 → `buildPeBands` → DTO；含缓存键/降级/日志 | 110–140 |
| `service/src/types/valuation.ts` | **新增**：DTO（也可放 `marketService.ts` 的 DTO 旁边，见备注） | 30 |
| `service/src/core/cache.ts` | 加 `marketValuation: 6 * 60 * 60 * 1000`（`ttl` 对象末尾，`marketAkshare` 之后） | 1 |
| `service/src/routes/market.routes.ts` | `/index/:code/detail` 之后加一条 GET | 6 |
| `service/src/services/marketService.ts` | `normalizeIndexSymbol` 加 `export` | 1 |
| `packages/core/src/valuation.ts` + `index.ts` | **新增** + 导出 | 45 / 1 |

关键骨架（service）：

```ts
const KEY = (code: string) => `market:valuation:${code}`;

export async function getIndexValuation(symbol: string): Promise<ServiceResult<IndexValuationDto>> {
  const code = normalizeIndexSymbol(symbol);                 // sh000300
  const cached = cache.get<ProviderChainResult<IndexValuationDto>>(KEY(code));
  if (cached) return toServiceResult(cached);

  if (!/^(sh|sz)\d{6}$/.test(code)) return unavailable(code, '仅支持 A 股股票指数');

  try {
    const points = await fetchIndexPeHistory(code);            // [] = 该指数未收录
    if (points.length === 0) return unavailable(code, '该指数暂无估值数据');
    const dto = buildDto(code, points);                        // 内部调 buildPeBands
    return toServiceResult(cache.set(KEY(code), { value: dto, ...meta }, ttl.marketValuation));
  } catch (err) {
    logger.warn('index valuation unavailable', { code, error: describeError(err) });
    return unavailable(code, '估值数据源暂不可用');             // 200 + unavailable，不缓存
  }
}
```

`unavailable()` 返回 `{ value: dto, cached: false, updatedAt: new Date() }`，**不经过 `cache.set`**。

> 备注：`marketService.ts` 已经 1762 行（远超 500 行约定；实测 service 的 eslint 只覆盖 `**/*.js`，`.ts` 根本没被 lint —— 顺带记录，本次不动它）。新代码一律进新文件，不往 `marketService.ts` 里堆。

---

## 8. 前端改动清单

| 文件 | 动作 | 估行数 |
|---|---|---|
| `frontend/src/components/IndexValuation.vue` | **新增**：自取数（`marketAPI.getIndexValuation`）+ 卡片 + 分位条 + 三态（loading / available / unavailable） | 150–190 |
| `frontend/src/components/IndexDetail.vue` | `.stats-section` 后插 `<IndexValuation :index-code="props.indexCode" />` + import，共 2 行 | 2 |
| `frontend/src/services/api.ts` | `marketAPI` 加 `getIndexValuation(code)` | 1 |

组件要点：

- 自成一体、自己 fetch（不污染 `useFundDetail`/`IndexDetail` 的脚本；`IndexDetail.vue` 已经 530 行）。
- 三段状态：`loading` → 一行骨架灰字；`available` → 5 个数值 + 分位条；`unavailable` → `暂无估值数据（该指数未覆盖）`，整卡不高亮、不报警色。
- 复用现有 CSS 变量（`--bg-subtle` / `--border-subtle` / `--text-tertiary` / `--color-danger|success`），沿用 `.stat-card` 视觉语言（可参考 `IndexDetail.vue:506-529`）。
- 分位条配色只表达「位置」，不用红绿：`--color-primary` 圆点 + 中性灰条；`title` 里补一句「历史分位不是买卖信号」。
- 数字格式：PE / 三档带值保留 2 位；分位显示 1 位百分数（`49.6%`）。
- 不新增依赖、不新增 echarts 实例。

---

## 9. 测试计划

| 层 | 文件 | 用例 |
|---|---|---|
| core | `service/src/__tests__/core/valuation.test.ts`（新） | `quantile([1..10], .2/.5/.8)` 精确值；`percentileRank` 含并列/重复值；序列 < 30 → null；空数组/NaN 过滤 |
| provider | `service/src/__tests__/providers/danjuan-valuation.test.ts`（新） | ① 映射 `sh000300→SH000300`、`1.000300→SH000300`、`BJ430047`/`BTC` → 拒绝；② 真实 fixture（下方逗号串）解析 → `pe/percentile/bands` 与记录值一致（±1e-6）；③ `{result_code:0}` 无 data → `[]`；④ HTTP 500/超时 → 抛错（由 service 兜）；⑤ 直连失败 → 命中代理重试（mock fetch 调用 2 次） |
| service | `service/src/__tests__/services/index-valuation.test.ts`（新） | ① 首次取数后第二次命中缓存（fetch 只调 1 次）；② `unavailable` 不缓存（连续两次都打 fetch）；③ 全失败返回 `200 + data_status:'unavailable' + error`，不抛 |
| 前端 | `frontend/src/__tests__/components/IndexValuation.test.ts`（新） | ① available 渲染 5 个数与百分比；② unavailable 渲染灰字且不渲染数字；③ loading 态 |

fixture 写法沿用仓库习惯（**内联**，见 `tencent-a-share-quotes.test.ts`）：把 516 个 PE 压成一行逗号串

```ts
// 2026-10-22 抓取，SH000300 周频 PE（截止 2026-10-21）
const SH300_PE = '13.3378,12.9038,13.0166,...'; // 末值 12.7291
```

三条验收用黄金数字（同一 fixture 必须算出）：

| 指数 | pe | 分位 | 机会/中位/危险 |
|---|---|---|---|
| 沪深300 | 12.7291 | 49.6% | 11.74 / 12.74 / 14.18 |
| 创业板指 | 29.7543 | 13.4% | 32.36 / 42.07 / 55.42 |
| 科创50 | 106.0154 | 77.3% | 43.14 / 69.15 / 131.97 |
| 深证成指 | 25.3989 | 39.7% | 23.11 / 26.31 / 30.48 |

---

## 10. 明确不做（防蔓延）

| 不做 | 原因 |
|---|---|
| pi 工具 `get_index_valuation` | 用户明确 P2 不做；工具面变更还要跑 `gen:tools` |
| 基金详情页 PE / 三档带值 | 用户明确 P3 不做；覆盖率 13%、语义错位 |
| 估值历史折线图 | 一个 10KB 序列 + 一个 echarts 实例，只为看一条「误差带里的线」；要做留到有用户反馈之后 |
| PB / 股息率 / ROE / `eva_type`（低估/高估标签） | 不在需求内；`eva_type` 是第三方的营销标签，与本方案的「数值 + 窗口」哲学冲突 |
| 多源取平均 / 备源链 | 口径不同，平均出来谁都不认（可行性报告 §4） |
| 把上证综指用「沪市平均 PE」顶替 | 口径不同（15.94 vs 14.93，历史分位完全不同）。宁可显示「暂无」 |
| 估值数据落 SQLite | 每次 17.8KB/0.3s，6h 内存缓存足够；落库只会增加迁移与淘汰逻辑 |
| 告警/提醒联动（分位 > 80% 提醒） | 需要产品决策与误报成本评估，P1 不做 |

---

## 11. 验收标准

1. `curl -s localhost:8310/api/market/index/sh000300/valuation | jq .data` → 与 §5.2 示例一致（±0.01）。
2. `curl -s localhost:8310/api/market/index/sh000001/valuation | jq .data.data_status` → `"unavailable"`，`error` 写明未收录。
3. `curl .../index/BTC/valuation`、`.../index/DJI/valuation` → `unavailable`（不 500）。
4. 页面 `/index/sh000300`：K 线上方数字不变，底部出现估值卡；`/index/sh000001` 估值卡显示「暂无估值数据」。
5. 第二次请求命中缓存（日志无第二次上游请求；响应 `meta.cached: true`）。
6. `bun run check` 全绿（service lint/typecheck/test + frontend lint/vue-tsc/test/build + docs build）。
7. 新增文档 `docs/market-index-valuation.md` 已挂进 `docs/.vitepress/config.ts` 的「市场行情」分组（`市场指数近一月走势` 之后），并在 `AGENTS.md`「Known issues / Key details」补一段口径坑（±8 行）。

---

## 12. 工作量与顺序

| # | 任务 | 估时 |
|---|---|---|
| 1 | core `valuation.ts` + 单测 | 0.2 人日 |
| 2 | danjuan client + 单测（含 fixture 采集） | 0.3 人日 |
| 3 | `valuationService` + 路由 + 缓存 + 单测 | 0.3 人日 |
| 4 | 前端组件 + 接入 + 组件测 | 0.4 人日 |
| 5 | 文档 + AGENTS + 手工验收（含 4 个指数核对） | 0.2 人日 |
| 6 | 缓冲（口径文案来回改、数据源抽风） | 0.2 人日 |
| | **合计** | **≈1.6 人日** |

提交建议切成 3 个 PR/commit：`core+provider`（可单测）→ `service route`（可 curl）→ `frontend+docs`（可见）。

---

## 13. 风险与应对

| 风险 | 应对 |
|---|---|
| 蛋卷接口改版/加鉴权（它 `/pe/` 已经要登录，`/pe_history/` 还开放） | 单测钉真实 fixture（改版即红）；失败降级为「暂无估值」；日志 `index valuation unavailable` 计数可观测 |
| 用户把「危险值」当卖出信号 | 文案写死「历史分位不是买卖信号」+ `title` 解释分位定义；不做红绿箭头/提醒 |
| 上证综指没有估值 → 用户以为坏了 | 卡片显示「该指数暂无估值数据（数据源未收录）」，并在文档里列明未覆盖清单 |
| 口径被误读（和别的 app 对不上） | 卡片固定展示来源/窗口/分位定义；文档写一张 4 源对照表（可行性报告 §4） |
| 6h 缓存导致「今天跌了估值没变」 | 可接受（PE 日更）；`as_of` 显式展示，用户能看到数据日期 |
| 代码里留下隐性限制 | 按仓库约定加 `// shortcut: 只支持蛋卷收录的 A 股指数，未覆盖时显示「暂无」；要扩覆盖需再接源并重新定义窗口` |

---

## 14. 一句话

**一个 HTTP + 一个纯函数 + 一张卡**：指数详情页给出「当前 PE、10 年分位、20/50/80 分位值」，口径与窗口写在脸上，取不到就说取不到 —— 不碰基金、不碰策略、不接第二个源。
