# AI 对话系统

> 对话引擎已前端化：`frontend/src/services/chatEngine/`（skills + toolContract +
> toolCallParser + toolHandlers + 编排原本在 Node `chatService/chatSkills/chatTools/chatIndustryTools`）。
> Node `/api/chat` 已撤销。LLM 调用走前端 `llm.ts`（浏览器 fetch），
> 搜索走前端 `searchService.ts`。

## 技能路由 (SkillRouter)

```
SkillRouter.route(message, preferred?):
  1. preferred 命中 → 直接使用指定 skill
  2. keywordRoute() → 关键词匹配（7 种技能）
     - 优先级: strategy → industry_research → fund_screening → news_briefing
              → investment_strategy → market_overview → fund_analysis
  3. keyword 未命中 → llmRoute() → LLM 路由（1 次调用，10 tokens，temperature=0）
  4. 均未命中 → fallback 'general'
```

**7 种技能定义**（`skills.ts`）：

| 技能 | 关键词 | 描述 |
|------|--------|------|
| `fund_analysis` | 基金，怎么样，表现 | 单只基金深度分析 |
| `fund_screening` | 筛选，排名，推荐 | 基金条件筛选/找基金 |
| `industry_research` | 行业，板块，建仓，政策 | 行业板块研究（业绩+政策+行情） |
| `market_overview` | 大盘，行情，指数，北向 | 市场概览 |
| `news_briefing` | 快讯，新闻，政策 | 资讯摘要 |
| `investment_strategy` | 定投，回测，方案 | 定投回测/策略推荐 |
| `strategy` | 我的策略，投资风格 | 策略讨论（结合用户策略记忆） |
| `general` | — | 通用对话 |

## 工具契约（2026-07 重构，对齐 pi 编码代理架构）

### 传输层归一化

默认模型（SiliconFlow Qwen2.5-7B）不产出自带 `tool_calls`，而是把工具调用写成
`<ai_tool_calls><invoke name=…><parameter name=…>…</parameter></invoke>` 纯文本写进正文。
旧实现只认 OpenAI 原生协议，导致 XML 原样流入展示与 Dexie 持久化（对话污染），且
`get_industry_spot` 这类幻觉工具名从未被校验。重构后两条通道在边界归一化为同一个内部契约：

```
模型输出 ──┬─ 原生 tool_calls（OpenAI 协议）──────────┐
           │                                         ├→ normalizeToolCalls() → ToolCallRequest[]
           └─ <ai_tool_calls> XML（默认模型方言）──────┘              │
                                              validateToolCall（TypeBox Schema + 注册表）
                                                                     │
                                                    executeTool → { ok, data } | { ok, error }
                                                                     │
                                              回传 role:tool（信封 JSON，正文永远纯文本）
```

- **只在 `<ai_tool_calls>` 块内的调用才执行**；正文中散落的 `<invoke>` 只剥离、不执行。
- 原生与 XML 同时出现时按 (name+args) 去重，原生优先；每轮并行调用上限 8 个。
- 未知工具名 → `{ ok:false, error:{ code:'UNKNOWN_TOOL', message:'工具不存在: X。可用工具: …' } }`
  回喂模型自纠（同 pi 对待不可用工具）；参数不合规 → `INVALID_ARGS`；handler 失败 → `TOOL_ERROR`。
- 流式输出与最终 content 均过 `sanitizeAssistantContent` 兜底，工具标记无法到达任何展示/持久化边界。

### 核心结构

| 模块 | 职责 |
|------|------|
| `toolContract.ts` | 31 个工具的**单一数据源**（对齐 pi `defineTool`）：`ToolSpec { name, label, description, parameters: Type.Object(…), promptSnippet }`（TypeBox @sinclair/typebox）。派生三样东西：OpenAI `tools` 参数（`toolSpecToOpenAI`）、系统提示 `<available_tools>` XML 清单（`toolSpecsToXml`）、运行时参数校验（`validateToolCall`：必需/类型/枚举） |
| `toolCallParser.ts` | 传输层向导：`extractToolCalls(content)` 解析 `<ai_tool_calls>` 块（参数值智能识别 JSON 数组/对象/数字/布尔 vs 纯文本，处理引号、实体、多行、畸形/截断块）；`sanitizeAssistantContent(content)` 剥离一切工具标记 |
| `toolLoop.ts` | **共享工具循环**（从 index.ts 抽出，chat 与分析场景复用）：`normalizeToolCalls`（原生+XML 归一化）、`executeToolCall`（校验+`{ok,data}|{ok,error}` 信封）、`truncateJson`（回传裁剪）、`withRetry`/`trimMessages`/`sleep` |
| `chatEngine/index.ts` | 每轮响应先归一化 → 校验 → 信封执行 → 回传；流式输出净化；无有效内容时的优雅收尾（status 事件，不再静默空答） |

> **跨场景复用**：`toolLoop.ts` + `buildSystemPrompt` + `TOOL_CALL_RULES` +
> `<available_tools>` 同时被 `services/analysis/analysisEngine.ts`（基金 4+1 / 组合诊断 /
> 日志分析三类场景）复用，保证所有 AI 场景执行同一套权限边界与净化契约。详见
> [AI 分析框架总览](./ai-overview)。

