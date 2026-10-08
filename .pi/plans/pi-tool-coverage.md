# pi 工具面补全（coverage）

> **给新会话执行者的第一段话**：`service/src/agent/` 是 pi 工具契约的唯一真源，当前 **33 个工具**
> （迁移后加固 A–D 完成，最新提交 `537c25e`）。工具面已覆盖「行情 → 挑基金 → 回测 → 策略/方案/自选/持仓读」，
> 但有两块**刚做成真 CRUD 的用户数据没有任何工具**（告警、实时页组合/交易），另有一批行情细节没有工具。
> 本 plan 就是把这些缺口补成工具。
>
> 每条都写了要复用的 service 函数与要走的验收；**动手前自己再确认一次**（行号会漂移）。
> 每条做完要有**真跑证据**（`pi -p` / curl 两步令牌 / bow 页面）记到文末「执行记录」。
>
> **推荐顺序**：A → B → C → D（A/B 是刚做成真 CRUD 但 pi 摸不到的两块，收益最高）。
> 只想补最有价值的：只做 **A + B**（+15 个工具，33 → 48）；C 的持仓/自选分组写入与 D 的行情细节可往后放。
> 全文共 **26 个新工具**（33 → 59），每阶段一个 commit。

---

## 0. 环境与基线

**当前事实**（2026-10-08 实测）：

```bash
curl -s localhost:8310/api/agent/tools | python3 -c "import json,sys;d=json.load(sys.stdin)['data'];print(d['count'], d['destructive'])"
# 33 ['add_to_watchlist','remove_from_watchlist','save_strategy','delete_strategy','run_strategy_code','save_strategy_script','delete_strategy_script']
```

**改工具的标准流程**（P4 起没变）：

1. 改/加 `service/src/agent/tools*.ts`（`defineAgentTool`，参数用 **Zod**）→ 在 `service/src/agent/tools.ts` 的
   `AGENT_TOOLS` 数组里注册（新增文件时）。
2. `bun run gen:tools`（**必须**，否则 `src/__tests__/agent/toolsManifest.test.ts` 漂移单测失败）。
3. `bun run check`（36s，service 205 + frontend 256 + docs build）。
4. 真跑验证（见下）。
5. 更新文档与工具计数（见「文档与计数」）。

**写/执行类必须走确认令牌**：`readOnly: false` → `POST /api/agent/call` 第一次只回
`{ confirm_required: true, token, message }`，参数指纹一致才真正执行（`service/src/agent/confirm.ts`）。
写工具的 `params` 里都要有 `__confirm_token: z.string().optional()`，handler 里解构丢弃。

**真跑验证配方**：

```bash
# 只读工具
pi -p --no-session --no-builtin-tools -t <tool_name> "……"

# 写工具（两步令牌，curl 最稳）
call() { curl -s -X POST localhost:8310/api/agent/call -H 'content-type: application/json' -d "$1"; }
T=$(call '{"tool":"<name>","args":{…}}' | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['token'])")
call "{\"tool\":\"<name>\",\"args\":{…,\"__confirm_token\":\"$T\"}}"
```

响应形状：`{ success, data: { tool, result } }`（**结果在 `data.result` 里**，不是顶层）。
写工具的「副作用」要去**页面**确认（`/portfolio`、`/screening` 的告警设置、`/strategy`），不是只看 JSON。

**文件行数上限 500**（lint 会直接失败）：`toolsCompute.ts` 已 389 行 → 新工具放**新文件**，别往里堆。
`toolsWatchlist.ts`（90 行）、`toolsMarket.ts`（194 行）还有空间。

**文档与计数**（加完工具必须一起改，否则文档漂移）：

- `AGENTS.md`：§Key details 的「pi 工具面（33 个）」+ `service/src/agent/` 行 + `.pi/extensions/gofund/` 行。
- `README.md`：功能特性「33 个工具」、技术栈「工具面」、目录树「pi 工具注册表」。
- `docs/architecture/pi-tools.md`：§1 的工具分组表 + §2 的 `readOnly: false` 清单。
- `.pi/skills/gofund-data/SKILL.md`：组合套路 + 「写操作要确认」清单。
- `service/src/__tests__/routes/agent.test.ts` 里**写死了 destructive 列表**（`expect(destructive.sort()).toEqual([...])`）→ 每加一个写工具都要同步。

**环境坑**（都踩过）：

