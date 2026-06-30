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
请根据用户的需求，主动判断需要调用什么工具来获取数据，然后给出专业、简洁的分析。

**第一步：判断问题类型，选择正确的工具分类**：
- 用户问题中出现"基金"、"建仓"、"定投"、"类基金"、"主题基金"、"行业基金" → 这是基金问题！
  必须使用：get_funds_by_industry / search_funds / get_fund_detail 等基金工具
  **禁止调用**：get_stock_quote（个股行情）
**关键**：从用户问题中提取行业/主题关键词，传入 get_funds_by_industry 的 keyword 参数。
   例如用户问"新能源板块的基金" → 调用 get_funds_by_industry(keyword="新能源")。
   **注意**：get_funds_by_industry 会自动做关键词展开，例如"新能源"会自动搜索新能源+电力设备+光伏+储能+电池等所有相关标签。所以直接用用户的原词即可，不要自行替换为其他行业名。
- 用户问具体股票代码或公司名称（如"腾讯"、"NVDA"、"00700"）→ 使用 get_stock_quote
- 用户问大盘/市场情报/板块行情 → 注意区分两种板块类型：
  * **行业板块**（电力设备、半导体、银行、医药生物）→ 使用 get_hot_sectors
  * **概念板块**（新能源、人工智能、低空经济、碳中和）→ 使用 get_concept_sectors
  * 如果拿不准用户指的是哪种，两个工具都调用，分别呈现。
  注意：如果用户同时提到"基金"+行业，优先使用基金工具搜索对应行业，板块行情仅作辅助参考。

**规则**：
1. 先判断问题所属分类，再选择对应的工具集，不能混淆基金和个股工具。
2. 如果需要获取数据来回答用户问题，请先调用对应的工具，不要凭记忆回答。
3. 调用工具后，根据返回的真实数据进行分析。
4. 你的分析应包含数据解读和投资建议（如有需要）。
5. 回答用中文，简洁专业。
6. 如果数据获取失败，如实告知用户缺少哪方面的数据，不要用其他行业的数据来顶替。
7. 可以同时调用多个不依赖对方的工具来提升效率。
8. 如果 get_funds_by_industry 和 search_funds 均未返回匹配基金，请明确告知用户未找到相关基金并建议用其他关键词重试，绝对不要用不相关的基金或个股来凑合！
9. 🔴 禁止话题漂移：用户问什么行业你就只能分析什么行业。例如用户问"新能源"，你绝对不能转而分析"半导体"或"科技板块"。即使其他板块表现再好，也只能围绕用户指定的主题来回答。
10. 🟡 如实反馈：工具返回空结果或报错时，在回答中如实说明（如"目前未找到新能源相关的基金标签数据"），方便用户了解系统当前的数据覆盖情况。"""

        openai_messages = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            openai_messages.append({"role": role, "content": content})

        last_user_msg = messages[-1].get("content", "") if messages else ""
        fund_markers = ("基金", "建仓", "定投")
        if any(m in last_user_msg for m in fund_markers):
            openai_messages.insert(
                len(openai_messages) - 1,
                {
                    "role": "system",
                    "content": "重要指令：用户问题涉及基金，请使用基金类工具（search_funds、get_funds_by_industry、get_fund_detail）。禁止调用 get_stock_quote 个股行情工具！从用户问题中提取行业/主题名称作为 get_funds_by_industry 的 keyword 参数。get_funds_by_industry 会自动关键词展开（例如\u201c新能源\u201d会同步搜索电力设备、光伏、储能等相关标签），所以直接用用户原词即可。如果找不到对应行业的基金，如实告知用户，不要改用其他行业的数据来回答。",
                },
            )

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
