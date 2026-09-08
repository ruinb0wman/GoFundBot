# AI 基金分析与持仓分析

> 基金分析与持仓诊断均已接入统一「场景 Skill」框架（`services/analysis/`）：
> 每位分析师与总监都是**可工具的子调用**，走与 chat 相同的归一化/校验/信封/
> Schema 校验/净化边界；无缺口时单次 JSON 直出。

## 场景注册表（四件套）

`analysis/analysisScenarios.ts` 定义 `fund_analysis`（multi-analyst）与
`portfolio_diagnosis`（single）两个 Skill 场景；每个场景 = Skill（systemPrompt +
工具子集）+ 输出 Schema（`scenarioTypes.ts`）+ pipeline + fallback。

```
fund_analysis（4+1）
  ├─ performance 分析师  工具: get_fund_nav_history / get_fund_estimate / get_index_kline
  ├─ holding     分析师  工具: get_fund_holdings / get_fund_detail
  ├─ manager     分析师  工具: get_fund_managers / get_fund_detail
  ├─ market      分析师  工具: get_market_news / get_hot_sectors / get_concept_sectors
  │                        / get_index_kline / get_north_flow / get_main_flow / search_news
  └─ 总监（串行，调全集） 工具: FULL_TOOL_NAMES（25 个）
```

| 分析师 | Prompt | 输入数据 | 评估重点 |
|--------|--------|---------|---------|
| **Performance** (业绩) | 场景内嵌 TS 字符串 | 净值数据、风险指标、行业标签 | 收益率、回撤、夏普比率、同类排名 |
| **Holding** (持仓) | 场景内嵌 TS 字符串 | 持仓股票列表、占比 | 持仓集中度、行业分布、重仓股质量 |
| **Manager** (经理) | 场景内嵌 TS 字符串 | 经理履历、管理规模、从业经验 | 经理经验、历史业绩、稳定性 |
| **Market** (市场) | 场景内嵌 TS 字符串 | 行业标签、市场行情、宏观背景 | 市场环境、行业景气度、宏观风险 |

**分析师输出格式**（`AnalystReportSchema` 校验）：
```typescript
interface AnalystReport {
  analyst_role: string;       // 'performance' | 'holding' | 'manager' | 'market'
  thesis: string;             // 核心论点
  score: number;              // 评分 1-10
  key_evidence: string[];     // 关键证据（数据支撑）
  risk_flags: string[];       // 风险提示
}
```

**异常处理**：单个分析师调用失败（网络/API/Schema 校验不通过重试耗尽），不阻断其他
分析师，返回结构化降级 `{ score: 5, thesis: '调用异常', key_evidence: ['LLM API
调用失败'] }`；总监失败返回 `supervisor: null`。LLM key 缺失时直接走降级、不发请求。

## 引擎执行流（fundAnalyst.ts → analysisEngine.ts）

```
analyzeFundStream(input, llmConfig)              // 公共签名与阶段语义不变
  yield start
  4 × 分析师 runTask（并行，各自子集工具 + AnalystReportSchema）
      └─ 引擎每轮: buildSystemPrompt(分析师Prompt+<available_tools>+策略记忆)
                   → chatCompletion(tools) → 归一化 → 信封执行 → 纠错回喂
                   → 无工具时解析正文 JSON 或 chatCompletionJson 强制 JSON
                   → Value.Check(AnalystReportSchema) 失败 INVALID_OUTPUT 重试(≤2)
                   → 仍失败走 analystFallback
  yield token × 4（固定顺序 performance/holding/manager/market）
  yield stage「总监合成最终报告...」
  总监 runTask（串行，全集工具 + SupervisorOutputSchema 校验，fallback → null）
  yield result（supervisor JSON）→ yield done
```

`analyzeFund`（非流式）内部消费 `analyzeFundStream`，保证两条路径行为一致。

**Supervisor 输出**（`SupervisorOutputSchema` 校验）：
```typescript
interface SupervisorOutput {
  rating: 'Strong Buy' | 'Buy' | 'Hold' | 'Underweight' | 'Sell';
  sentiment_score: number;        // 情绪得分 0-100
  operation_advice: string;       // 操作建议
  summary: string;                // 综合摘要
  dashboard: {                    // 维度评估
    performance_eval: string;
    manager_ability: string;
    position_analysis: string;
    market_outlook: string;
  };
  highlights: string[];           // 亮点
  risk_factors: string[];         // 风险因素
  news_intel: string[];           // 消息面研判
  detailed_report: string;        // 详细报告
}
```

## 组合/持仓分析（portfolio_diagnosis）

`portfolioAnalyst.ts` 公共 API（`analyzePortfolio` / `fallbackPortfolioResult`）不变：

```
analyzePortfolio(req, llmConfig)
  1. 空列表 → fallbackPortfolioResult([])
  2. 无 key  → fallbackPortfolioResult(inputs, missingKey=true)
  3. Promise.allSettled 预取各基金详情（fundAPI.getFundDetail，容错）
     → buildPortfolioContext（持仓明细/权重/近月收益/重仓）
  4. runTask（portfolio_diagnosis 场景）：
     工具子集 = 指数/板块/北向/涨跌统计/主力资金/快讯/K线/行业业绩
               + get_fund_detail / get_fund_estimate
     Schema  = PortfolioAnalysisResultSchema；fallback = fallbackPortfolioResult
  5. 模型按需调注册表工具自主补充市场数据；输出 Schema 校验后返回
```

`strategyContext`（用户在策略板块启用的策略记忆）经 `buildSystemPrompt` 注入系统提示，
使建议贴合用户策略取向（同时要求不歪曲数据）。详见
[策略记忆与 AI 注入](/strategy/memory-injection)。

## 与 chat 的关系

三位分析场景共享 `chatEngine/toolLoop.ts`（normalizeToolCalls / executeToolCall /
truncateJson / withRetry / trimMessages）与 `buildSystemPrompt`、`toolSpecsToXml`、
`TOOL_CALL_RULES`、`sanitizeAssistantContent`；不新增任何前端依赖
（TypeBox 已就位）。反思系统（reflection.ts）与策略起草（strategyDraft.ts）同为
single 场景，可随时接入同一框架。
