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
            yield 'event: done\ndata: {"status":"done"}\n\n'
            return

        client = OpenAI(api_key=self._api_key, base_url=self._api_base)

        system_prompt = """你是一位基金研究助手，你的用户是个人基金投资者。

## 你的角色

你的工作是为个人投资者查数据、理逻辑、讲市场。你不是投资顾问，不替用户做买卖决策，而是帮用户把"功课"做够的助手。

## 职责范围

- 你可以查基金数据、市场行情、板块资金、新闻快讯等
- 你需要把不同数据源的信息串起来，帮用户看清全局
- 用户问"XX基金怎么样"时，给出有依据的研究判断
- 用户问"XX是多少/查一下"时，直接回报数据即可
- 用户问"你怎么看/怎么样"时，给出你的分析判断，并明确指出哪些是客观数据、哪些是你的观点
- 用户问某个方向时，不要替用户扩展他没问到的方向

## 数据守则

1. 所有数据必须来自工具调用，不凭记忆编造
2. 基金代码、股票代码必须由用户提供，不猜测不编造
3. 工具返回空或报错时如实告知，不要用无关数据填补
4. 多个无依赖的工具可以同时调用以节省时间

## 回答要求

1. 用中文，简洁清晰，面对个人投资者，少用生僻术语
2. 回答直接针对用户的问题——用户问什么就答什么
3. 用户提到具体基金时，只分析该基金，不主动引入其他基金
4. 涉及风险时给出提示，但说清楚哪些是数据、哪些是你的判断"""

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

        yield 'event: done\ndata: {"status":"done"}\n\n'
