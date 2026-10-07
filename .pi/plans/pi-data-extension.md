# 计划：给终端 pi 接上 GoFundBot 数据（不动前端）


> ⚠️ **2026-10-07 更新（P4）**：本文描述的「扩展里定义 15 个只读工具」已过时 —— 工具清单
> 现由 service 的 `/api/agent/tools` 提供，扩展只做通用桥。见 `.pi/extensions/gofund/README.md`。

## 1. 目标与假设

**目标**：让在 `GoFundBot` 仓库里运行的原生 pi（CLI/TUI）能直接查询本项目的行情/基金/资讯数据，
方式是**仓库内 pi 扩展 + skill**，只读、无状态，不新增 service 代码，不改任何前端文件。

**假设**（如不成立请先纠正）：
- 使用者在仓库目录启动 pi，pi 的数据需求是「读」——不需要下单、不写用户数据。
- service（`localhost:8310`）由使用者自己启动（`bun dev:service`）；扩展不负责拉起它。
- 这一轮**只接纯后端数据**。前端独有的 11 个工具（回测引擎、4433/行业分类、持仓/方案 Dexie、
  `searchService`）明确不做——它们要么依赖浏览器 Web Worker / IndexedDB，要么依赖 localStorage 里的 key。

**不在本轮范围**：不删前端 AI、不做 MCP server、不做 pi 侧结构化输出（三类分析场景）、不改 service 路由。

## 2. 为什么是这个形状（依据）

- `docs/architecture/ai-chat.md:78-91` 自己写着前端工具契约「对齐 pi」——Schema 驱动、`{ok,data}|{ok,error}`
  信封、未知工具纠错、`promptSnippet`。这轮等于把其中**纯数据的那一半**换成 pi 原生实现。
- pi 扩展能拿到宿主提供的模块，无需安装依赖：`docs/packages.md:81-90` 列出
  `@earendil-works/pi-ai` / `@earendil-works/pi-coding-agent` / `typebox`，并明确「不要放进 `dependencies`，
  会绕过 pi 的模块映射」。`examples/extensions/hello.ts` 就是这么写 `defineTool` 的。
- pi 有 `promptSnippet`：`dist/core/extensions/types.d.ts:449`「Optional one-line snippet for the Available
  tools section in the default system prompt」——正好对应前端 `ToolSpec.promptSnippet`。
- 项目扩展在 `.pi/extensions/`（`docs/configuration.md:34`），加载需项目信任。
- skill 的 name/description 进系统提示、正文按需加载（`docs/skills.md`）——适合放「什么时候用哪几个工具」的引导。
- **两个互补的 AI 结果在同一个 pi 会话里**：既能查 GoFundBot 数据，又是当前这个仓库的编码代理。

## 3. 要新增的文件

| 路径 | 作用 |
|---|---|
| `.pi/extensions/gofund/index.ts` | 扩展工厂：用 `defineTool` + `pi.registerTool` 注册全部只读数据工具 |
| `.pi/extensions/gofund/client.ts` | `GOFUND_API_BASE`（默认 `http://localhost:8310`）、`apiGet()`、信封解包、连接错误翻译、结果体积裁剪 |
| `.pi/extensions/gofund/tools/fund.ts` | 基金族 6 个工具 |
| `.pi/extensions/gofund/tools/market.ts` | 市场族 8 个工具 |
| `.pi/extensions/gofund/tools/news.ts` | 资讯族 1 个工具 |
| `.pi/skills/gofund-data/SKILL.md` | 告诉 pi 何时/如何组合使用这些工具（含各数据源的坑） |
| `.pi/extensions/gofund/README.md` | 端点表、`GOFUND_API_BASE`、与前端 toolHandlers 的重复说明 |

**只改一处既有文件**（可选、建议做）：`AGENTS.md` 的 “Monorepo hot spots” 表加一行
`.pi/extensions/gofund/`，让后续 agent 知道这里有 pi 数据工具。若不想动 AGENTS.md，跳过亦可。