- 本机只留**一个** `tsx watch`（`ss -ltnp | grep 8310` 看 pid；`pkill -f "tsx watch"` 会误杀自己的 shell）。
- 改 service 源码会让运行中的实例热重载；中间态坏文件会让它崩且不自恢复。
- 真浏览器验证用 bow（`browser_*`）：`browser_eval` 不支持顶层 await，要 `(async()=>{})()`。

---

## A. 告警（价值最高：B3 刚落库，pi 完全摸不到）

端点全在 `service/src/routes/alert.routes.ts`，逻辑在 `service/src/services/alertService.ts`。
新建 `service/src/agent/toolsAlert.ts`（约 160 行），注册进 `AGENT_TOOLS`。

| 工具 | 参数 | readOnly | 复用 |
|---|---|---|---|
| `get_alerts` | — | ✅ | `listAlerts()` + `getAnomalyConfig()` |
| `save_alert` | `id?` `fund_code` `alert_type` `threshold` `enabled?` | ❌ 确认 | `createAlert()` / `updateAlert()` |
| `delete_alert` | `id` | ❌ 确认（破坏性） | `removeAlert()` |
| `check_alerts` | — | ✅（见备注） | `checkAlerts()` |
| `get_market_anomaly` | — | ✅ | `detectMarketAnomalies()`（含当前阈值一起回） |
| `save_anomaly_config` | 9 个阈值字段（全 optional） | ❌ 确认 | `saveAnomalyConfig()` |

- `alert_type` 用 `z.enum(['price_up','price_down','return_above','return_below'])`，description 里写清
  **price_* 看实时估值涨跌幅、return_* 看持仓收益率**（持仓来自已结算交易）。
- `check_alerts` 标 `readOnly: true` 但要写明**副作用**：命中后会写 `last_triggered` 并进入 6 小时冷却。
- `save_alert` 的 `fund_code` 建议顺手用 `getFundBasic` 补 `fund_name`（同 `toolsWatchlist.resolveFund`）。

**验收**：`pi -p -t get_alerts "看看我的告警规则"`（当前应为空）；curl 两步建一条 `000000/price_up/4.2`
→ `GET /api/alerts` 看得到 → 在 `/` 页面打开某只基金的「告警设置」看到它 → 删掉。
`get_market_anomaly` 真跑一次（应能返回当日异动，如指数大跌/板块异动）。

---

## B. 实时页组合与交易（B3 刚落库，pi 完全摸不到）

端点全在 `service/src/routes/portfolio.routes.ts`，逻辑在 `service/src/services/portfolioService.ts`。
新建 `service/src/agent/toolsPortfolio.ts`（约 230 行）。

| 工具 | 参数 | readOnly | 复用 |
|---|---|---|---|
| `get_portfolio` | — | ✅ | `listPortfolioFunds()` + `listPortfolioGroups()` + `getPortfolioGroupMap()` + `getHoldings()` |
| `add_portfolio_fund` | `fund_code` `group_id?` `fund_name?` | ❌ 确认 | `addPortfolioFund()`（名称可 `getFundBasic` 补） |
| `remove_portfolio_fund` | `fund_code` | ❌ 确认 | `removePortfolioFund()` |
| `save_portfolio_group` | `id?` `name` `rebalance_*?` | ❌ 确认 | `createPortfolioGroup()` / `updatePortfolioGroup()` |
| `delete_portfolio_group` | `id` | ❌ 确认（破坏性） | `deletePortfolioGroup()` |
| `assign_funds_to_group` | `fund_codes[]` `group_id?`（null=取消） | ❌ 确认 | `syncPortfolioGroupMap()`（读现有 map 合并后整体写回） |
| `add_trade` | `fund_code` `type` `trade_date` `amount` `share` `nav` `status?` `txn_id?` `note?` | ❌ 确认 | `addPortfolioTrade()` |
| `settle_trades` | `txn_ids[]` | ❌ 确认 | `settlePortfolioTrades()` |
| `delete_trade` | `id` | ❌ 确认（破坏性） | `deletePortfolioTrade()` |

- **口径要在 description 里写死**（模型很容易搞错）：
  - `buy` 的 `share = amount / nav`，`sell` 的 `amount = share × nav`（前端口径，见 `buildTradeRecord`）；
  - 持仓是**推导值**：只有 `status='settled'` 的交易计入；`sell` 把份额减到 ≤0.01 时整只消失；
    `dividend` 加份额、`fee` 累加 `total_fee`；
  - 当天还没出净值的交易挂 `status='pending'`，之后用 `settle_trades` 结算。
