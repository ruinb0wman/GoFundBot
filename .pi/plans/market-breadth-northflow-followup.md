# 后续：涨跌家数 / 北向资金 修复的文档与提示词同步

- 日期：2026-09-22
- 前置：`.pi/plans/market-breadth-northflow-fix.md`（代码已实现并验证完毕，本文件只列**尚未应用**的同步项）
- 触发：用户问「哪些文档需要更新，以及给 AI 的提示词或工具是否需要更新」

上一轮已改好：`AGENTS.md`、`docs/architecture/{data-sources,module-data-sources,fallback-strategy}.md`（部分）、
`docs/data-sources-and-runtime.md`（部分）、`toolContract.ts`（两个工具的 description）、
`skills.ts`（MARKET_OVERVIEW_PROMPT 的职责范围 + 第 5 条）、`python/cli/data_complete.py` 注释。

下面是**通读全仓后新发现**的 8 项。

## A. 需要改代码的（1 项，是 bug 不是文案）

### A1. `get_market_breadth` 的 note 在降级时自相矛盾
`frontend/src/services/chatEngine/toolHandlers.ts:126-141`：

```ts
const hasLimitCounts = d.limitUp != null || d.limitDown != null
return {
  data_status: d.total > 0 ? 'available' : 'unavailable',
  ...
  note: hasLimitCounts ? undefined : '涨停/跌停家数本次未取到，仅涨跌家数有效',
}
```

当涨跌家数整体降级（service 返回全 0，`limitUp/limitDown` 同时为 `null`）时，`hasLimitCounts === false`
→ note 写成「**仅涨跌家数有效**」，但此刻涨跌家数恰恰是无效的（`total: 0`）。
模型会被这条 note 反向误导。

**改法**（先判整体，再判局部）：

```ts
note: d.total > 0
  ? (hasLimitCounts ? undefined : '涨停/跌停家数本次未取到，仅涨跌家数有效')
  : '涨跌家数本次未取到（数据源异常或尚未更新），请勿据此判断市场涨跌结构',
```

## B. 需要改 AI 提示词的（3 项）

### B1. `skills.ts:67` 把「永久停止披露」归成了临时状态
```ts
   - data_status="unavailable" → 数据不可用（非交易时段/休市/数据未更新），查看 note 字段说明原因，如实告知用户
```
括号里的三个原因都是**临时**的，而北向资金是**机制性永久缺失**。这会让模型对用户说「可能是休市或尚未更新」
（正是本轮要消灭的那类误导）。

**改法**：`（非交易时段/休市/数据未更新/该口径已停止披露）`

### B2. `ChatPanel.vue:249,274` 的快捷提问 chip 还写着「流向」（**已决定：两个都改**）
```ts
// market_overview skill
{ text: '北向资金今日流向' },
// 默认/general
{ text: '帮我看看北向资金流向' },
```
「流向」已经没有数据可给（净流入停止披露），点下去只会得到一段「已停止披露」的解释。

**改法**：两个都改成 `'北向资金今日成交额'` / `'帮我看看北向资金成交额'`。

### B3. `skills.ts:238`（+ 可选 `:55`）技能自述
```ts
description: '查询大盘行情、指数、板块资金、北向资金',
```
**改法**：`'查询大盘行情、指数、板块资金、北向资金成交额'`。
可选顺带把 `:55` 的 `- 查询市场涨跌统计（上涨/下跌家数）` 补成 `（沪深两市合计的上涨/下跌/平盘家数）`。

> 注：`skills.ts:294` 的**路由分类器**关键词表、`:239` 的 keywords 里的「北向」**不要改**——
> 用户仍然会问「北向」，路由必须能命中 market_overview。

## C. 需要改文档的（4 项）

### C1. `README.md:329-335` 整段已过时（**权限被拦，需要你改或放宽规则**）
```
### Push2 A 股全市场列表不可用

东方财富 `push2.eastmoney.com` 的 A 股全市场 filter 在当前服务环境被拒绝访问。受影响的 service 功能：

- **涨跌统计**（`GET /market/breadth`）→ 改用 `api/qt/stock/get?secid=1.000001` 的
  上证指数级字段作为近似替代，仅覆盖上证市场，不含深证。
- **涨停股池** → 不可用，Python 侧保留 akshare `stock_zt_pool_em` 作为唯一数据源。
```
两条**都已不成立**：涨跌家数不再走 `api/qt/stock/get`（那正是本轮修掉的错误字段），且已覆盖深市；
涨跌停家数现在可用（push2ex 涨跌停池）。

