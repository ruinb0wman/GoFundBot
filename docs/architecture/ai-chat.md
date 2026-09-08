# AI 对话系统

> 对话引擎已前端化：`frontend/src/services/chatEngine/`（skills + toolContract +
> toolCallParser + toolHandlers + 编排原本在 Node `chatService/chatSkills/chatTools/chatIndustryTools`）。
> Node `/api/chat` 已撤销。LLM 调用走前端 `llm.ts`（浏览器 fetch / tauri plugin-http），
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
| `toolContract.ts` | 25 个工具的**单一数据源**（对齐 pi `defineTool`）：`ToolSpec { name, label, description, parameters: Type.Object(…), promptSnippet }`（TypeBox @sinclair/typebox）。派生三样东西：OpenAI `tools` 参数（`toolSpecToOpenAI`）、系统提示 `<available_tools>` XML 清单（`toolSpecsToXml`）、运行时参数校验（`validateToolCall`：必需/类型/枚举） |
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
| `run_backtest` / `suggest_strategy` | Node `/api/backtest*`（PythonRunner） |
| `screen_funds_by_4433` / `get_funds_by_industry` / `get_industry_performance` | 前端 IndexedDB + `industryClassifier` |
| `search_news` | 前端 `searchService` |
| `get_watchlist` | 前端（IndexedDB 本地提示） |

## 事件流（前端内部事件，不再走 SSE 端点）

```
chatEngine.chat({ messages, skill, llmConfig, strategyContext, searchSettings })

事件类型（与旧 /api/chat SSE 一一对应，chatApi._handleEvent 消费）:
  skill_selected → { name, description }
  tool_start     → { name, params, tool_call_id }
  tool_end       → { name, duration_ms, error? }
  token          → { token, full }
  status         → { message }
  usage          → { input_tokens, output_tokens, total_tokens }
  error          → { message }
  done           → { status }
```

`chatStore.sendMessage` → `chatAPI.sendMessage` → `chatEngine.chat(...)`。

## 上下文与持久化

- 系统提示 = 技能提示 + 工具契约（TOOL_CALL_RULES + `<available_tools>`）+ 用户策略记忆
- 消息裁剪：`estimateTokens`（3 chars/token），超 50k token 时从头部丢弃
- 工具调用最多 8 轮；LLM 失败自动重试（可重试错误退避 1s/2s）
- **持久化**：助手消息落 Dexie `chatMessages` 时 content 已净化，`toolName`/`toolParamsJson` 记录
  首个工具调用，`toolCallsJson`（非索引字段，无需迁移）保存完整工具 chips 元数据；
  读历史时对旧污染正文做 `sanitizeAssistantContent` 清洗并从 `toolCallsJson` 恢复工具 chips。
- **UI**：工具 chips 名称由注册表 `label` 派生（`toolLabel()`），不再硬编码/兜底显示原始工具名。