- `assign_funds_to_group` 注意 `PUT /fund-group-map` 是**整体替换**语义 → handler 里先读 `getPortfolioGroupMap()` 合并。

**验收**：`pi -p -t get_portfolio "看我的组合和持仓"`；curl 两步 `add_trade`（settled）→
`GET /api/user/portfolio/holdings` 出现该基金 → **真浏览器 `/portfolio`「实时估值」页**看到它 →
`delete_trade` 清掉（别留测试数据）。

---

## C. 持仓与自选写入（当前只有 `get_positions` 能读）

`service/src/services/userDataService.ts` 里 CRUD 都是现成的（`addPosition` / `updatePosition` /
`removePosition` / `createWatchlistGroup` / `renameWatchlistGroup` / `deleteWatchlistGroup` /
`assignWatchlistGroup` / `reorderWatchlist` / `reorderWatchlistGroups`）。

- 新建 `service/src/agent/toolsPositions.ts`（约 110 行）并把 `get_positions` 从 `toolsCompute.ts` **搬过去**
  （`toolsCompute.ts` 389 行，正好腾出空间）：

| 工具 | 参数 | readOnly |
|---|---|---|
| `get_positions`（搬家，不改契约） | — | ✅ |
| `add_position` | `fund_code` `shares` `cost` `fund_name?` `purchase_date?` `purchase_time?` | ❌ 确认 |
| `update_position` | `id` + 上面任意字段 | ❌ 确认 |
| `delete_position` | `id` | ❌ 确认（破坏性） |

- `toolsWatchlist.ts` 里**追加**分组/排序工具：

| 工具 | 参数 | readOnly | 复用 |
|---|---|---|---|
| `save_watchlist_group` | `id?` `name` | ❌ 确认 | `createWatchlistGroup()` / `renameWatchlistGroup()` |
| `delete_watchlist_group` | `id` | ❌ 确认（破坏性） | `deleteWatchlistGroup()` |
| `assign_watchlist_group` | `fund_codes[]` `group_id?`（null=取消） | ❌ 确认 | `assignWatchlistGroup()` |
| `reorder_watchlist` | `fund_codes[]`（即新顺序） | ❌ 确认 | `reorderWatchlist()` |

**验收**：`pi -p -t get_positions`（当前为空）；curl 两步加一条持仓 → **真浏览器 `/portfolio`「持仓管理」**看到 →
删除。自选分组同理：建组 → `add_to_watchlist(fund_code, group_id)` → `/` 页面「我的自选」分组正确 → 清掉。

---

## D. 行情细节（低优先，但都是页面上已有的卡片）

- `toolsMarket.ts`（194 行，还有空间）追加：

| 工具 | 参数 | readOnly | 复用 |
|---|---|---|---|
| `get_stock_kline` | `code`（6 位或 `sh/sz` 前缀）`start_date` `end_date` `period?` | ✅ | `getMarketKline()`（个股与指数同一实现） |
| `get_a_volume_7days` | — | ✅ | `getAVolume7Days()`（返回 `data[]` + `success`，**空结果时 success=false，别当成 0**） |
| `get_sector_constituents` | `sector_code`（来自 `get_hot_sectors`，**降级时可能为空串**） | ✅ | `getMarketSectorConstituents()` |
| `get_fund_estimates` | `fund_codes[]`（≤50） | ✅ | `getFundEstimates(codes.join(','))` |

- 顺手修 `get_index_kline` 的 description：它调的就是 `getMarketKline`，**个股也能传**（现在只写「指数」，模型不会想到用）。
  要么改描述，要么让 `get_stock_kline` 独立存在并互相在 description 里指向对方。

**验收**：`pi -p -t get_a_volume_7days "近7日A股成交量"`；`get_stock_kline(sz000001)` 与页面 `StockPopup` 一致；
`get_sector_constituents` 用 `get_hot_sectors` 返回的非空 code 试一次（`source: akshare_ths` 时 code 为空 → 工具要给出明确提示）。

---

## E. 明确不做（避免新会话乱加）

- **不暴露** `POST /api/user/portfolio/migrate`（整体覆盖用户组合）、`PUT /funds/all`、`DELETE /trades`（清空）、
  `DELETE /watchlist/batch-delete` 全清 —— 爆炸半径太大，页面来做。
