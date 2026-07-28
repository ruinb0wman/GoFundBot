# AI 对话系统

## 技能路由 (SkillRouter)

```
SkillRouter.routeWithLlm(message, preferred?):
  1. preferred 命中 → 直接使用指定 skill
  2. keywordRoute() → 关键词匹配（6 种技能）
     - 优先级: industry_research → fund_screening → news_briefing
              → investment_strategy → market_overview → fund_analysis
  3. keyword 未命中 → llmRoute() → LLM 路由（1 次调用，10 tokens，temperature=0）
  4. 均未命中 → fallback 'general'
```

**7 种技能定义**：

| 技能 | 关键词 | 描述 |
|------|--------|------|
| `fund_analysis` | 分析，评价，怎么样，好不好 | 基金深度分析 |
| `fund_screening` | 筛选，条件，排名，选出 | 基金条件筛选 |
| `industry_research` | 行业，板块，赛道 | 行业板块研究 |
| `market_overview` | 大盘，行情，市场，A股 | 市场概览 |
| `news_briefing` | 快讯，新闻，资讯 | 资讯摘要 |
| `investment_strategy` | 策略，定投，配置 | 投资策略建议 |
| `general` | — | 通用对话 |

## Function Calling 工具集

```
chatTools (7 个工具):
  ├── searchFunds(code: string)          → fundService.searchFunds
  ├── getFundDetail(code: string)        → fundService.getFundDetail
  ├── searchMarketOverview()             → marketService.getMarketOverview
  ├── searchSectorRank(limit: number)    → marketService.getMarketSectors
  ├── searchFlashNews(count: number)     → newsService.getFlashNews
  ├── getIndustryPerformance()           → researchService.getIndustryPerformance
  └── searchWeb(query: string)           → searchService.searchWeb (Bocha→Tavily→DDG)
```

## SSE 事件流

```
POST /api/chat → SSE (text/event-stream)

事件类型:
  event: skill_selected    → { name, description }
  event: tool_start        → { name, params, tool_call_id }
  event: tool_end          → { name, duration_ms, error? }
  event: token             → { token, full }
  event: status            → { message }
  event: usage             → { input_tokens, output_tokens, total_tokens }
  event: error             → { message }
  event: done              → (无 data)
```

前端 `chatApi.ts` 消费事件，驱动 UI 状态：
- `ToolCallInfo`: 工具调用实时状态（name, params, status: running/done/error, durationMs）
- `ChatCallbacks`: onToken, onToolStart, onToolEnd, onSkillSelected, onUsage, onStatus, onDone, onError

## 上下文管理

```typescript
// chatService.ts
const MAX_CONTEXT_TOKENS = 50000;  // 硬上限
const CHARS_PER_TOKEN = 3;

// 构建消息列表时，从历史记录由新到旧截断
// 注入 System Prompt + 可用的 chatTools 定义
// function calling 结果作为 tool role 消息加入上下文
```