**建议改法**：
```markdown
### Push2 A 股全市场列表（clist/get 全市场 filter）不可用

东方财富 `push2.eastmoney.com` 的 A 股全市场 `clist/get` filter 在当前服务环境被拒绝访问，
因此不能靠它逐只遍历统计全市场。**这不影响涨跌统计**：

- **涨跌家数**（`GET /market/breadth`）→ 用 `api/qt/ulist.np/get` 的指数级字段 `f104/f105/f106`
  （上涨/下跌/平盘）：上证指数 `1.000001` = 沪市全体、深证成指 `0.399001` = 深市全体，两者相加即沪深两市合计。
  实现见 `service/src/providers/eastmoney/marketBreadth.ts`。
- **涨跌停家数** → 用 `push2ex.eastmoney.com` 的涨/跌停池（`getTopicZTPool` / `getTopicDTPool`）的 `tc`，
  必须带 `date=YYYYMMDD`；取不到时返回 `null`（不再填假值）。
- 注意：`api/qt/stock/get` 的 `f168/f169/f170/f171` 是**换手率/涨跌额/涨跌幅/振幅**（不传 `fltt=2` 时放大 100 倍），
  `f292/f293` 也与涨跌停无关 —— 早期实现误用过这两组字段。
```

### C2. `docs/architecture/fallback-strategy.md:56-62`「Python 外部回退」漏了 NorthFlow
该代码块只列了 `MarketMoneyFlow` 与 `GlobalIndexKline`，而北向资金现在有一条真实的 Python 回退链
（本轮已真机验证过 `provider: akshare, fallback: true`）。**建议补**：

```
NorthFlow:
  1. eastmoney datacenter RPT_MUTUAL_DEAL_HISTORY (主，取 DEAL_AMT，单位百万元)
  2. 失败 → data_complete.py --source akshare --type north_flow
     → 同一 datacenter 端点（不同 client）→ stdout JSON → NorthFlowDto
  3. 全部失败 → 503，前端 get_north_flow 返回 data_status="error"
  （净流入自 2024-08-19 起停止披露，三个 *NetInflow 恒为 null）
```

### C3. `docs/architecture/fallback-strategy.md:101` TTL 表的「说明」列
```
| 北向资金 | 15s | 盘中变动 |
```
北向成交总额是**每交易日盘后更新一次**，不是盘中变动。**改法**：`盘后更新（净流入自 2024-08-19 起停止披露）`。

同时 E2 把 TTL 改成 5 分钟后，**这张表的 TTL 列**（`15s` → `5min`）与
`docs/architecture/module-data-sources.md:35` 的 north-flow 行（`15s` → `5min`）都要同步。

### C4. `docs/data-sources-and-runtime.md:100` 未标口径
```
| `getMarketBreadth` | 涨跌家数 | eastmoney (TTL 15s) |
```
**改法**：`| getMarketBreadth | 涨跌家数（沪深两市合计）+ 涨跌停家数 | eastmoney (TTL 15s) |`

## D. 已检查、确认无需改动

| 位置 | 为什么不用改 |
|---|---|
| `docs/architecture/ai-fund-analysis.md:19,95`（工具子集里的「北向」） | 分析场景经 `analysisEngine.ts:129` 的 `listToolSpecs(...).map(toolSpecToOpenAI)` 使用**同一份** `ToolSpec.description`，所以 toolContract 里的 caveat 自动覆盖；其 `ANALYST_TOOL_USAGE`（`analysisScenarios.ts:45`）也已有「工具不可用或数据不足时…如实说明，不得编造」 |
| `docs/architecture/ai-chat.md:27,75` | 技能表与「工具调用规范」描述仍准确 |
| `toolContract.ts:341`（全局第 7 条 data_status 规则） | 通用且正确；本次两个工具的 description 已各自写明口径 |
| `docs/tushare.md:49` | 讲的是 tushare 作为候选数据源，与本改动无关 |
| `docs/architecture/{data-sources,module-data-sources}.md`、`data-sources-and-runtime.md:30` 的 provider 表 | 上一轮已改好 |

## E. 已决策的行为变更（用户 2026-09-22 确认）

### E1. `TOOL_CALL_RULES` 加第 8 条（已同意）
`frontend/src/services/chatEngine/toolContract.ts:341` 的第 7 条之后新增：

```
8. data_status="unavailable" 但 note 或字段中仍含可用数值（如 *_deal_amount_yi）时，
   必须把这些数值一并给出，不能只说「数据不可用」
```

理由：`get_north_flow` 恒返回 `unavailable`（为了不让模型把 null 当 0），存在模型只说「北向数据不可用」
而漏掉 note 里成交额的风险。该规则附加到**每个技能 prompt**，因此 general 与分析场景一并覆盖。

### E2. `market:north-flow` TTL 15s → **5 分钟**（已同意）
`service/src/core/cache.ts:175`：`marketNorthFlow: 15 * 1000` → `5 * 60 * 1000`。

理由：成交总额每交易日盘后只更新一次，15s TTL 最多每 15s 打 3 次 datacenter 请求，纯浪费。
保留现有 `cacheThrough` 结构，不动过期逻辑（不采用「次日 9AM」那套，改动面更大）。
注：`fallback-strategy.md:101` 的 TTL 表列的是这张表，改完要同步成 5min。

## F. 实施顺序（全部已获批）

