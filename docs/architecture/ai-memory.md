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
