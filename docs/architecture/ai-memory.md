# 记忆与反思系统

## 存储流程

```typescript
// analysisMemory.ts
export async function storeAnalysis(fundCode, result) {
  await db.analysisMemory.add({
    fundCode,
    analysisDate: Date.now(),
    rating: result.rating,
    sentimentScore: result.sentiment_score,
    thesis: result.summary?.slice(0, 500),
    resolved: 0,           // 未验证
    actualReturn: null,
    reflection: null,
    resolvedDate: null,
  });
}
```

## 验证与反思

```typescript
export async function resolvePending(fundCode, currentReturn) {
  const cutoff = Date.now() - 7 * 86400000;  // 7 天后验证
  const toResolve = pending.filter(r => r.analysisDate < cutoff);

  for (const record of toResolve) {
    // 调用 LLM 生成反思
    const resp = await fetch('/api/analysis-memory/reflect', {
      body: JSON.stringify({ fundCode, rating, thesis, sentimentScore, actualReturn }),
    });
    reflection = resp.data?.reflection;

    // LLM 失败时 fallback 模板
    reflection = currentReturn >= 0
      ? '本次判断方向正确，看多逻辑得到验证。'
      : '本次判断方向有误，风险因素被低估。';

    await db.analysisMemory.update(record.id, { actualReturn, reflection, resolved: 1 });
  }
}
```

## 历史注入

```typescript
export async function getPastContext(fundCode, n = 3) {
  // 取最近 n 条已验证的分析记录
  const records = await db.analysisMemory
    .where({ fundCode, resolved: 1 })
    .reverse()
    .sortBy('analysisDate');

  // 格式化为 Markdown 注入下一轮分析
  return '## 历史分析回顾\n\n---\n### 第1次分析（2026-01-15）\n- 评级：Buy\n- 近一月实际收益：+3.5%\n- 事后反思：...';
}
```

## 数据流

```
analyzeFund() → Supervisor 输出
  → 前端 storeAnalysis() → Dexie analysisMemory
  → 7天后 resolvePending() → LLM 反思 → 更新 resolved=1
  → 下次 analyzeFund() → getPastContext() → 注入分析师 prompt
```

## 策略记忆（策略板块）

策略板块（`/strategy`）新增**策略记忆**系统，与历史分析记忆互补：

- 存储：Dexie `strategies` 表（`++id, active, updatedAt`），字段 title / content / tags / active / source
- 生成：策略板块内与 AI 讨论后「保存为策略」，或编辑表单中「AI 帮我起草」（`POST /api/strategy/draft`）
- 注入：`buildActiveStrategyContext()` 将启用中的策略格式化为 Markdown，随 `strategyContext` 字段注入基金分析（aiAnalyst 4 分析师 + 总监）、持仓诊断（portfolioAnalyst）、AI 对话（chatService buildSystemPrompt）
- 隔离：策略讨论会话复用 `chatSessions`，以 `channel: 'strategy'` 与主聊天隔离

详见 [策略板块](/strategy/index) 与 [策略记忆与 AI 注入](/strategy/memory-injection)。