> 注意：`.gitignore` 忽略了 `.agents/`，所以 skill 必须放 `.pi/skills/` 而不是 `.agents/skills/`。
> `.pi/` 本身未被忽略，扩展会正常入库。

## 4. 工具清单（15 个，全部只读）

命名沿用前端 `toolDefs.ts` 的既有名字，便于以后迁移与文档对齐。

### fund（`tools/fund.ts`）
| 工具 | 请求 | 参数 | 返回处理 |
|---|---|---|---|
| `search_funds` | `GET /api/fund/search?q=` | `keyword` | 直传；该路由 `data` 是 `[{CODE,NAME,TYPE,PINYIN}]` |
| `get_fund_detail` | `GET /api/fund/:code` | `code` | 直传（legacy 大对象：`net_worth_trend`/`performance`/`fund_managers`/`stock_holdings`/`asset_allocation`…）。体积大 → 裁剪 |
| `get_fund_estimate` | `GET /api/funds/:code/estimate` | `code` | 直传 |
| `get_fund_nav_history` | `GET /api/funds/:code/nav-history` | `code, startDate?, endDate?` | 直传；日期参数名是 `startDate`/`endDate`（不是 `start_date`） |
| `get_fund_holdings` | `GET /api/funds/:code/holdings` | `code` | 直传 |
| `get_fund_managers` | `GET /api/funds/:code/managers` | `code` | 直传 |

### market（`tools/market.ts`）
| 工具 | 请求 | 参数 | 返回处理 |
|---|---|---|---|
| `get_market_indices` | `GET /api/market/indices` | — | 直传 |
| `get_index_kline` | `GET /api/market/kline/:symbol` | `symbol, start_date, end_date, period?` | 日期转成 `startDate`/`endDate`；直传 |
| `get_hot_sectors` | `GET /api/market/sectors?limit=` | `limit`(1-120) | 该路由**不走 `sendSuccess`**，返回 `{success,data:[...],total_count,data_date,source}`；按此解包 |
| `get_concept_sectors` | `GET /api/market/concept-sectors?limit=` | `limit`(1-60) | 同上为扁平数组 → 映射成 `{data_status,date,source,count,items,note}` |
| `get_north_flow` | `GET /api/market/north-flow` | — | **必须映射**：`shNetInflow/szNetInflow/totalNetInflow` 恒 null，不能当 0；`*DealAmount` 单位百万元 → `*_deal_amount_yi = /100`；附 note |
| `get_market_breadth` | `GET /api/market/breadth` | — | 映射为 `up_count/down_count/flat_count/limit_up/limit_down/total/scope/date`；`limit_up/down` 可为 null 且不可当 0；`total=0` 时附 note |
| `get_main_flow` | `GET /api/market/money-flow` | — | 映射为 snake_case + `data_status`（`date` 为空即 unavailable） |
| `get_gold_realtime` | `GET /api/market/gold/realtime` | — | 直传（`{success,data}`） |

### news（`tools/news.ts`）
| 工具 | 请求 | 参数 | 返回处理 |
|---|---|---|---|
| `get_flash_news` | `GET /api/news/flash?count=&page=1` | `count`≤300 | 直传；前端 `get_market_news` 与 `get_flash_news` 是同一端点，合并成一个 |

**刻意不移植**（前端里是死代码/桩，避免把它们带进来）：
- `get_market_anomaly` —— 前端 handler 恒返回 `{anomalies: [], indices}`，不产生任何分析。
- `get_watchlist` —— 前端只返回「存储在前端本地」的提示串。
- `search_news` —— 依赖前端 `searchService` 与 localStorage key，不在「纯后端数据」范围。