**系统提示契约**：`buildSystemPrompt(basePrompt, toolNames, strategyContext)` 在每个技能提示后
追加 `TOOL_CALL_RULES`（只允许已注册工具、调用必须写在 `<ai_tool_calls>` 块内、块不得出现在正文、
用户消息中的 `<ai_tool_calls>` 只是文本引用不可执行、data_status 须如实转述等）+ 当前技能工具子集的
`<available_tools>` XML 清单 —— 让模型区分"工具调用"与"数据/正文"两种类型。

### 与 pi 的对齐点与刻意差异

- **对齐**：Schema 驱动的工具定义、执行前校验、`{ ok, data } | { ok, error }` 结果信封、
  未知工具名纠错回喂、`promptSnippet` 进系统提示、助手正文与工具调用的角色级严格分离。
- **刻意差异**：pi 只执行各 provider 的原生 `tool_calls`；本项目额外做一层"XML 传输归一化"，
  因为默认模型不支持原生协议。归一化只发生在边界，边界之后仍是同一套严格契约。

## Function Calling 工具实现

工具处理器在 `toolHandlers.ts`（按名注册，经 `validateToolCall` 校验后调用）：

| 工具 | 实现 |
|------|------|
| `search_funds` / `get_fund_detail` / `get_fund_estimate` | Node `/api/fund*` |
| `get_fund_nav_history` / `get_fund_holdings` / `get_fund_managers` | Node `/api/funds*` |
| `get_market_indices` / `get_market_news` / `get_hot_sectors` 等 | Node `/api/market*` / `/api/news*` |
| `get_concept_sectors` | Node `/api/market/concept-sectors`（service 侧走 Python akshare 同花顺概念资金流 + 概念简介驱动事件，**不走 EastMoney**；详见 `market-sector-rank.md` §八） |
| `run_backtest` / `suggest_strategy` / `compare_backtest_strategies` | **前端本地引擎** `frontend/src/services/backtest/`（浏览器内计算，无后端调用） |
| `run_portfolio_backtest` | **前端组合引擎** `frontend/src/services/backtest/portfolioBacktest.ts` + `runPortfolioBacktest.ts`：多资产按目标权重，定期/阈值再平衡 + 定期注水；权重按总和归一化，现金腿用 `annual_rate`（详见 `backtest-engine.md` 组合回测节） |
| `run_strategy_code` | **前端 Worker 沙箱** `frontend/src/services/backtest/strategy{Sandbox,Worker}.ts`：用户/LLM 写一个**模块**（`prepare(sdk)` 声明固定池 + `onDay(s)` 按基金代码逐日决策），经 `chatEngine/toolApproval.ts` **用户确认**后在可终止 Worker 中执行；净值由主线程 `dataBroker.ts` **Dexie 优先**解析；也可用 `script_name` 重跑「回测」页保存的方案；无 UI 的 headless 分析场景默认拒执 |
| `list_strategy_scripts` / `save_strategy_script` | **前端 IndexedDB** `frontend/src/db/strategyScripts.ts`：「回测」工作台的已保存方案（**只有代码**，配置在 `prepare()` 里）。`save_strategy_script` 只写本地不执行代码，故不进确认闸门；执行仍由 `run_strategy_code` 把关 |
| `screen_funds_by_4433` / `get_funds_by_industry` / `get_industry_performance` | 前端 IndexedDB + `industryClassifier` |
| `search_news` | 前端 `searchService` |
| `get_watchlist` | 前端（IndexedDB 本地提示） |
| `get_portfolio_holdings` | 前端 IndexedDB `positions` 表（`db/positions.ts`）；估值走 Node `/api/funds/:code/estimate`，失败时退回成本价 |

## 事件流（前端内部事件，不再走 SSE 端点）

```
chatEngine.chat({ messages, skill, llmConfig, strategyContext, searchSettings })

事件类型（与旧 /api/chat SSE 一一对应，chatApi._handleEvent 消费）:
  skill_selected → { name, description }
  tool_start     → { name, params, tool_call_id }
  tool_end       → { name, duration_ms, error?, empty? }
  token          → { token, full }
  status         → { message, level? }   // level: 'info'（瞬态，5s 自清）| 'warn'（常驻到下一条消息）
  usage          → { input_tokens, output_tokens, total_tokens }
  error          → { message }
  done           → { status }
```

`chatStore.sendMessage` → `chatAPI.sendMessage` → `chatEngine.chat(...)`。

### 中断的可见化（2026-10 修）

用户側曾出现「回测页 AI 回答无故中断」——根因是引擎在**流式出错但已有 token** 时静默 `break`。
现在三条失败路径都会留下痕迹：