1. **A1**（note bug）→ `cd frontend && npx vue-tsc --noEmit && npm test`
2. **B1–B3**（提示词/chip）→ 同上（`toolContract.test.ts` 只断言工具名，不受影响）
3. **E1**（`TOOL_CALL_RULES` 第 8 条）→ 同上
4. **E2**（TTL 15s → 5min）→ `cd service && npm run lint && npm run typecheck && npm test`；
   真机 `curl /api/market/north-flow` 两次间隔 <5min，第二次应回 `meta.cached: true`
5. **C2–C4**（docs）→ `cd docs && npm run build`（注意：该构建**本来就有一个与本次无关的 dead link**
   `architecture/ai-overview.md:54` 的 `/settings`，不是本轮引入的）
6. **C1**（README）→ 需要先放开 `edit README.md` 的权限规则，或由你手工替换
7. 最后跑一遍两侧全量：`service`（lint/typecheck/test）+ `frontend`（lint/vue-tsc/test/build）

---

## G. 实施记录（2026-09-22，已完成）

8 项全部应用 + 3 项决策变更，另加 1 项测试与 1 项顺带修复。

### 逐项结果

| # | 文件 | 落地内容 |
|---|---|---|
| A1 | `frontend/src/services/chatEngine/toolHandlers.ts` | note 改为先判 `d.total > 0` 再判 limit 缺失；降级时给「涨跌家数本次未取到…请勿据此判断市场涨跌结构」 |
| B1 | `frontend/src/services/chatEngine/skills.ts:67` | `unavailable` 括号补「/该口径已停止披露」 |
| B2 | `frontend/src/components/ChatPanel.vue` | 两个 chip → 「北向资金今日成交额」「帮我看看北向资金成交额」 |
| B3 | `frontend/src/services/chatEngine/skills.ts:55,238` | 「市场涨跌统计（沪深两市合计的上涨/下跌/平盘家数）」、「…北向资金成交额」 |
| C1 | `README.md` | 「Push2 A 股全市场列表不可用」整节重写（旧字段 → `ulist.np/get` f104-f106 + push2ex 涨跌停池，并提示 f168-f170/f292-f293 是误用过的字段） |
| C2 | `docs/architecture/fallback-strategy.md` | 「Python 外部回退」补 NorthFlow 三级链 |
| C3 | `docs/architecture/fallback-strategy.md` | TTL 表 → `北向资金成交总额 \| 5min \| 盘后更新（净流入自 2024-08-19 起停止披露）` |
| C4 | `docs/data-sources-and-runtime.md` | `getMarketBreadth` 补口径；`getNorthFlow` TTL 15s → 5min |
| E1 | `frontend/src/services/chatEngine/toolContract.ts` | `TOOL_CALL_RULES` 加第 8 条（unavailable 但含可用数值时必须一并给出） |
| E2 | `service/src/core/cache.ts` | `marketNorthFlow: 15 * 1000` → `5 * 60 * 1000`；`module-data-sources.md` 的 TTL 列同步 |

### 顺带修复（超出原清单）

- **`docs/architecture/ai-overview.md:54` 的 dead link `/settings`**：那是前端应用路由（`/#/settings`）而非文档页，
  VitePress 判定为死链，导致 `docs` build 一直红。改成纯文本描述后 **docs build 首次变绿**（`build complete in 3.25s`）。
- **新增 `frontend/src/__tests__/services/toolHandlers.market.test.ts`（5 例）**：前端 `toolHandlers` 此前**没有任何测试**。
  这次 A1 改的是 handler 逻辑、北向的 ÷100 单位换算也最容易再错，所以补了回归测试：
  1. DEAL_AMT 百万元 → 亿元 按 `/100`（283911.86 → 2839.12，用 `/10000` 会得到 28.39 而失败）
  2. 净流入恒 null + `data_status: unavailable` + note 含 2024-08-19
  3. 成交额缺失时走另一条 note
  4. breadth 正常透传 scope/date/涨跌停
  5. breadth 涨跌停缺失 → 「仅涨跌家数有效」
  6. **A1 回归**：整体降级时 note 不得再出现「仅涨跌家数有效」

### 验证

| 项 | 结果 |
|---|---|
| service lint / typecheck / test | 干净 / 干净 / **96 例** |
| frontend lint / vue-tsc / test / build | 干净 / 干净 / **21 文件 243 例**（238 → +5）/ 成功 |
| docs build | **首次全绿**（`build complete in 3.25s`，无 dead link） |
| 真机 breadth | `2029/3100/157 = 5286`，`limitUp 52`，`scope 沪深两市`，`date 2026-09-22` |
| 真机 north-flow | 净流入全 null + `283911.86/133832.25/150079.61` |
| 真机 TTL | 5 分钟内第二次请求 `meta.cached: true` |

### 备注

- `README.md` 的编辑在 plan 模式下会被 `edit README.md → deny` 拦住，切到 build 模式后正常（不是文件级保护规则）。
- 路由关键词（`skills.ts:239` 的 `keywords`、`:294` 的 ROUTER_SYSTEM_PROMPT）里的「北向」**有意保留**——
  用户仍会问「北向」，路由必须能命中 market_overview。