**可选追加**（默认不做，见 README 里列出即可）：`get_global_indices`(`/api/market/global-indices`)、
`get_market_overview`(`/api/market/overview`)、`get_volume_7days`(`/api/market/volume/7days`)、
`get_screening_snapshot`(`/api/funds/screening-snapshot` 或 `/api/screening/sync`)、
`get_service_logs`(`/api/logs/read`，用于「让 pi 看应用日志」这个玩法)。

## 5. 实施步骤（有序，每步可单独验证）

1. **`client.ts`**
   - `const BASE = process.env.GOFUND_API_BASE ?? 'http://localhost:8310'`
   - `apiGet(path, params?)`：`AbortSignal.timeout(15000)`；非 2xx 抛 `Error`；
     `ECONNREFUSED`/`fetch failed` 翻译成明确的
     `GoFundBot service 未启动（默认 http://localhost:8310）：请在 service/ 下执行 bun run dev`。
   - `unwrap(body)`：`body && typeof body === 'object' && 'data' in body ? body.data : body`（对应前端 `unpack`）。
   - `jsonResult(data, {endpoint, limit=30_000})`：`JSON.stringify` 后超过 `limit` 截断并在文本里写明
     「已截断，请缩小时间范围或减少 limit」，返回 pi 需要的 `{ content:[{type:'text',text}], details }`。
   - **验证**：`tsc` 认知不了 `.pi/`（不给它加 tsconfig）；靠第 8 步真实运行验证。

2. **`tools/fund.ts`**（6 个工具，`defineTool`，每个带 `label`/`description`/`promptSnippet`/`parameters`）。
   - 参数用 `Type.String({description})`，日期用可选 string，`code` 校验 6 位加 `pattern`。
   - **验证**：`get_fund_detail` 与 `get_fund_nav_history` 各跑一次真实调用。

3. **`tools/market.ts`**（8 个工具）。
   - 四个需要映射的工具（`get_north_flow`/`get_market_breadth`/`get_concept_sectors`/`get_main_flow`）
     照抄前端 `frontend/src/services/chatEngine/toolHandlers.ts:113-190` 的字段映射与 note 文案
     （那里是踩过坑后写死的口径）。**这是本轮唯一的逻辑重复，README 里记账。**
   - **验证**：分别核对 north flow 的 `total_deal_amount_yi`（百万元 ÷100）与 breadth 的家数是否与
     `/api/*` 原始 JSON 对得上。

4. **`tools/news.ts`**（1 个工具）。
   - **验证**：`count=3` 返回 3 条。

5. **`index.ts`**：扩展工厂收集三个数组并 `pi.registerTool(t)`；工具保持默认 `exposure: "direct"`，
   让 pi 直接能看到（备选：改 `deferred` 走 `tool_search`，可省系统提示 token，见第 9 节）。
   - **验证**：pi 启动诊断里出现该扩展、无加载错误。

6. **`.pi/skills/gofund-data/SKILL.md`**：frontmatter `name`/`description` 写清「查 GoFundBot 实时行情/
   基金/资讯时用它」；正文给 3-5 条组合套路与硬约束：
   - 先 `get_market_indices` 定大盘，再 `get_hot_sectors`/`get_concept_sectors` 看结构，需要时 `get_main_flow`/`get_north_flow`/`get_market_breadth`。
   - 单只基金：`get_fund_detail` 一把梭；只要净值序列用 `get_fund_nav_history`。
   - **铁律**：`data_status: unavailable` 时不许编数据；北向净流入恒 null 不许当 0；板块 `code` 为空时成分股接口不可用。
   - `get_index_kline` 必须同时给 `start_date` 和 `end_date`。
   - **验证**：`/skill:gofund-data` 能加载，且不加载时系统提示里只出现 name/description。

7. **`README.md` + （可选）`AGENTS.md` 表里加一行**。

