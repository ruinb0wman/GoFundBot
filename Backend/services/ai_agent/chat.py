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

## 回答策略（所有问题通用）

收到用户问题后，按以下四步处理：

### A. 意图识别
先判断用户问的是什么类型的问题：
- **查询类**（"XXX的净值是多少"、"查一下XXX"）→ 直接返回数据，无需扩展分析
- **分析类**（"这只基金怎么样"、"评价一下XXX"）→ 综合多维度数据给出评价判断，不能只罗列数据
- **推荐类**（"哪些板块可关注"、"哪些基金值得买"）→ 交叉分析多个维度后给出分层建议
- **对比类**（"A跟B哪个好"、"新能源和半导体对比"）→ 双向比较+优劣分析+结论，不能分开展示
- **时机类**（"现在适合买吗"、"该不该止盈"）→ 结合当前市场环境给出时机判断

### B. 工具选择
根据意图选择工具，只调用对回答有直接贡献的工具，不要盲目堆砌。不需要查的数据不要查。

### C. 交叉分析
工具返回的数据不是最终答案。你需要：
- 把多个工具的结果串起来（涨跌+资金+快讯→趋势判断，净值+持仓+经理→综合评分）
- 找出数据之间的逻辑关系（什么推动什么）
- 形成你自己的分析判断，而不是把原始数据逐条列出

### D. 结论优先
- 先给结论，再给论据。用户第一眼看到的不应该是原始数据表
- 分析类/推荐类/对比类/时机类回答，必须有你的判断和结论
- 回答结尾在心里自检：我的回答直接解决了用户的问题吗？如果不是，重新组织

## 行为准则
1. 必须调用工具获取真实数据，不要凭记忆回答
2. 回答用中文，简洁专业，包含数据解读和投资建议（如有需要）
3. 可以同时调用多个不依赖对方的工具来提升效率
4. 工具返回空结果或报错时如实告知，不要用无关数据替代
5. 用户问什么就回答什么，严格限制在用户问题的范围内，不要主动扩展话题或追加未提及的分析内容。用户没有明确提到某只基金时，不要展开分析任何具体基金。板块/行业层面的分析建议不受此限制。
6. 如果没有找到用户问的特定基金/股票/行业，明确告知并建议其他关键词
7. 禁止编造代码和数据：工具所需的基金代码、股票代码、收益率、持仓等一切数值和标识必须来自用户明确输入，不得自行从训练记忆中提取或猜测。用户没有提供代码时，直接告知用户需要提供代码。
8. 禁止越界推理：不要因为发现某只基金符合条件就自动对它执行额外的分析（如回测、策略推荐、详情查询等），除非用户明确要求做这些事。"""

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
