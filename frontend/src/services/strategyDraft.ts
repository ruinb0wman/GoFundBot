/**
 * Frontend strategy drafting (AI).
 * Ported from Service `strategyService.ts`; LLM via `llm.ts`.
 */

import { chatCompletionJson, type LLMConfig } from './llm'

export interface StrategyDraftRequest {
  topic: string
  strategyContext?: string
}

export interface StrategyDraft {
  title: string
  content: string
  tags: string[]
}

const DRAFT_SYSTEM_PROMPT = `你是一位投资策略起草助手。用户会给出一个策略主题，可能附带其已有的策略记忆。
请基于主题起草一份结构化、可执行的个人投资策略，包含：投资目标、资金分配、标的范围、买卖纪律、风险管理、复盘机制。
只输出 JSON 对象，字段如下：
{
  "title": "策略标题（简短，10-20字）",
  "content": "策略正文（中文 markdown 分条列出，含上述要点；若附带了用户的策略记忆，需与之兼容并在开头注明如何衔接）",
  "tags": ["1-3个标签，如：定投、价值投资、长期持有"]
}
不要输出 JSON 以外的任何内容。`

const DEFAULT_MODEL = 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B'

export function fallbackDraft(topic: string): StrategyDraft {
  return {
    title: topic.trim().slice(0, 30) || '我的投资策略',
    content: `围绕「${topic}」的策略草案：
- 投资目标：待明确（建议设定预期收益与持有期限）
- 资金分配：待明确（建议按风险承受能力划分仓位）
- 买卖纪律：待明确（建议设定买入分批规则与卖出条件）
- 风险管理：待明确（建议设定最大回撤承受与止损规则）

可在策略板块与 AI 讨论后完善。`,
    tags: [],
  }
}

export async function draftStrategy(
  req: StrategyDraftRequest,
  llmConfig?: LLMConfig,
): Promise<StrategyDraft> {
  if (!req.topic.trim()) {
    throw new Error('主题不能为空')
  }
  if (!llmConfig?.apiKey) {
    return fallbackDraft(req.topic)
  }

  const strategyCtx = req.strategyContext?.trim()
    ? `\n用户已有策略记忆：\n${req.strategyContext.trim()}`
    : ''

  try {
    const parsed = await chatCompletionJson<Partial<StrategyDraft>>(
      { ...llmConfig, model: llmConfig.model || DEFAULT_MODEL },
      {
        messages: [
          { role: 'system', content: DRAFT_SYSTEM_PROMPT },
          { role: 'user', content: `策略主题：${req.topic}${strategyCtx}` },
        ],
        temperature: 0.4,
        max_tokens: 2048,
      },
    )
    return {
      title: parsed.title?.trim() || fallbackDraft(req.topic).title,
      content: parsed.content?.trim() || '',
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string').slice(0, 3) : [],
    }
  } catch {
    return fallbackDraft(req.topic)
  }
}
