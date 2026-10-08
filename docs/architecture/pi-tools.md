# pi 工具面

终端 pi 是这套系统的 AI 层。它不直接读数据库，而是通过 **service 的工具面**调数据和计算。

## 1. 契约在 service

| 端点 | 作用 |
|---|---|
| `GET /api/agent/tools` | 工具清单：`name` / `label` / `description` / `promptSnippet` / `readOnly` / JSON Schema |
| `POST /api/agent/call` | `{ tool, args }` → 校验参数 → 执行 → 返回结果（超 30k 字符自动转「预览 + 缩小范围」提示） |

- 工具定义都在 `service/src/agent/tools{Market,Fund,Watchlist,Compute}.ts`，参数用 **Zod** 写，清单由 `z.toJSONSchema()` 派生。
- 处理器**直接调 service 内部函数**（不走 HTTP 自调用），所以口径与页面完全一致（同一份 core 引擎、同一份 SQLite 缓存）。
- 语义：结构错误（未知工具 / 参数不合 Schema）→ `400`；取数失败 → `200` + `{ error }`；写/执行类 → 见下节的确认流程。

当前 **33 个工具**（分组）：

| 组 | 工具 |
|---|---|
| 市场 | `get_market_indices` `get_index_kline` `get_hot_sectors` `get_concept_sectors` `get_north_flow` `get_market_breadth` `get_main_flow` `get_gold_realtime` |
| 基金 | `search_funds` `get_fund_detail` `get_fund_estimate` `get_fund_nav_history` `get_fund_holdings` `get_fund_managers` `get_flash_news` |
| 自选 | `get_watchlist` `add_to_watchlist` `remove_from_watchlist` |
| 计算 | `run_backtest` `run_portfolio_backtest` `compare_backtest_strategies` `screen_funds` `get_screening_status` `refresh_screening` `get_research_dashboard` |
| 用户数据 | `list_strategies` `save_strategy` `delete_strategy` `get_positions` `list_strategy_scripts` `run_strategy_code` `save_strategy_script` `delete_strategy_script` |

`refresh_screening` 是只读的（不动用户数据）但**会联网刷新缓存**：默认只跑一批 300 只富化（冷启动全量约 3 分钟），
返回后看 `risk_metrics_pending`，>0 就再调一次；`retry: true` 会重试上次取不到净值的基金。

## 2. 写 / 执行类要用户确认

`add_to_watchlist`、`remove_from_watchlist`、`save_strategy`、`delete_strategy`、`save_strategy_script`、`delete_strategy_script`、
`run_strategy_code` 标记为 `readOnly: false`：

1. 第一次调用**不执行**，返回 `{ confirm_required: true, token, message }`；
2. 调用方（pi）要把「将要写入/执行的内容」展示给用户并取得明确同意；
3. 用**完全相同的参数** + `__confirm_token` 再调一次才真正执行。

令牌一次性、10 分钟过期、绑定（工具名 + 参数指纹）—— 参数改一个字符就失效，会重新要确认。
实现：`service/src/agent/confirm.ts`。

## 3. pi 扩展只是通用桥

`.pi/extensions/gofund/` 不定义任何具体工具：

1. 启动时（异步工厂）拉 `/api/agent/tools`，逐个 `pi.registerTool()`；
2. service 离线 → 用生成的静态清单 `tools.manifest.ts`（`bun run gen:tools`，随仓库提交）—— 工具仍在，调用会返回「service 没起来」的明确提示；
3. 连清单也没有 → 只注册一个泛化的 `gofund_call(tool, args)`。

配置：`GOFUND_API_BASE`（默认 `http://localhost:8310`）。
技能：`.pi/skills/gofund-data/SKILL.md`（能力清单 + 口径陷阱）、`.pi/skills/gofund-strategy/SKILL.md`（策略读写流程）。

**改工具的地方只有一个**：`service/src/agent/` —— 改完跑 `bun run gen:tools` 更新静态清单。

## 4. 代码回测（pi 侧最特别的能力）

`run_strategy_code` 让 pi 直接跑「自由策略代码」：

```js
function prepare(sdk) {                    // 声明固定池与窗口
  const pool = sdk.screen({ type: '混合型' }) // 本地基金库（SQLite）筛选，不联网
  return { start: '2024-01-01', end: '2025-12-31', assets: pool.map(r => r.code).slice(0, 5) }
}
function onDay(s) {                        // 逐日决策，按基金代码寻址
  if (s.date.endsWith('-01')) return { buy: [{ code: s.codes[0], amount: 500 }] }
  return {}
}
```

- 代码在 `service/src/sandbox/` 的 `node:worker_threads` 里跑，**5s 超时 `terminate()`**（死循环杀得掉）；
- 隔离是 best-effort：抹掉宿主全局，但 `new Function` 里关不掉动态 `import()` —— 所以它属执行类，要确认令牌；
- 结果与页面 `/backtest`（浏览器 Worker）走同一份 core 引擎、同一份净值缓存，数字应当一致；
- 想留档：`save_strategy_script(name, code)`，之后 `run_strategy_code(script_name=...)` 直接重跑。

## 5. 给用户看页面

pi 会话里通常有 bow 的 `browser_*` MCP 工具：`browser_list_tabs` → `browser_switch_tab`（或 `browser_new_tab` 打开
`http://localhost:8517/#/strategy`）。**不再有** `window.__gofund` 这类前端控制桥（已删除）。