8. **端到端验证**（这是本计划的验收，必须真跑）：
   ```bash
   cd service && bun run dev            # 终端 A
   # 终端 B，仓库根目录
   pi --print "用 get_market_indices 报一下今天上证/深证/创业板，再列前 5 个热门行业板块"
   pi --print "查 110022 的净值和重仓股"
   pi --print "今天北向资金和涨跌家数怎么样"
   ```
   三件事都要看：工具被正确选中、参数正确、结果数值与直接 `curl localhost:8310/api/...` 一致。
   再测失败态：停掉 service，重复第一条，确认得到的是「service 未启动」的明确提示而不是挂起或堆栈。

9. **（可选）上下文成本校准**：`pi` 里看系统提示 token，若 15 个工具的声明开销明显，
   把 `index.ts` 里的注册改成 `exposure: "deferred"`（配 `tool_search`）或 `"codemode"`，
   重新验证第 8 步仍能调用（`tool_search` 先搜到再调）。

## 6. 验收标准

- 第 8 步三条真实查询都能拿到**与 service 原始响应一致**的数据，且不需要任何 `curl`/`bash` 兜底。
- service 不在时，工具返回可读的失败说明，pi 不会编造数据。
- 前端 **零改动**：`git status` 只应出现 `.pi/**` 与（可选的）`AGENTS.md`。
- 四个映射工具（北向/涨跌家数/概念板块/主力资金）的口径与前端 chat 工具一致。

## 7. 风险与未知

| 风险 | 处理 |
|---|---|
| `typebox` / `@earendil-works/pi-ai` 在 `.pi/extensions/` 的 jiti 解析下可能拿不到宿主映射 | 先用 `examples/extensions/hello.ts` 的写法（`@earendil-works/pi-ai` 导 `Type`）。若加载报 `Cannot find module`，就在 `.pi/extensions/gofund/package.json` 里把宿主包写进 `peerDependencies: {"*"}`（`docs/packages.md:88`），仍失败再加 `devDependencies` 兜底 |
| 项目扩展需要项目信任，首次启动会问 | 预期行为；README 里写明 |
| 15 个 `direct` 工具进每次会话的系统提示，挤占编码任务的上下文 | 第 9 步切 `deferred`/`codemode`；或定期只保留高频工具 |
| service 未启动时看起来像「pi 不会查数据」 | `client.ts` 把连接错误翻译成「请先起 service」 |
| service 限流 300 次/15min（`app.ts`），聊天式密集调用可能触顶 | 工具返回体里如实带上 HTTP 429 的错误文本，不重试风暴 |
| 移植四段映射逻辑 = 前端 toolHandlers 的第二份拷贝 | 明确记账：等真正删前端 AI 时把这份逻辑一处化；现在不动前端是前提 |
| `get_fund_detail`/`nav-history`/`kline`/`sectors` 结果可能很大 | `jsonResult` 30KB 裁剪 + 提示缩小范围 |
| 数据源本身不稳定（AGENTS.md 记了板块/北向/K线的多起故障） | 工具只做透传与口径标注，不伪造；失败信息原样给模型 |

**无法从代码确认的点**：
- pi 对自定义工具返回体是否有自动截断（MCP 是 20KB，自定义工具的规则没在文档里写死）→ 所以自建 `jsonResult` 裁剪。
- `/api/market/kline/:symbol` 对 `^DJI` 这类全球指数是否可用（路由另有 `/api/market/kline/global/:symbol`，
  前端工具只用了前者）→ 第 8 步顺便验一下；不可用则在该工具描述里只写 A 股指数，把全球指数挪到可选追加项。

## 8. 后续（本轮不做，写进 README 备查）

1. 前端 AI 瘦身：删 `chatEngine/`、`analysis/`、`llm.ts`、`searchService.ts` 及对应面板（≈7.7k 行）。
2. 若 pi 也要覆盖回测/持仓/方案：把回测引擎与 `industryClassifier` 抽成前后端共享包，并给持仓加一条同步到 service 的路径。
3. 若要三类结构化分析在 pi 侧跑：用「`submit_result` 工具 + TypeBox outputSchema」替代 session 级 json_schema。
4. 若要别的 MCP 客户端（Claude Code/Codex）也能用：再把 service 包一层 Streamable HTTP `/mcp`。

