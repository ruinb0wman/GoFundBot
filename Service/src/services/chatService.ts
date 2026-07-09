import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/index.js';
import { logger } from '../core/logger.js';
import { SKILL_MAP, SkillRouter } from './chatSkills.js';
import { TOOL_DEFINITIONS, executeTool } from './chatTools.js';

const MAX_TOOL_ITERATIONS = 8;
const MAX_CONTEXT_TOKENS = 8192;
const CHARS_PER_TOKEN = 3;

export interface ChatStreamEvent {
  event: string
  data: string
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateMessagesTokens(messages: ChatCompletionMessageParam[]): number {
  let total = 0;
  for (const m of messages) {
    total += 4;
    if (typeof m.content === 'string') {
      total += estimateTokens(m.content);
    }
    if ('tool_calls' in m && m.tool_calls) {
      for (const tc of m.tool_calls as Array<{ function: { name: string; arguments: string } }>) {
        total += estimateTokens(tc.function.name + tc.function.arguments);
      }
    }
    if ('tool_call_id' in m && m.tool_call_id) {
      total += estimateTokens(m.tool_call_id);
    }
  }
  return total;
}

function trimMessages(messages: ChatCompletionMessageParam[], maxTokens: number): void {
  let dropped = 0;
  while (estimateMessagesTokens(messages) > maxTokens && messages.length > 1) {
    const skip = messages.length > 0 && messages[0]?.role === 'system' ? 1 : 0;
    if (messages.length <= skip + 1) break;
    messages.splice(skip, 1);
    dropped++;
  }
  if (dropped > 0) {
    logger.warn('chat context trimmed', { dropped, remainingTokens: estimateMessagesTokens(messages) });
  }
}

function buildToolsParam(skillName: string) {
  const skill = SKILL_MAP[skillName];
  const toolSet = skill ? new Set(skill.toolNames) : null;
  const filtered = toolSet
    ? TOOL_DEFINITIONS.filter(t => toolSet.has(t.function.name))
    : TOOL_DEFINITIONS;
  return filtered.map(t => ({
    type: 'function' as const,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters as Record<string, unknown>,
    },
  }));
}

export async function* chat(
  messages: Array<{ role: string; content: string }>,
  skillName?: string,
): AsyncGenerator<ChatStreamEvent> {
  const apiKey = process.env.LLM_API_KEY || '';
  const apiBase = process.env.LLM_API_BASE || 'https://api.siliconflow.cn/v1';
  const model = process.env.LLM_MODEL || 'opencode/deepseek-v4-pro';

  if (!apiKey) {
    yield { event: 'error', data: JSON.stringify({ message: 'AI 服务未配置，请检查 LLM_API_KEY 环境变量' }) };
    yield { event: 'done', data: JSON.stringify({ status: 'done' }) };
    return;
  }

  const client = new OpenAI({ apiKey, baseURL: apiBase });
  const router = new SkillRouter(apiKey, apiBase, model);
  const userMessage = messages.length > 0 ? (messages[messages.length - 1]?.content || '') : '';

  const resolvedSkill = await router.routeWithLlm(userMessage, skillName);
  const resolvedSkillName = resolvedSkill.name;

  yield {
    event: 'skill_selected',
    data: JSON.stringify({ name: resolvedSkillName, description: resolvedSkill.description }),
  };

  const openaiMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: resolvedSkill.systemPrompt },
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  trimMessages(openaiMessages, MAX_CONTEXT_TOKENS);

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    let response;
    try {
      response = await client.chat.completions.create({
        model,
        messages: openaiMessages,
        tools: buildToolsParam(resolvedSkillName),
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 4096,
      });
    } catch (error) {
      logger.error('LLM call failed', { error: String(error) });
      yield { event: 'error', data: JSON.stringify({ message: `LLM 调用失败: ${String(error)}` }) };
      break;
    }

    const message = response.choices[0]?.message;

    if (message?.tool_calls && message.tool_calls.length > 0) {
      const toolCalls = message.tool_calls.filter(tc => tc.type === 'function') as Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>;

      openaiMessages.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const tc of toolCalls) {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        yield {
          event: 'tool_start',
          data: JSON.stringify({ name: tc.function.name, params: args, tool_call_id: tc.id }),
        };

        const startTime = Date.now();
        const result = await executeTool(tc.function.name, args);
        const durationMs = Date.now() - startTime;

        yield {
          event: 'tool_end',
          data: JSON.stringify({ name: tc.function.name, tool_call_id: tc.id, duration_ms: durationMs }),
        };

        let resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        if (resultStr.length > 4000) {
          resultStr = resultStr.slice(0, 4000) + '... (truncated)';
        }

        openaiMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultStr,
        });
      }

      trimMessages(openaiMessages, MAX_CONTEXT_TOKENS);
    } else {
      const content = message?.content || '';
      let fullContent = '';

      trimMessages(openaiMessages, MAX_CONTEXT_TOKENS);

      try {
        const stream = await client.chat.completions.create({
          model,
          messages: openaiMessages,
          temperature: 0.3,
          max_tokens: 4096,
          stream: true,
        });

        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta;
          const token = delta?.content || '';
          if (token) {
            fullContent += token;
            yield { event: 'token', data: JSON.stringify({ token, full: fullContent }) };
          }
        }
      } catch (error) {
        if (fullContent) {
          yield { event: 'token', data: JSON.stringify({ token: '', full: fullContent }) };
        } else {
          yield { event: 'error', data: JSON.stringify({ message: `流式输出失败: ${String(error)}` }) };
        }
      }
      break;
    }
  }

  yield { event: 'done', data: JSON.stringify({ status: 'done' }) };
}