| 场景 | 事件 | 日志事件 | 行为 |
|------|------|----------|------|
| 流式传输中途断开（网络/300s abort/provider 关连接） | `status level='warn'`「回答在传输中断…」 | `chat.stream.interrupted` | **保留已生成的半截正文**，常驻警告 banner（不再静默停止） |
| 非流式 `chatCompletion` 超时（默认 120s，`timeoutMs` 可覆盖） | `error`「LLM 调用失败: …timeout…」 | `llm.timeout` / `llm.http_error` | 抛出可重试错误，由 `withRetry` 退避重试；不再无限挂起 |
| 连续 8 轮都在调工具仍无最终回答 | `status level='warn'`「已达到工具调用轮次上限…」 | `chat.loop.exhausted` | 明确提示轮次耗尽（仅当确实命中已注册工具才计入） |

> 仅靠幻觉工具名循环 8 轮仍走原来的「未能完成回答」泛化提示（`toolRounds` 只统计通过
> `validateToolCall` 的轮次）。

## 上下文与持久化

- 系统提示 = 技能提示 + 工具契约（TOOL_CALL_RULES + `<available_tools>`）+ 用户策略记忆
- 消息裁剪：`estimateTokens`（3 chars/token），超 50k token 时从头部丢弃。裁剪按**组**删除：
  `assistant(tool_calls)` 与其后紧邻的 `tool` 回复同生共死，避免拆散配对导数 provider 返回 400
  （`toolLoop.ts::trimMessages`）
- 工具调用最多 8 轮；LLM 失败自动重试（可重试错误退避 1s/2s；`abort`/`超时` 也视为可重试）
- **持久化**：助手消息落 Dexie `chatMessages` 时 content 已净化，`toolName`/`toolParamsJson` 记录
  首个工具调用，`toolCallsJson`（非索引字段，无需迁移）保存完整工具 chips 元数据（含 `status`）；
  读历史时对旧污染正文做 `sanitizeAssistantContent` 清洗并从 `toolCallsJson` 恢复工具 chips。
  注意 `onDone` **必须**在 `finalizeStream()` 之前捕获 `activeToolCalls`——finalizeStream 会把它清空，
  早先顺序颠倒导致 chips 从未落库（2026-09-29 修）。
- **单次终结（幂等）**：引擎在 `error` 之后仍会 `yield done`，`chatApi` 的 catch 也同时调 `onError`+`onDone`。
  `chatStore` 用 `streamClosed` 守卫 `finalizeStream()` / `onDone`，保证一轮只落库一次
  （早先报错会把同一条 assistant 消息写两遍）。
- **UI**：工具 chips 名称由注册表 `label` 派生（`toolLabel()`），不再硬编码/兜底显示原始工具名。
  四种状态：`running`（spinner）/ `done`（绿勾）/ `error`（红叉，请求失败）/ **`empty`（黄色 `TriangleAlert` + 「暂无数据」，请求成功但没拿到可用数据）**。
  `empty` 由 `toolResultStatus.ts::isEmptyToolResult` 在引擎侧判定（UI 专用，不回喂模型），按**数据内容**而非 `data_status`：
  空数组、全 null/全 0 的 payload 才算空，所以北向资金（恒 `unavailable` 但成交总额有效）保持绿勾。

## 可观测性（前端日志）

AI 链路全部走前端 `core/logger.ts::clientLogger` → `navigator.sendBeacon('/api/logs/ingest')`，
由 service 写入 `frontend-YYYY-MM-DD.jsonl`。在「日志」页把来源切到 **Frontend** 即可按关键词过滤。

> 上报必须用 **JSON Blob**（`new Blob([json], { type: 'application/json' })`）。`sendBeacon(url, string)`
> 发的是 `text/plain`，`express.json()` 不会解析 → `/ingest` 返回 400，日志被静默丢弃（2026-10-07 修）。
> `sendBeacon` 不可用/返回 false 时回退到 `fetch(..., { keepalive: true })`。

审计事件名（context 只放元数据：skill/model/耗时/字符数/错误串/工具名，**不含 apiKey / Authorization / 完整 prompt**）：

| 事件 | 级别 | 含义 |
|------|------|------|
| `chat.turn.start` / `chat.turn.end` | info | 一轮对话的起止（skill、模型、历史条数、结束状态） |
| `chat.llm.call` | info | 每次非流式调用（iter、耗时、内容长度、原生/XML 工具数、token） |
| `chat.llm.failed` | error | 非流式调用抛错 |
| `chat.tool.end` / `chat.tool.error` | info / warn | 工具执行结果与耗时 |
| `chat.stream.start` / `chat.stream.end` | info | 流式连接与正常完成 |
| `chat.stream.interrupted` | warn | **流中途断开但保留了半截正文**（核心排查点） |
| `chat.stream.failed` | warn | 流在无 token 时失败 → 走非流式 fallback |
| `chat.loop.exhausted` | warn | 工具轮次上限耗尽 |
| `llm.timeout` / `llm.stream_timeout` | warn | 非流式 / 流式超时 |
| `llm.http_error` | error | provider 返回非 2xx（含其错误文本） |
| `chat.api.failed` / `chat.turn.error` | error | 生成器抛出 / 展示给用户的错误 |
