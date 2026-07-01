"""ReAct chat loop for AIAgent — mixed in via inheritance."""

import json
from collections.abc import Generator
from typing import Any

from core.logging import get_logger

logger = get_logger(__name__)


class ChatMixin:
    """Mixin providing the chat/ReAct loop method.

    Mixed into AIAgent so it has access to self._api_key, self._api_base,
    self._model, self.is_available(), self._get_tools(), self._execute_tool(),
    self.MAX_TOOL_ITERATIONS, and self.TOOL_TIMEOUT.
    """

    def chat(self, messages: list[dict[str, Any]]) -> Generator[str, None, None]:
        from openai import OpenAI

        if not self.is_available():
            yield 'event: error\ndata: {"message":"AI 服务未配置，请检查 LLM_API_KEY 环境变量"}\n\n'
            yield "event: done\ndata: [DONE]\n\n"
            return

        client = OpenAI(api_key=self._api_key, base_url=self._api_base)

        system_prompt = """你是一位资深金融投资分析师助手，名为 GoFundBot 助手。

你有丰富的工具可以使用，包括查询基金数据、市场行情、北向资金、板块轮动等。
请根据用户的问题自行判断需要调用哪些工具，调用后基于真实数据给出专业分析。

**行为准则**：
1. 必须调用工具获取真实数据，不要凭记忆回答
2. 回答用中文，简洁专业，包含数据解读和投资建议（如有需要）
3. 可以同时调用多个不依赖对方的工具来提升效率
4. 工具返回空结果或报错时如实告知，不要用无关数据替代
5. 用户问什么就回答什么，不要自行转话题；发现找错方向时及时纠正
6. 如果没有找到用户问的特定基金/股票/行业，明确告知并建议其他关键词"""

        openai_messages = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            openai_messages.append({"role": role, "content": content})

        iter_count = 0
        while iter_count < self.MAX_TOOL_ITERATIONS:
            iter_count += 1

            try:
                response = client.chat.completions.create(
                    model=self._model,
                    messages=openai_messages,
                    tools=self._get_tools(),
                    tool_choice="auto",
                    temperature=0.3,
                    max_tokens=4096,
                )
            except Exception as e:
                logger.error(f"LLM call failed: {e}")
                yield f"event: error\ndata: {json.dumps({'message': f'LLM 调用失败: {str(e)}'})}\n\n"
                break

            choice = response.choices[0]
            message = choice.message

            if message.tool_calls:
                openai_messages.append(
                    {
                        "role": "assistant",
                        "content": message.content or "",
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                            }
                            for tc in message.tool_calls
                        ],
                    }
                )

                for tc in message.tool_calls:
                    name = tc.function.name
                    try:
                        args = json.loads(tc.function.arguments)
                    except json.JSONDecodeError:
                        args = {}

                    yield f"event: tool_start\ndata: {json.dumps({'name': name, 'params': args, 'tool_call_id': tc.id})}\n\n"

                    result, duration_ms = self._execute_tool(name, args)

                    yield f"event: tool_end\ndata: {json.dumps({'name': name, 'tool_call_id': tc.id, 'duration_ms': round(duration_ms, 1)}, ensure_ascii=False)}\n\n"

                    result_str = json.dumps(result, ensure_ascii=False) if not isinstance(result, str) else result
                    openai_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": result_str,
                        }
                    )

                    if len(result_str) > 8000:
                        result_str = result_str[:8000] + "... (truncated)"
            else:
                content = message.content or ""
                full_content = ""
                try:
                    stream = client.chat.completions.create(
                        model=self._model,
                        messages=openai_messages,
                        temperature=0.3,
                        max_tokens=4096,
                        stream=True,
                    )
                    for chunk in stream:
                        delta = chunk.choices[0].delta if chunk.choices else None
                        token = delta.content if delta else ""
                        if token:
                            full_content += token
                            yield f"event: token\ndata: {json.dumps({'token': token, 'full': full_content}, ensure_ascii=False)}\n\n"
                except Exception as e:
                    if full_content:
                        yield f"event: token\ndata: {json.dumps({'token': '', 'full': full_content}, ensure_ascii=False)}\n\n"
                    else:
                        yield f"event: error\ndata: {json.dumps({'message': f'流式输出失败: {str(e)}'})}\n\n"
                break

        else:
            yield 'event: error\ndata: {"message":"对话超过最大工具调用次数，请简化问题重试"}\n\n'

        yield "event: done\ndata: [DONE]\n\n"
