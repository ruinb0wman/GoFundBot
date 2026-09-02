import { db, type AnalysisMemoryRecord } from './index'
import { generateReflection } from '../services/reflection'
import { useLLMConfig } from '../composables/useLLMConfig'

const RESOLVE_AFTER_DAYS = 7

export async function storeAnalysis(fundCode: string, result: { rating?: string; sentiment_score?: number; summary?: string }): Promise<void> {
  if (!result || !result.rating) return
  await db.analysisMemory.add({
    fundCode,
    analysisDate: Date.now(),
    rating: result.rating ?? '',
    sentimentScore: result.sentiment_score ?? 50,
    thesis: (result.summary ?? '').slice(0, 500),
    resolved: 0,
    actualReturn: null,
    reflection: null,
    resolvedDate: null,
  })
}

export async function resolvePending(fundCode: string, currentReturn: number): Promise<void> {
  const pending = await db.analysisMemory
    .where({ fundCode, resolved: 0 })
    .toArray()

  const cutoff = Date.now() - RESOLVE_AFTER_DAYS * 86400000
  const toResolve = pending.filter(r => r.analysisDate < cutoff)
  if (toResolve.length === 0) return

  for (const record of toResolve) {
    let reflection: string | null = null
    try {
      const llmConfig = useLLMConfig().config.value
      const data = await generateReflection(
        {
          fundCode: record.fundCode,
          rating: record.rating,
          thesis: record.thesis,
          sentimentScore: record.sentimentScore,
          actualReturn: currentReturn,
        },
        llmConfig,
      )
      reflection = data.reflection ?? null
    } catch {
      const direction = currentReturn >= 0 ? 'correct' : 'wrong'
      reflection = direction === 'correct'
        ? '本次判断方向正确，看多逻辑得到验证。后续应继续关注关键假设是否持续成立。'
        : '本次判断方向有误，风险因素被低估。后续分析应更重视下行风险。'
    }

    await db.analysisMemory.update(record.id!, {
      actualReturn: currentReturn,
      reflection,
      resolved: 1,
      resolvedDate: Date.now(),
    })
  }
}

export async function getPastContext(fundCode: string, n = 3): Promise<string> {
  const records = await db.analysisMemory
    .where({ fundCode, resolved: 1 })
    .reverse()
    .sortBy('analysisDate')
  const recent = records.slice(0, n)

  if (recent.length === 0) return ''

  const parts = ['## 历史分析回顾']
  for (let i = 0; i < recent.length; i++) {
    const r = recent[i]
    const dateStr = r.analysisDate ? new Date(r.analysisDate).toISOString().slice(0, 10) : '?'
    parts.push(`\n---\n### 第${i + 1}次分析（${dateStr}）`)
    parts.push(`- 评级：${r.rating}`)
    if (r.actualReturn != null) {
      const sign = r.actualReturn >= 0 ? '+' : ''
      parts.push(`- 近一月实际收益：${sign}${r.actualReturn.toFixed(2)}%`)
    }
    if (r.reflection) {
      parts.push(`- 事后反思：${(r.reflection ?? '').slice(0, 300)}`)
    }
  }
  return parts.join('\n')
}
