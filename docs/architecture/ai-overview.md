# AI 分析框架总览

## 统一框架：工具契约 + 场景 Skill

所有 AI 场景（对话 + 三类分析）共用同一套**工具契约**与**场景 Skill** 机制：

```
                    AI 分析框架（前端）
┌────────────────────────────────────────────────────────────────┐
│  工具契约层（2026-07 重构，对齐 pi defineTool）                 │
│  toolContract.ts  ToolSpec 单一数据源（TypeBox Schema）        │
│  ├─ toolSpecToOpenAI() → OpenAI tools 参数                     │
│  ├─ toolSpecsToXml()   → 系统提示 <available_tools> XML 清单   │
│  └─ validateToolCall() → 执行前参数校验（UNKNOWN_TOOL/INVALID_ARGS）│
│  toolCallParser.ts 原生 tool_calls ↔ <ai_tool_calls> XML 归一化 │
│  sanitizeAssistantContent() 全边界净化（工具标记永不外泄）       │
│  toolLoop.ts        共享循环：归一化→校验→{ok,data}|{ok,error}  │
│                     信封执行→纠错回喂（chat 与分析场景复用）     │
└────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────┐
│  对话引擎 chatEngine/index.ts                                  │
│  SkillRouter(7 skills) → ReAct 工具循环 → token/工具事件流      │
└────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────┐
│  分析引擎 analysis/analysisEngine.ts（runTask/runScenario）     │
│  每轮：系统提示(Skill+工具子集+策略记忆) → chatCompletion(tools) │
│  → 归一化/信封执行 → 无工具调用时结构化收尾                      │
│  → Value.Check(输出 Schema)，INVALID_OUTPUT 纠错重试(≤2)        │
│  → 仍失败/missing key → scenario.fallback() 结构化降级          │
│                                                                  │
│  场景注册表 analysis/analysisScenarios.ts（Skill + Schema +     │
│  pipeline + fallback 四件套）：                                  │
│  ├─ fund_analysis      4 分析师并行(工具子集) + 总监(全集)      │
│  ├─ portfolio_diagnosis 单任务(市场面+基金工具)                 │
│  └─ log_analysis       自包含单任务(无工具，规则引擎降级)        │
└────────────────────────────────────────────────────────────────┘
```

| 场景 | pipeline | 工具子集 | 输出 Schema | 降级 |
|------|----------|----------|-------------|------|
| 基金分析 `fund_analysis` | multi-analyst 4+1 | 每分析师子集；总监全集 | `AnalystReportSchema` / `SupervisorOutputSchema` / `FundAnalysisResultSchema` | 失败报告 + `supervisor: null` |
| 组合诊断 `portfolio_diagnosis` | single | 指数/板块/资金流/新闻/K线/行业业绩 + 基金详情/估值 | `PortfolioAnalysisResultSchema` | `fallbackPortfolioResult` |
| 日志分析 `log_analysis` | single（无工具） | — | `LogAnalysisSchema` | Node 规则引擎 `/api/logs/analyze` + `llm_error` |

所有输出的字段名与既有 DTO 严格一致 → UI 展示层零改动。LLM 密钥只在前端
（`useLLMConfig` / localStorage），Node 不持有任何 key。

## 子模块导航

| 模块 | 文档 |
|------|------|
| AI 对话系统 | [AI 对话系统](./ai-chat) |
| AI 基金分析与持仓分析 | [AI 基金分析与持仓分析](./ai-fund-analysis) |
| AI 日志分析 | 见本页「AI 日志分析」（前端应用的路由 `/#/settings`，非文档页） |
| 记忆与反思系统 | [记忆与反思系统](./ai-memory) |

## AI 日志分析（设置-日志）

- 前端 Skill 场景 `log_analysis`（`services/analysis/logAnalysis.ts` 适配器）：
  `GET /api/logs/read`（source/date，limit≤500，过滤 warn/error）→ 组装日志上下文
  → `runScenario(log_analysis)` 走统一引擎。
- LLM 成功产出 `llm_summary`（AI 摘要段落）+ patterns/suggestions/critical；
  计数（total/error_count/warn_count）以日志文件 counts 为准。
- LLM key 缺失或调用失败 → 场景 fallback 调现有 `POST /api/logs/analyze`
  规则引擎结果并置 `llm_error`（规则引擎与 service 保留，零改动）。

## LLM 配置体系

```typescript
// useLLMConfig.ts — 前端 localStorage
interface LLMConfig {
  apiKey: string;
  apiBase: string;      // 默认: https://api.siliconflow.cn/v1
  model: string;        // 默认: Qwen/Qwen2.5-7B-Instruct
}
```

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `apiKey` | — | LLM API 密钥 |
| `apiBase` | `https://api.siliconflow.cn/v1` | OpenAI 兼容 API 端点 |
| `model` | `Qwen/Qwen2.5-7B-Instruct` | 模型名称 |

配置通过前端 Settings 页面 → 前端 `useLLMConfig` → localStorage（`gofund-llm-config`）。
LLM 调用走前端 `llm.ts`（OpenAI 兼容 `chat/completions`，浏览器 fetch）。
Node 侧不再存储 LLM/Search 配置，`/api/settings` 仅保留 proxy 子域。

### OpenCode 会话头（`x-opencode-session`）

OpenCode Go/Zen（`https://opencode.ai/zen|/go`）要求每个请求携带**同一对话内稳定不变**的会话 ID，
缺失时上游返回 `400 {"type":"MissingSessionID"}`。实现为 `frontend/src/services/opencodeSession.ts`，
注入点是唯一的 fetch 封装层 `httpClient.nativeFetch`（`llm.ts` 请求随之自动带上）。

| 场景 | 会话 ID 来源 | 存储键 |
|------|--------------|--------|
| chat / strategy 对话 | `chat:<Dexie chatSessions.id>` → 持久化 UUID v4 | localStorage `gofund:opencode-session:conv:<id>`（刷新后复用） |
| 基金分析 / 组合诊断 / 策略起草 / 反思 / 日志分析 | 每标签页稳定 UUID | sessionStorage `gofund:opencode-session:page` |

- 仅对主机 `opencode.ai` 或 `*.opencode.ai`（仅 http/https）注入；其他 LLM / 搜索 / `/api/*` 请求原样发送，不新增预检。
- 会话上下文由 `chatStore → chatApi → chatEngine(config.conversationId) / SkillRouter → llm.ts` 显式透传。
- **不设置也不应设置 `User-Agent`**：浏览器禁止 JS 修改该头，运行环境已全局使用自有签名标识。
- 自定义请求头会触发 CORS 预检（OPTIONS），依赖运行环境的 origin 放行白名单（默认含 `localhost` / `127.0.0.1`；dev `http://localhost:8517`、Electron 静态托管 `http://localhost:8417`）。
- Web Storage 被禁用或 `crypto.randomUUID` 缺失时降级为内存缓存 / RFC4122 v4 兜底，同页面内 ID 仍稳定。