- **不暴露** `/api/settings`（proxy）、`/api/logs/*`、`/api/user/import`、`/api/health`、`/api/system/*`。
- **不暴露** `POST /api/screening/update` / `/stop`（缓存刷新与无操作桩；`refresh_screening` 已覆盖）。
- 不给 `/api/search` 加工具（pi 自带 `web_search` 更好）。
- 不为了「少几个工具」把多个动作塞进一个 `action` 参数的巨型工具 —— 保持一名一职（确认令牌按工具名绑定，拆开更安全）。

---

## F. 验收与提交

1. `bun run check` 全绿（service 205 → 约 215+，frontend 256，docs build）。
2. `bun run gen:tools` 后 `tools.manifest.ts` 与服务端一致（漂移单测会拦）。
3. `GET /api/agent/tools` 的 `count` 与文档写的一致；`destructive` 列表与 `agent.test.ts` 断言一致。
4. 每个**只读**工具至少一次 `pi -p -t <tool>` 真跑；每个**写**工具至少一次两步令牌往返 + 页面确认 + 清理测试数据。
5. 更新 `AGENTS.md` / `README.md` / `docs/architecture/pi-tools.md` / `.pi/skills/gofund-data/SKILL.md`。
6. 按阶段分 commit（Conventional Commits 中文）：建议 A / B / C / D 各一个（或 A+B 一个、C+D 一个）。
7. 追加本 plan 的「执行记录」+ `memory_write`。

---

## G. 执行记录（新会话在这里追加）

### A 告警工具（2026-10-08 完成）
- 新增 `service/src/agent/toolsAlert.ts`（6 个）：`get_alerts`、`save_alert`（新建/更新，确认令牌）、`delete_alert`（确认令牌）、
  `check_alerts`（只读，但命中会写 `last_triggered` + 6h 冷却）、`get_market_anomaly`、`save_anomaly_config`（确认令牌）。
  顺手把「按代码补基金名」抽成 `service/src/agent/fundLookup.ts`（自选/告警共用）。
- 工具数 **33 → 39**；`bun run gen:tools` 后 destructive = `add_to_watchlist,remove_from_watchlist,save_alert,delete_alert,save_anomaly_config,save_strategy,delete_strategy,run_strategy_code,save_strategy_script,delete_strategy_script`；
  同步改了 `src/__tests__/routes/agent.test.ts` 里写死的 destructive 断言。
- 证据（真实 pi 会话）：
  - `pi -p -t get_alerts` → 「你目前一条告警规则都没设，异动阈值全是默认值（…北向 ±100/-50 亿那条因数据停披露实际无效）」。
  - `pi -p -t get_market_anomaly,check_alerts` → 「创业板指 -3.15%、科创50 -4.82%；告警检查了 1 条规则，未命中」。
- 证据（写路径两步令牌 + 页面确认 + 清理）：
  - `save_alert(110022, price_up, 9.9)` → 建 id 2（名称自动补成「易方达消费行业股票」）→ 页面头部铃铛下拉显示「110022 涨超 9.9%」→ `delete_alert(2)` 删掉。
  - `save_anomaly_config(index_surge_threshold=4.5)` → `/settings/anomaly` 页面的「大涨阈值」输入框真的显示 4.5 → 改回 3。
- 证据（单测）：新增 `src/__tests__/agent/toolsAlert.test.ts`（5 例：确认令牌往返建/改/删、缺参数报错、只读工具不卡令牌、异动阈值部分更新）；service 205 → **210**。
- **顺手修的真 bug（重要）**：前端 `httpClient` 返回的是**整个信封**（`{success,data,meta}`），
  但一批旧调用点把 `res.data` 当载荷用 → **告警/异动/实时页的数据一直显示不出来**（不是「不保存」，是「看不见」）。
  修了 7 个文件共 13 处：`stores/alertStore.ts`（rules/check）、`composables/useMarketOverview.ts`（anomalies）、
  `views/SettingsAnomalyThreshold.vue`（get/defaults）、`composables/useFundRealtime{Data,Groups,Trade}.ts`、`useFundDetail.ts` → 一律改读 `res.data.data`。
  验证：铃铛下拉、市场异动面板（大跌 创业板指/科创50）、异动阈值表单均正常；`bun run check` 全绿（frontend 256 tests）。
  **教训**：`httpClient` 不拆信封，新写调用方必须自己取 `res.data.data`（`useScreeningDb.unwrap` / `userDataApi.unwrap` 就是正确写法）。
