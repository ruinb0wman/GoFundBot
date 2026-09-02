# AI 对话系统

> 对话引擎已前端化：`frontend/src/services/chatEngine/`（skills + tools +
> toolHandlers + 编排原本在 Node `chatService/chatSkills/chatTools/chatIndustryTools`）。
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

## Function Calling 工具集

`TOOL_DEFINITIONS`（`tools.ts`）+ 处理器（`toolHandlers.ts`）。工具实现：
- 数据类调用 **Node API**（`api.ts`，路径不变）
- 计算类在**前端本地**完成（4433 / 行业筛选 / 行业表现 → IndexedDB）
- 搜索类走**前端** `searchService.ts`（Exa→Bocha→Tavily→DDG）

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

## 上下文管理

- 系统提示 = 技能提示 + 用户策略记忆（`buildSystemPrompt`）
- 消息裁剪：`estimateTokens`（3 chars/token），超 50k token 时从头部丢弃
- 工具调用最多 8 轮；LLM 失败自动重试（可重试错误退避 1s/2s）