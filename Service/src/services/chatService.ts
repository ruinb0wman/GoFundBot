import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/index.js';
import { logger } from '../core/logger.js';
import { SKILL_MAP, SkillRouter } from './chatSkills.js';
import { TOOL_DEFINITIONS, executeTool } from './chatTools.js';

const MAX_TOOL_ITERATIONS = 8;
const MAX_CONTEXT_TOKENS = 50000;
const CHARS_PER_TOKEN = 3;

export interface ChatStreamEvent {
  event: string
  data: string
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableLLMError(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  if (/\b(40[134]|422)\b/.test(msg)) return false;
  return /timeout|econn|eaddrinuse|enotfound|etimedout|fetch.*failed|network|5\d{2}|429|upstream.*request.*failed|remote.*end.*closed/.test(msg);
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number } = {},
): Promise<{ value: T; retries: number }> {
  const { maxRetries = 2 } = options;
  let retries = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return { value: await fn(), retries };
    } catch (error) {
      if (attempt === maxRetries) throw error;
      if (!isRetryableLLMError(error)) throw error;
      retries++;
      logger.warn(`LLM retry ${retries}/${maxRetries}`, { error: String(error) });
      await sleep(1000 * (attempt + 1));
    }
  }
  throw new Error('unreachable');
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

function chunkBySentence(text: string, maxChunk = 50): string[] {
  const re = /[。！？\n！\n？\n。]+|.*?[，；、：\s]+|.+/g;
  const result: string[] = [];
  let buffer = '';
  for (const match of text.matchAll(re)) {
    const seg = match[0];
    if (buffer.length + seg.length > maxChunk && buffer.length > 0) {
      result.push(buffer);
      buffer = '';
    }
    buffer += seg;
  }
  if (buffer) result.push(buffer);
  return result;
}

export async function* chat(
  messages: Array<{ role: string; content: string }>,
  skillName?: string,
  llmConfig?: { apiKey?: string; apiBase?: string; model?: string },
): AsyncGenerator<ChatStreamEvent> {
  const apiKey = llmConfig?.apiKey || '';
  const apiBase = llmConfig?.apiBase || 'https://api.siliconflow.cn/v1';
  const model = llmConfig?.model || 'Qwen/Qwen2.5-7B-Instruct';

  if (!apiKey) {
    yield { event: 'error', data: JSON.stringify({ message: 'AI 服务未配置，请在设置中配置 AI 服务密钥' }) };
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
    let llmUsage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } = {};
    try {
      const { value: llmResponse, retries: llmRetries } = await withRetry(
        () => client.chat.completions.create({
          model,
          messages: openaiMessages,
          tools: buildToolsParam(resolvedSkillName),
          tool_choice: 'auto',
          temperature: 0.3,
          max_tokens: 4096,
        }),
        { maxRetries: 2 },
      );
      response = llmResponse;
      if (llmRetries > 0) {
        yield { event: 'status', data: JSON.stringify({ message: `LLM 调用失败，已自动重试 ${llmRetries} 次` }) };
      }
      if (response.usage) {
        llmUsage = {
          input_tokens: response.usage.prompt_tokens ?? undefined,
          output_tokens: response.usage.completion_tokens ?? undefined,
          total_tokens: response.usage.total_tokens ?? undefined,
        };
      }
    } catch (error) {
      logger.error('LLM call failed after retries', { error: String(error) });
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
      let streamUsage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } = llmUsage;

      trimMessages(openaiMessages, MAX_CONTEXT_TOKENS);

      try {
        const { value: stream, retries: streamRetries } = await withRetry(
          () => client.chat.completions.create({
            model,
            messages: openaiMessages,
            temperature: 0.3,
            max_tokens: 4096,
            stream: true,
            stream_options: { include_usage: true },
          }),
          { maxRetries: 2 },
        );
        if (streamRetries > 0) {
          yield { event: 'status', data: JSON.stringify({ message: `LLM 调用失败，已自动重试 ${streamRetries} 次` }) };
        }

        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta;
          if (chunk.usage) {
            streamUsage = {
              input_tokens: chunk.usage.prompt_tokens ?? undefined,
              output_tokens: chunk.usage.completion_tokens ?? undefined,
              total_tokens: chunk.usage.total_tokens ?? undefined,
            };
          }
          const token = delta?.content || '';
          if (token) {
            fullContent += token;
            yield { event: 'token', data: JSON.stringify({ token, full: fullContent }) };
          }
        }
      } catch (error) {
        if (fullContent) {
      yield { event: 'token', data: JSON.stringify({ token: '', full: fullContent }) };
        break;
        }

        logger.warn('stream fallback to non-streaming', { error: String(error) });

        try {
          const { value: fallbackResponse, retries: fallbackRetries } = await withRetry(
            () => client.chat.completions.create({
              model,
              messages: openaiMessages,
              temperature: 0.3,
              max_tokens: 4096,
              stream: false,
            }),
            { maxRetries: 1 },
          );
          if (fallbackRetries > 0) {
            yield { event: 'status', data: JSON.stringify({ message: `LLM 调用失败，已自动重试 ${fallbackRetries} 次` }) };
          }
          const text = fallbackResponse.choices[0]?.message?.content || '';
          if (fallbackResponse.usage) {
            streamUsage = {
              input_tokens: fallbackResponse.usage.prompt_tokens ?? undefined,
              output_tokens: fallbackResponse.usage.completion_tokens ?? undefined,
              total_tokens: fallbackResponse.usage.total_tokens ?? undefined,
            };
          }
          if (text) {
            for (const chunk of chunkBySentence(text, 50)) {
              fullContent += chunk;
              yield { event: 'token', data: JSON.stringify({ token: chunk, full: fullContent }) };
            }
          }
        } catch (fallbackError) {
          yield { event: 'error', data: JSON.stringify({ message: `LLM 调用失败: ${String(fallbackError)}` }) };
          break;
        }
      }

      if (streamUsage.total_tokens) {
        yield { event: 'usage', data: JSON.stringify(streamUsage) };
      }
      break;
    }
  }

  yield { event: 'done', data: JSON.stringify({ status: 'done' }) };
}
