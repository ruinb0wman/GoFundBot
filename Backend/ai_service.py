"""
AI 分析服务模块

该模块提供基于 LangChain 的 AI 分析功能，包括：
- 基金深度分析
- 市场趋势分析
- 板块机会分析
- 风险提示分析

支持的 LLM 提供商：
- 硅基流动（SiliconFlow）- 推荐
- DeepSeek
- 通义千问
- 智谱AI
- OpenAI 兼容 API
"""

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from core.logging import get_logger

logger = get_logger(__name__)

# 加载环境变量
env_path = Path(__file__).parent / ".env"
if not env_path.exists():
    env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


class AIService:
    """AI 分析服务类"""

    def __init__(self):
        """初始化 AI 服务"""
        self.llm = None
        self._api_key = os.getenv("LLM_API_KEY", "")
        self._api_base = os.getenv("LLM_API_BASE", "https://api.siliconflow.cn/v1")
        self._model = os.getenv("LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct")

    def is_available(self) -> bool:
        """检查 AI 服务是否可用"""
        return bool(self._api_key)

    def _init_llm(self, fast_mode: bool = False):
        """
        初始化 LangChain LLM

        Args:
            fast_mode: 是否为快速模式（调整超时参数）
        """
        try:
            from langchain_openai import ChatOpenAI

            if not self._api_key:
                logger.info("未配置 LLM_API_KEY 环境变量")
                return None

            # 根据模式调整参数
            temperature = 0.3 if fast_mode else 0.2
            timeout = 60 if fast_mode else 120

            llm = ChatOpenAI(
                model=self._model,
                openai_api_key=self._api_key,
                openai_api_base=self._api_base,
                temperature=temperature,
                request_timeout=timeout,
            )

            return llm

        except ImportError:
            logger.info("请安装 langchain-openai: pip install langchain-openai")
            return None
        except Exception as e:
            logger.error(f"初始化 LLM 失败: {e}")
            return None

    def _call_llm_simple(self, prompt: str, system_prompt: str = "") -> str | None:
        """
        简单调用 LLM（不使用 LangChain，直接使用 OpenAI SDK）

        Args:
            prompt: 用户提示
            system_prompt: 系统提示

        Returns:
            LLM 返回的文本
        """
        try:
            from openai import OpenAI

            client = OpenAI(api_key=self._api_key, base_url=self._api_base)

            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})

            response = client.chat.completions.create(
                model=self._model, messages=messages, temperature=0.3, max_tokens=4096
            )

            return response.choices[0].message.content

        except ImportError:
            logger.info("请安装 openai: pip install openai")
            return None
        except Exception as e:
            logger.error(f"调用 LLM 失败: {e}")
            return None

    def analyze_fund(self, fund_data: dict[str, Any]) -> dict[str, Any]:
        """
        使用 AI 分析基金

        Args:
            fund_data: 基金数据，包含 basic_info, performance, portfolio 等

        Returns:
            分析结果字典
        """
        if not self.is_available():
            return {"error": "AI 服务未配置，请检查 LLM_API_KEY 环境变量"}

        try:
            # 构建分析提示
            prompt = self._build_fund_analysis_prompt(fund_data)

            system_prompt = """你是一位资深基金分析师，擅长基金投资分析和风险评估。
请基于提供的基金数据，给出专业、客观、全面的分析报告。

**重要提示**：
1. 请务必根据提供的基金数据（业绩、风险、持仓等）进行真实评估，**绝对不要**直接抄袭示例中的数值。
2. sentiment_score 必须根据基金的实际表现计算（0-100），反映其投资价值。
3. operation_advice 必须基于你的分析结论给出。

**输出要求**：
请严格按照以下 JSON 格式输出，不要添加任何其他内容：
```json
{
    "sentiment_score": 0-100 分，反映基金的投资价值，0 表示非常差，100 表示非常好，50 表示一般，
    "operation_advice": "强烈推荐"/"建议买入"/"持有观望"/"建议减仓"/"建议卖出"，
    "summary": "详细的分析总结，包含业绩、风险、经理等维度的综合评价（200-300字）",
    "dashboard": {
        "performance_eval": "优秀/良好/一般/较差",
        "manager_ability": "优秀/良好/一般/较差",
        "position_analysis": "集中/均衡/分散",
        "market_outlook": "乐观/中性/谨慎"
    },
    "highlights": ["亮点1", "亮点2", "亮点3"],
    "risk_factors": ["风险1", "风险2", "风险3"],
    "news_intel": ["相关市场信息1", "相关市场信息2"],
    "detailed_report": "Markdown格式的详细深度分析报告，包含：1. 业绩归因分析；2. 风险收益特征；3. 经理管理风格；4. 后市策略建议。请使用二级和三级标题组织内容。"
}
```

**评分说明**：
- sentiment_score: 0-100 分，越高表示越值得投资
- operation_advice: 可选值为 "强烈推荐"、"建议买入"、"持有观望"、"建议减仓"、"建议卖出"
- detailed_report: 请提供不少于500字的深度分析，使用 Markdown 格式
"""

            # 调用 LLM
            result = self._call_llm_simple(prompt, system_prompt)

            if not result:
                return {"error": "AI 分析失败，请稍后重试"}

            # 解析结果
            return self._parse_fund_analysis_result(result)

        except Exception as e:
            logger.warning(f"基金分析出错: {e}")
            return {"error": f"分析过程出错: {str(e)}"}

    def _build_fund_analysis_prompt(self, fund_data: dict[str, Any]) -> str:
        """构建基金分析提示"""
        basic_info = fund_data.get("basic_info", {})
        performance = fund_data.get("performance", {})
        portfolio = fund_data.get("portfolio", {})
        fund_managers = fund_data.get("fund_managers", [])
        risk_metrics = fund_data.get("risk_metrics", {})
        realtime = fund_data.get("realtime_estimate", {})

        prompt = f"""请分析以下基金：

## 基本信息
- 基金名称：{basic_info.get("fund_name", "未知")}
- 基金代码：{basic_info.get("fund_code", "未知")}
- 基金类型：{basic_info.get("fund_type", "未知")}
- 申购费率：{basic_info.get("current_rate", "未知")}%

## 业绩表现
- 近1月收益：{performance.get("1_month_return", "未知")}%
- 近3月收益：{performance.get("3_month_return", "未知")}%
- 近6月收益：{performance.get("6_month_return", "未知")}%
- 近1年收益：{performance.get("1_year_return", "未知")}%

## 实时估值
- 估算净值：{realtime.get("estimate_value", "未知")}
- 估算涨跌：{realtime.get("estimate_change", "未知")}%
- 估值时间：{realtime.get("estimate_time", "未知")}
"""

        # 添加业绩走势数据
        total_return_trend = fund_data.get("total_return_trend", [])
        if total_return_trend:
            prompt += "\n## 业绩走势（累计收益率，近3年月度采样）\n"
            for series in total_return_trend:
                name = series.get("name", "未知")
                data = series.get("data", [])
                if not data:
                    continue

                prompt += f"### {name}\n"
                sorted_data = sorted(data, key=lambda x: x.get("date", ""))
                sampled_points = []
                seen_months = set()

                for point in reversed(sorted_data):
                    date_str = point.get("date", "")
                    if not date_str:
                        continue
                    month = date_str[:7]
                    if month not in seen_months:
                        sampled_points.insert(0, point)
                        seen_months.add(month)
                        if len(sampled_points) >= 36:
                            break

                for p in sampled_points:
                    prompt += f"- {p.get('date')}: {p.get('value')}%\n"

        # 添加风险指标
        if risk_metrics:
            prompt += f"""
## 风险指标
- 夏普比率：{risk_metrics.get("sharpe_ratio", "未知")}
- 最大回撤：{risk_metrics.get("max_drawdown", "未知")}%
- 年化波动率：{risk_metrics.get("volatility", "未知")}%
"""

        # 添加基金经理信息
        if fund_managers:
            manager = fund_managers[0]
            prompt += f"""
## 基金经理
- 姓名：{manager.get("name", "未知")}
- 从业年限：{manager.get("work_experience", "未知")}
- 管理规模：{manager.get("managed_fund_size", "未知")}
"""

        # 添加持仓信息
        stock_codes = portfolio.get("stock_codes", [])
        if stock_codes:
            prompt += "\n## 重仓股票（前10）\n"
            for i, stock in enumerate(stock_codes[:10], 1):
                if isinstance(stock, dict):
                    prompt += f"{i}. {stock.get('name', '未知')} ({stock.get('code', '')})\n"
                else:
                    prompt += f"{i}. {stock}\n"

        prompt += "\n请基于以上数据，给出全面的投资分析。"

        return prompt

    def _parse_fund_analysis_result(self, result: str) -> dict[str, Any]:
        """解析基金分析结果"""
        try:
            # 尝试提取 JSON
            json_match = re.search(r"```json\s*([\s\S]*?)\s*```", result)
            if json_match:
                json_str = json_match.group(1)
            else:
                # 尝试直接解析
                json_str = result.strip()
                if json_str.startswith("{"):
                    pass
                else:
                    # 尝试找到 JSON 开始位置
                    start = json_str.find("{")
                    end = json_str.rfind("}")
                    if start != -1 and end != -1:
                        json_str = json_str[start : end + 1]

            data = json.loads(json_str)

            # 验证必要字段
            required_fields = [
                "sentiment_score",
                "operation_advice",
                "summary",
                "dashboard",
                "highlights",
                "risk_factors",
                "detailed_report",
            ]
            for field in required_fields:
                if field not in data:
                    data[field] = self._get_default_value(field)

            return data

        except json.JSONDecodeError as e:
            logger.error(f"JSON 解析失败: {e}")
            # 返回默认结构
            return {
                "sentiment_score": 50,
                "operation_advice": "持有观望",
                "summary": result[:200] if result else "分析结果解析失败",
                "dashboard": {
                    "performance_eval": "一般",
                    "manager_ability": "一般",
                    "position_analysis": "均衡",
                    "market_outlook": "中性",
                },
                "highlights": ["数据分析中"],
                "risk_factors": ["请谨慎投资"],
                "news_intel": [],
                "detailed_report": result if result else "暂无详细分析",
            }

    def _get_default_value(self, field: str) -> Any:
        """获取字段默认值"""
        defaults = {
            "sentiment_score": 50,
            "operation_advice": "持有观望",
            "summary": "暂无分析",
            "dashboard": {
                "performance_eval": "一般",
                "manager_ability": "一般",
                "position_analysis": "均衡",
                "market_outlook": "中性",
            },
            "highlights": [],
            "risk_factors": [],
            "news_intel": [],
            "detailed_report": "暂无详细分析报告",
        }
        return defaults.get(field)

    def generate_market_summary(self, market_data: dict[str, Any]) -> dict[str, Any]:
        """
        生成每日市场行情摘要

        Args:
            market_data: 市场数据，包含指数、板块、快讯等

        Returns:
            市场分析摘要
        """
        if not self.is_available():
            return {"error": "AI 服务未配置，请检查 LLM_API_KEY 环境变量"}

        try:
            prompt = self._build_market_summary_prompt(market_data)

            system_prompt = """你是一位资深金融分析师，擅长宏观市场分析和趋势判断。
请基于提供的市场数据，给出专业、简洁的市场分析摘要。

**重要提示**：
请务必根据提供的市场数据（指数、板块、资讯等）进行真实评估，**绝对不要**直接抄袭示例中的数值。sentiment_score 必须根据市场实际表现计算（0-100）。

**输出要求**：
请严格按照以下 JSON 格式输出：
```json
{
    "market_sentiment": "乐观/中性/谨慎/悲观",
    "sentiment_score": 58,
    "summary": "一段话总结今日市场走势和关键信息（100-150字）",
    "key_points": ["要点1", "要点2", "要点3"],
    "hot_sectors": ["热门板块1", "热门板块2"],
    "risk_alerts": ["风险提示1", "风险提示2"],
    "operation_suggestion": "短期操作建议（50字内）"
}
```
"""

            result = self._call_llm_simple(prompt, system_prompt)

            if not result:
                return {"error": "市场分析失败，请稍后重试"}

            return self._parse_market_summary_result(result)

        except Exception as e:
            logger.warning(f"市场分析出错: {e}")
            return {"error": f"分析过程出错: {str(e)}"}

    def _build_market_summary_prompt(self, market_data: dict[str, Any]) -> str:
        """构建市场分析提示"""
        prompt = f"请分析以下市场数据（{datetime.now().strftime('%Y-%m-%d %H:%M')}）：\n\n"

        # 添加市场指数
        indices = market_data.get("indices", [])
        if indices:
            prompt += "## 主要指数\n"
            for idx in indices[:10]:
                if isinstance(idx, dict):
                    prompt += f"- {idx.get('name', '')}: {idx.get('price', '')} ({idx.get('change', '')})\n"
                elif isinstance(idx, (list, tuple)):
                    prompt += f"- {idx[0]}: {idx[1]} ({idx[2] if len(idx) > 2 else ''})\n"

        # 添加板块数据
        sectors = market_data.get("sectors", [])
        if sectors:
            prompt += "\n## 领涨板块\n"
            for sec in sectors[:5]:
                if isinstance(sec, dict):
                    prompt += f"- {sec.get('name', '')}: {sec.get('change', '')}\n"
                elif isinstance(sec, (list, tuple)):
                    prompt += f"- {sec[0]}: {sec[1]}\n"

        # 添加快讯
        news = market_data.get("news", [])
        if news:
            prompt += "\n## 重要快讯\n"
            for n in news[:5]:
                if isinstance(n, dict):
                    prompt += f"- {n.get('title', n.get('content', ''))}\n"
                else:
                    prompt += f"- {n}\n"

        prompt += "\n请基于以上数据，给出市场分析摘要。"

        return prompt

    def _parse_market_summary_result(self, result: str) -> dict[str, Any]:
        """解析市场分析结果"""
        try:
            json_match = re.search(r"```json\s*([\s\S]*?)\s*```", result)
            if json_match:
                json_str = json_match.group(1)
            else:
                json_str = result.strip()
                start = json_str.find("{")
                end = json_str.rfind("}")
                if start != -1 and end != -1:
                    json_str = json_str[start : end + 1]

            return json.loads(json_str)

        except json.JSONDecodeError:
            return {
                "market_sentiment": "中性",
                "sentiment_score": 50,
                "summary": result[:300] if result else "分析结果解析失败",
                "key_points": [],
                "hot_sectors": [],
                "risk_alerts": [],
                "operation_suggestion": "请关注市场变化",
            }

    def analyze_fund_stream(self, fund_data: dict[str, Any]):
        """Streaming version of analyze_fund.

        Yields SSE-formatted strings for each chunk of LLM output.
        Final chunk contains the full parsed JSON result.
        """
        if not self.is_available():
            yield f"data: {json.dumps({'error': 'AI 服务未配置'})}\n\n"
            yield "event: done\ndata: [DONE]\n\n"
            return

        try:
            prompt = self._build_fund_analysis_prompt(fund_data)
            system_prompt = self._get_fund_analysis_system_prompt()

            from openai import OpenAI

            client = OpenAI(api_key=self._api_key, base_url=self._api_base)

            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})

            stream = client.chat.completions.create(
                model=self._model,
                messages=messages,
                temperature=0.2,
                max_tokens=8192,
                stream=True,
            )

            full_content = ""
            for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                content = delta.content if delta else ""
                if content:
                    full_content += content
                    yield f"data: {json.dumps({'token': content, 'full': full_content})}\n\n"

            # Parse and send final result
            result = self._parse_fund_analysis_result(full_content)
            yield f"event: result\ndata: {json.dumps(result)}\n\n"
            yield "event: done\ndata: [DONE]\n\n"

        except Exception as e:
            logger.error(f"Streaming AI analysis failed: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "event: done\ndata: [DONE]\n\n"

    def _get_fund_analysis_system_prompt(self) -> str:
        return """你是一位资深基金分析师，擅长基金投资分析和风险评估。
请基于提供的基金数据，给出专业、客观、全面的分析报告。

**重要提示**：
1. 请务必根据提供的基金数据进行真实评估。
2. sentiment_score 必须根据基金的实际表现计算（0-100）。
3. operation_advice 必须基于你的分析结论给出。

**输出要求**：
请严格按照以下 JSON 格式输出：
```json
{
    "sentiment_score": 0-100 分，
    "operation_advice": "强烈推荐"/"建议买入"/"持有观望"/"建议减仓"/"建议卖出"，
    "summary": "详细的分析总结（200-300字）",
    "dashboard": {
        "performance_eval": "优秀/良好/一般/较差",
        "manager_ability": "优秀/良好/一般/较差",
        "position_analysis": "集中/均衡/分散",
        "market_outlook": "乐观/中性/谨慎"
    },
    "highlights": ["亮点1", "亮点2", "亮点3"],
    "risk_factors": ["风险1", "风险2", "风险3"],
    "news_intel": ["相关市场信息1", "相关市场信息2"],
    "detailed_report": "Markdown格式的详细深度分析报告"
}
```

**评分说明**：
- sentiment_score: 0-100 分，越高表示越值得投资
- detailed_report: 请提供不少于500字的深度分析，使用 Markdown 格式
"""


# 单例实例
_ai_service_instance: AIService | None = None


def get_ai_service() -> AIService:
    """获取 AI 服务单例"""
    global _ai_service_instance
    if _ai_service_instance is None:
        _ai_service_instance = AIService()
    return _ai_service_instance
