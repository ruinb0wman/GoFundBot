# AI 基金分析与持仓分析

## AI 基金分析 (Multi-Agent Debate)

### 四位并行分析师

```typescript
// fundAnalyst.ts（前端）— 四个分析师并行调用
const [perfReport, holdingReport, managerReport, marketReport] = await Promise.all([
  callAnalyst('performance', PERFORMANCE_PROMPT, fundInfo, perfExtra, config),
  callAnalyst('holding', HOLDING_PROMPT, fundInfo, holdingExtra, config),
  callAnalyst('manager', MANAGER_PROMPT, fundInfo, managerExtra, config),
  callAnalyst('market', MARKET_PROMPT, fundInfo, marketExtra, config),
]);
```

| 分析师 | Prompt 文件 | 输入数据 | 评估重点 |
|--------|-----------|---------|---------|
| **Performance** (业绩) | `performanceAnalyst.txt` | 净值数据、风险指标、行业标签 | 收益率、回撤、夏普比率、同类排名 |
| **Holding** (持仓) | `holdingAnalyst.txt` | 持仓股票列表、占比 | 持仓集中度、行业分布、重仓股质量 |
| **Manager** (经理) | `managerAnalyst.txt` | 经理履历、管理规模、从业经验 | 经理经验、历史业绩、稳定性 |
| **Market** (市场) | `marketAnalyst.txt` | 行业标签、市场行情、宏观背景 | 市场环境、行业景气度、宏观风险 |

**分析师输出格式**：
```typescript
interface AnalystReport {
  analyst_role: string;       // 'performance' | 'holding' | 'manager' | 'market'
  thesis: string;             // 核心论点
  score: number;              // 评分 1-10
  key_evidence: string[];     // 关键证据（数据支撑）
  risk_flags: string[];       // 风险提示
}
```

**异常处理**：单个分析师调用失败（网络/API/解析错误），不阻断其他分析师，返回降级报告 `{ score: 5, thesis: '调用异常', key_evidence: ['LLM API 调用失败'] }`。

### Supervisor 合成

```typescript
async function callSupervisor(reports, fundInfo, llmConfig): Promise<SupervisorOutput> {
  // 将四位分析师报告序列化为文本
  const reportsStr = reports.map(r =>
    `### ${r.analyst_role}\n评分：${r.score}/10\n核心论点：${r.thesis}\n关键证据：${r.key_evidence.join(', ')}`
  ).join('\n\n');

  // 调用 LLM 合成最终裁决
  const response = await client.chat.completions.create({
    model, messages: [
      { role: 'system', content: SUPERVISOR_PROMPT },
      { role: 'user', content: `基金信息：\n${fundInfo}\n\n分析师报告：\n${reportsStr}\n\n请综合四位分析师观点，输出最终裁决JSON。` },
    ],
    temperature: 0.2, max_tokens: 8192, response_format: { type: 'json_object' },
  });
}
```

**Supervisor 输出**：
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

### 流式版本

```typescript
// fundAnalyst.ts（前端）— 流式版本用于需要逐步展示的场景
export async function* analyzeFundStream(input: AnalystInput, llmConfig?: LLMConfig):
  AsyncGenerator<{ type: string; data: unknown }> {
  // 逐步 yield 每位分析师报告
  // 最后 yield Supervisor 合成结果
}
```

## AI 持仓分析 (组合分析)

**基础路径**：通过 AI Chat 的 `fund_analysis` skill 触发，`searchFunds` 工具获取基金详情 → `getFundDetail` 获取持仓 → LLM 分析持仓结构。

**持仓分析流程**：

```
用户: "分析我的基金持仓"
  → SkillRouter → fund_analysis
  → chatTools.searchFunds(code) / getFundDetail(code)
  → LLM 分析:
     - 持仓集中度评估（前十大占比）
     - 行业暴露分析（重仓股所属行业）
     - 风格判断（大盘/中小盘，价值/成长）
     - 风险提示（个股集中、行业单一）
```

**组合级分析**：通过 portfolio 数据（Dexie 表）+ 多只基金并行拉取详情 → LLM 综合评估组合分散度、相关性、风险暴露。

**策略参考**：基金分析（前端 `fundAnalyst.ts`）与持仓诊断（前端 `portfolioAnalyst.ts`）均支持 `strategyContext` 字段——前端将用户在策略板块保存的启用中策略注入提示词，使评价与建议贴合用户策略取向（同时要求不歪曲数据）。详见 [策略记忆与 AI 注入](/strategy/memory-injection)。
