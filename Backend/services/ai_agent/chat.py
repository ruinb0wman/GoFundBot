"""ReAct chat loop for AIAgent — mixed in via inheritance."""

import json
from collections.abc import Generator
from typing import Any

from core.logging import get_logger

from .skills import SKILL_MAP

logger = get_logger(__name__)


class ChatMixin:
    """Mixin providing the chat/ReAct loop method.

    Mixed into AIAgent so it has access to self._api_key, self._api_base,
    self._model, self.is_available(), self._get_tools_for_skill(),
    self._execute_tool(), self.MAX_TOOL_ITERATIONS, and self.TOOL_TIMEOUT.
    """

    @staticmethod
    def _trim_messages(messages: list[dict[str, Any]], max_tokens: int = 0) -> None:
        from .token_utils import estimate_messages_tokens, get_max_context_tokens

        if max_tokens == 0:
            max_tokens = get_max_context_tokens()
        dropped = 0
        while estimate_messages_tokens(messages) > max_tokens and len(messages) > 1:
            skip = 1 if messages and messages[0].get("role") == "system" else 0
            if len(messages) <= skip + 1:
                break
            messages.pop(skip)
            dropped += 1
        if dropped:
            logger.warning(
                "Context window trimming: dropped %d oldest messages (%d tokens remaining)",
                dropped,
                estimate_messages_tokens(messages),
            )

    def chat(self, messages: list[dict[str, Any]], skill_name: str | None = None) -> Generator[str, None, None]:
        from openai import OpenAI

        if not self.is_available():
            yield 'event: error\ndata: {"message":"AI 服务未配置，请检查 LLM_API_KEY 环境变量"}\n\n'
            yield 'event: done\ndata: {"status":"done"}\n\n'
            return

        client = OpenAI(api_key=self._api_key, base_url=self._api_base)

        user_message = messages[-1].get("content", "") if messages else ""
        skill_name, system_prompt = self.route_skill(user_message, skill_name)
        skill = SKILL_MAP.get(skill_name)
        tools = self._get_tools_for_skill(skill_name)

        yield f"event: skill_selected\ndata: {json.dumps({'name': skill_name, 'description': skill.description if skill else ''}, ensure_ascii=False)}\n\n"

        openai_messages = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            openai_messages.append({"role": role, "content": content})

        self._trim_messages(openai_messages)

        iter_count = 0
        while iter_count < self.MAX_TOOL_ITERATIONS:
            iter_count += 1

            try:
                response = client.chat.completions.create(
                    model=self._model,
                    messages=openai_messages,
                    tools=tools,
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
                    if len(result_str) > 4000:
                        result_str = result_str[:4000] + "... (truncated)"
                    openai_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": result_str,
                        }
                    )

                self._trim_messages(openai_messages)
            else:
                content = message.content or ""
                full_content = ""
                self._trim_messages(openai_messages)
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