## 9. 实施记录（2026-10-07）

**落地文件**：`.pi/extensions/gofund/{index,client}.ts` + `tools/{fund,market,news}.ts` + `README.md`；
`.pi/skills/gofund-data/SKILL.md`；`AGENTS.md` hot-spots 表加一行。前端与 service **零改动**
（`git status` 仅 `AGENTS.md` + `.pi/`）。

**与计划的一处偏差（改进）**：验证时发现 `get_fund_detail` 的 legacy 响应约 **1 053 639 字符**，
其中 99% 是时间序列（`rank_history` 297k，四条净值/收益/排名序列各 150-171k）。原计划只做 30KB 截断，
结果是模型只能看到前三个字段，工具形同虚设。因此新增 `summarizeSeries()`：六个序列字段压成
`{count, first, last}`（`total_return_trend` 按序列各一行），加 `_series_note` 指向
`get_fund_nav_history`；结果降到 **6 957 字符**，其余章节全部可见。

**验证证据**（真跑，非推断）：
- `pi --print -e ./.pi/extensions/gofund/index.ts -t <tools>` 逐族实测，返回值与 `curl localhost:8310/api/...` 逐值一致：
  指数（上证 0.31 / 深证 -0.11 / 创业板 -0.23 / 沪深300 0.29 / 科创50 -2.51）、
  涨跌家数（2393/2730/167，涨停 52 / 跌停 9，合计 5290，date 2026-09-30）、
  北向（207941.62 百万元 → 2079.42 亿元，`*_net_inflow` 恒 null + note）、
  概念板块（count 2，含 note，source akshare_ths）、指数 K 线 sh000300（4 行逐值一致）与
  **海外 DJI**（count 2 / 20260901 / 52766.87890625）、贵金属、`search_funds`、
  `get_fund_managers`（萧楠 / 14年又12天）。
- **15/15 个工具全部走过真实 pi 调用**（后补：`get_hot_sectors` total_count 2 / first 视频媒体、
  `get_main_flow` main_net_inflow -13628162048、`get_fund_estimate` nav 2.79 / estimatedNav null、
  `get_fund_nav_history` 2026-09-01..03 共 3 条、`get_fund_holdings` 10 条、`get_flash_news` 2 条），
  每项均与 `curl :8310` 原始响应对得上。
- **仓库基线仍绿**：`service` 的 lint / typecheck / **101 tests** 全过（改动只在 `.pi/` 与 AGENTS.md 一行，
  service/frontend 未动）。
- `client.ts` 单独用 bun 跑断言（它不依赖 pi 包）：连接失败文案、`unwrap`、`clampInt`、截断，全过。
- **项目发现**：本仓库不在 `~/.pi/agent/trust.json` 中，所以 `.pi/extensions/` 默认不加载；
  用 `pi --approve` 验证后工具即可用（stderr 无加载告警），`/skill:gofund-data` 正确加载。
  交互模式下用户会被问一次项目信任 —— 这是 pi 的预期行为。

**顺带发现（非本次引入，属 service 侧现状）**：`/api/fund/110022` 的 `stock_holdings` 里
`ratio`/`shares`/`marketValue` 大量为 `null`（600519 的 `ratio` 为 0）。扩展只做透传，未改动。

**§7 遗留未知已闭合**：`^DJI` 这类写法被 service 拒绝（`INVALID_ARGUMENT: Invalid symbol`）；
海外指数要用**裸代码**（`DJI`/`SPX`/`HSI`/`N225`/`FTSE`/`GDAXI`/`FCHI`/`SENSEX`），
`/api/market/kline/:symbol` 会自动路由到 Yahoo 全局链路（实测 DJI/HSI 可用）。
已把两种代码格式与「不要加 ^」写进 `get_index_kline` 的描述。
