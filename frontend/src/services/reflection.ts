/**
 * Frontend analysis-memory reflection (AI).
 * Ported from Service `memoryService.ts`; LLM via `llm.ts`.
 */

import { chatCompletion, type LLMConfig } from './llm'

export interface ReflectionRequest {
  fundCode: string
  rating: string
  thesis: string
  sentimentScore: number
  actualReturn: number
}

export interface ReflectionResponse {
  reflection: string
}

function templateReflection(direction: string): string {
  if (direction === 'correct') {
    return '本次判断方向正确，看多逻辑得到验证。后续应继续关注关键假设是否持续成立。'
  }
  return '本次判断方向有误，风险因素被低估。后续分析应更重视下行风险。'
}

export async function generateReflection(
  req: ReflectionRequest,
  llmConfig?: LLMConfig,
): Promise<ReflectionResponse> {
  if (!llmConfig?.apiKey) {
    const direction = req.actualReturn >= 0 ? 'correct' : 'wrong'
    return { reflection: templateReflection(direction) }
  }

  const direction = req.actualReturn >= 0 ? '正确' : '有误'
  const sentimentNote =
    req.sentimentScore > 50 ? '看多' : req.sentimentScore < 50 ? '看空' : '中性'

  try {
    const response = await chatCompletion(
      { ...llmConfig, model: llmConfig.model },
      {
        messages: [
          {
            role: 'system',
            content: '你是一位基金分析反思助手。请基于之前的分析结论和实际收益，用1-2句话总结具体经验教训。',
          },
          {
            role: 'user',
            content: `之前对基金${req.fundCode}的分析评级为${req.rating}（${sentimentNote}），核心理由：${(req.thesis || '').slice(0, 300)}\n该基金近期实际收益为${req.actualReturn >= 0 ? '+' : ''}${req.actualReturn.toFixed(2)}%。\n请分析之前判断${direction}的原因，并给出一条具体学习经验。`,
          },
        ],
        temperature: 0.3,
        max_tokens: 256,
      },
    )
    const content = response.content?.trim()
    if (content) {
      return { reflection: content }
    }
  } catch {
    // fall through to template
  }

  return { reflection: templateReflection(req.actualReturn >= 0 ? 'correct' : 'wrong') }
}
