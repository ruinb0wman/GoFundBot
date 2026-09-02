# 策略记忆与 AI 注入

## 一、数据模型

策略记忆存储于浏览器 IndexedDB（Dexie `strategies` 表，前端本地数据，不上传服务器），与自选、持仓、分析记忆同构。

```typescript
// frontend/src/db/index.ts (Dexie version 4)
interface StrategyRecord {
  id?: number
  title: string        // 标题（自动截断 40 字）
  content: string      // 策略正文
  tags: string[]       // 标签
  active: number       // 1 启用 / 0 停用（仅启用条目被注入）
  source: 'manual' | 'ai-draft'  // 来源标记
  createdAt: number
  updatedAt: number
}
// schema: strategies: '++id, active, updatedAt'
```

策略讨论的会话复用 `chatSessions` / `chatMessages` 表，通过 `channel: 'strategy'` 与主聊天隔离：

```typescript
// version 4
chatSessions: '++id, updatedAt, channel'
// 主聊天读取时过滤 channel，旧数据（无 channel 字段）按 'chat' 处理
```

## 二、上下文格式化

`buildStrategyContext()`（`frontend/src/db/strategyMemory.ts`）将启用中的策略格式化为紧凑 Markdown，供提示词注入：

```
## 用户投资策略
### 1. 稳健定投计划
标签：定投、长期持有
内容：每月定投 3000 元，分批买入…
```

约束（防止 token 超限）：
- 仅包含 `active === 1` 的条目，按 `updatedAt` 倒序
- 最多 5 条；单条标题 40 字、内容 600 字截断；总长上限 3000 字

## 三、注入链路（全局生效）

```
策略记忆 Dexie ── buildActiveStrategyContext() ──┐
                                                 ├─▶ 基金分析  fundAnalyst（前端）：4 分析师 + 总监合成
                                                 ├─▶ 持仓诊断  portfolioAnalyst（前端）：组合级合成
                                                 └─▶ AI 对话   chatEngine（前端）：附加到各技能 systemPrompt
```

### 1. 基金分析（前端 `fundAnalyst.ts`，原 `/api/fund/:code/analyze/stream` 已撤销）

- 前端 `useFundAIAnalysis` 构建 `AnalystInput` 时附带 `strategyContext`
- 前端 `fundAnalyst.strategyNote()` 生成「## 用户投资策略」段，注入 performance / holding / manager / market 四名分析师与总监合成 prompt
- 提示词要求：*建议需贴合用户策略取向，但不得为迎合策略而歪曲数据*

### 2. 持仓诊断（前端 `portfolioAnalyst.ts`，原 `POST /api/user/portfolio/analyze` 已撤销）

- 前端 `usePortfolioAIAnalysis` 附带 `strategyContext`
- 前端 `portfolioAnalyst.analyzePortfolio()` 并行拉取基金明细（上限 20 只），压缩为组合上下文（类型 / 权重 / 近 1·3 月收益 / 重仓摘要）后单次 LLM 合成，输出与 `FundAnalysisResult` 同构的 DTO
- 无 LLM Key 或解析失败时返回结构化降级结果（评分 50 + 提示文案），前端正常渲染

### 3. AI 对话（前端 `chatEngine`，原 `POST /api/chat` 已撤销）

- 前端 `chatStore.sendMessage` 在每次发送前调用 `buildActiveStrategyContext()` 获取最新上下文（主聊天与策略研究板块同一 store / 同一实现）
- 策略研究板块将同一 `ChatPanel` 以 `channel='strategy'` 嵌入页面，技能锁定为 `strategy`；会话按 channel 分离
- 前端 `chatEngine.buildSystemPrompt()` 将其附加到当前技能 systemPrompt 之后：

```
{技能系统提示词}

## 用户策略记忆
以下为用户当前启用的投资策略，你的分析与建议需贴合用户的策略取向，但不得为迎合策略而歪曲数据。
{策略上下文}
```

## 四、strategy 技能路由

- `chatEngine/skills.ts` 新增 `strategy` 技能，系统提示词扮演「投资策略顾问」，可调用 general 数据工具集核对基金 / 行情
- 关键词：`我的策略`、`投资风格`、`策略板块`（注：此为代码层关键词原文，与 `skills.ts` 一致，非板块名）、`策略讨论` 等，路由优先级置于首位
- 泛化「策略」词仍走 `investment_strategy`（定投回测），避免抢路由；策略研究板块内聊天强制 `skill='strategy'`，不依赖路由

## 五、AI 起草（前端 `strategyDraft.ts`，原 `POST /api/strategy/draft` 已撤销）

- 前端 `strategyDraft.draftStrategy({ topic, strategyContext }, llmConfig)` 调用 LLM，`response_format: json_object` 输出 `{ title, content, tags }`
- 无 LLM Key 或调用失败时返回占位模板（标题 = 主题，内容 = 待完善提纲），保证功能可用
