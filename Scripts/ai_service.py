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
from schemas.analysis_schemas import FundAnalysisResult
from services.fund_analysts.orchestrator import AnalystOrchestrator
from services.memory_log import AnalysisMemoryLog

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
        self._model = os.getenv("LLM_MODEL", "opencode/deepseek-v4-pro")

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
                model=self._model, messages=messages, temperature=0.3, max_tokens=8192
            )

            content = response.choices[0].message.content
            finish_reason = response.choices[0].finish_reason
            logger.info(
                f"LLM 响应成功 (model={self._model}, length={len(content) if content else 0}, finish_reason={finish_reason})"
            )
            if not content:
                logger.error(f"LLM 返回空内容 (finish_reason={finish_reason}, model={self._model})")
                return None
            return content

        except ImportError:
            logger.error(f"openai 库未安装，无法调用 LLM (base={self._api_base}, model={self._model})")
            return None
        except Exception as e:
            logger.error(f"调用 LLM 失败 (base={self._api_base}, model={self._model}): {type(e).__name__}: {e}")
            return None

    @staticmethod
    def _extract_json_from_llm_response(raw: str) -> str:
        """从 LLM 回复中提取 JSON 字符串，按优先级尝试多种策略。"""
        stripped = raw.strip()

        # 策略 1: 直接解析（LLM 已输出纯 JSON）
        if stripped.startswith("{"):
            try:
                json.loads(stripped)
                return stripped
            except json.JSONDecodeError:
                pass

        # 策略 2: 贪婪匹配最后的 ```json 代码块（容错 detailed_report 内嵌代码块）
        blocks = list(re.finditer(r"```json\s*([\s\S]*?)\s*```", raw))
        if blocks:
            return blocks[-1].group(1)

        # 策略 3: 用 JSONDecoder.raw_decode 在每一个 { 位置尝试解析
        decoder = json.JSONDecoder()
        pos = 0
        while True:
            start = stripped.find("{", pos)
            if start == -1:
                break
            try:
                obj, end = decoder.raw_decode(stripped, start)
                return stripped[start:end]
            except json.JSONDecodeError:
                pos = start + 1

        return raw

    def _get_memory_log(self) -> AnalysisMemoryLog:
        return AnalysisMemoryLog(api_key=self._api_key, api_base=self._api_base, model=self._model)

    def _fetch_news_context(self, max_items: int = 8) -> str:
        """预获取实时快讯（来源：东方财富/财联社/百度），注入 prompt 防止 LLM 幻觉"""
        try:
            from services.data_service_client import get_data_service_client

            client = get_data_service_client()
            payload = client.get_flash_news(count=max_items)
            data = payload.get("data", {}) if isinstance(payload, dict) else {}
            items = data.get("items", []) if isinstance(data, dict) else []
            if not items:
                return ""

            lines = []
            for item in items[:max_items]:
                title = item.get("title", "")
                pub_time = item.get("publishedAt", "")
                if title:
                    prefix = f"[{pub_time}] " if pub_time else ""
                    lines.append(f"- {prefix}{title}")
            return "\n".join(lines)
        except Exception as e:
            logger.warning(f"获取快讯失败（非关键，继续分析）: {e}")
            return ""

    def _fetch_sector_context(self, max_items: int = 5) -> str:
        """预获取热点板块数据（来源：同花顺行业板块）"""
        try:
            from market_data_service import MarketDataService

            sectors = MarketDataService().get_hot_sectors()
            if not sectors or not isinstance(sectors, list):
                return ""

            lines = []
            for sec in sectors[:max_items]:
                name = sec.get("name", "")
                change = sec.get("changePercent", sec.get("change", ""))
                if name:
                    if isinstance(change, (int, float)):
                        change_str = f"{change:+.2f}%"
                    else:
                        change_str = str(change) if change else ""
                    lines.append(f"- {name}：{change_str}")
            return "\n".join(lines)
        except Exception as e:
            logger.warning(f"获取板块数据失败（非关键，继续分析）: {e}")
            return ""

    def analyze_fund(self, fund_data: dict[str, Any]) -> dict[str, Any]:
        """
        使用多分析师辩论 + 记忆反思模式分析基金

        Args:
            fund_data: 基金数据，包含 basic_info, performance, portfolio 等

        Returns:
            分析结果字典
        """
        if not self.is_available():
            return {"error": "AI 服务未配置，请检查 LLM_API_KEY 环境变量"}

        basic_info = fund_data.get("basic_info", {})
        fund_code = basic_info.get("fund_code", "")

        try:
            memory = self._get_memory_log()
            if fund_code:
                memory.resolve_pending(fund_code)
            past_ctx = memory.get_past_context(fund_code) if fund_code else ""

            news_ctx = self._fetch_news_context()
            sector_ctx = self._fetch_sector_context()
            market_ctx = ""
            if news_ctx:
                market_ctx += "### 实时快讯\n" + news_ctx + "\n"
            if sector_ctx:
                market_ctx += "\n### 热点板块\n" + sector_ctx

            orchestrator = AnalystOrchestrator(
                api_key=self._api_key,
                api_base=self._api_base,
                model=self._model,
            )
            result = orchestrator.analyze(fund_data, market_context=market_ctx, past_context=past_ctx)

            if fund_code:
                memory.store_analysis(fund_code, result)

            return result

        except Exception as e:
            logger.error(f"基金分析出错: {type(e).__name__}: {e}", exc_info=True)
            return {"error": f"分析过程出错: {type(e).__name__}: {e}"}

    def _build_fund_analysis_prompt(self, fund_data: dict[str, Any], market_context: str = "") -> str:
        """构建基金分析提示"""
        prompt = ""
        if market_context:
            prompt += f"""## 今日市场动态（系统自动采集，请基于真实数据评估）

{market_context}

---

"""
        basic_info = fund_data.get("basic_info", {})
        performance = fund_data.get("performance", {})
        portfolio = fund_data.get("portfolio", {})
        fund_managers = fund_data.get("fund_managers", [])
        risk_metrics = fund_data.get("risk_metrics", {})
        realtime = fund_data.get("realtime_estimate", {})

        prompt += f"""请分析以下基金：

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
        """解析基金分析结果，使用 Pydantic 验证"""
        try:
            json_str = self._extract_json_from_llm_response(result)
            parsed = FundAnalysisResult.model_validate_json(json_str)
            return parsed.model_dump()
        except Exception as e:
            logger.error(f"Pydantic 解析失败: {e}，原始响应前 500 字符: {result[:500]}")
            return {
                "rating": "Hold",
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
请严格按照以下 JSON 格式输出，直接返回纯 JSON，**不要**使用任何 markdown 代码块包裹（不要使用 ```json ```）：
{
    "market_sentiment": "乐观/中性/谨慎/悲观",
    "sentiment_score": 58,
    "summary": "一段话总结今日市场走势和关键信息（100-150字）",
    "key_points": ["要点1", "要点2", "要点3"],
    "hot_sectors": ["热门板块1", "热门板块2"],
    "risk_alerts": ["风险提示1", "风险提示2"],
    "operation_suggestion": "短期操作建议（50字内）"
}
"""

            result = self._call_llm_simple(prompt, system_prompt)

            if not result:
                logger.error(f"市场分析 AI 调用返回空 (base={self._api_base}, model={self._model})")
                return {
                    "error": f"市场分析 AI 调用失败 (base={self._api_base}, model={self._model})，请检查 API 服务配置"
                }

            return self._parse_market_summary_result(result)

        except Exception as e:
            logger.error(f"市场分析出错: {type(e).__name__}: {e}", exc_info=True)
            return {"error": f"市场分析出错: {type(e).__name__}: {e}"}

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
            json_str = self._extract_json_from_llm_response(result)
            return json.loads(json_str)

        except json.JSONDecodeError as e:
            logger.error(f"市场分析 JSON 解析失败: {e}，原始响应前 500 字符: {result[:500]}")
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
        """Streaming debate version of analyze_fund.

        Yields SSE-formatted stage events for bull/bear/manager phases,
        then the final parsed result.
        """
        if not self.is_available():
            yield f"data: {json.dumps({'error': 'AI 服务未配置'})}\n\n"
            yield "event: done\ndata: [DONE]\n\n"
            return

        try:
            basic_info = fund_data.get("basic_info", {})
            fund_code = basic_info.get("fund_code", "")

            memory = self._get_memory_log()
            if fund_code:
                memory.resolve_pending(fund_code)
            past_ctx = memory.get_past_context(fund_code) if fund_code else ""

            news_ctx = self._fetch_news_context()
            sector_ctx = self._fetch_sector_context()
            market_ctx = ""
            if news_ctx:
                market_ctx += "### 实时快讯\n" + news_ctx + "\n"
            if sector_ctx:
                market_ctx += "\n### 热点板块\n" + sector_ctx

            yield f"event: stage\ndata: {json.dumps({'stage': 'orchestrating', 'message': '四位专业分析师正在并行评估基金...'})}\n\n"
            orchestrator = AnalystOrchestrator(
                api_key=self._api_key,
                api_base=self._api_base,
                model=self._model,
            )
            result = orchestrator.analyze(fund_data, market_context=market_ctx, past_context=past_ctx)

            if fund_code:
                memory.store_analysis(fund_code, result)
            yield f"event: result\ndata: {json.dumps(result, ensure_ascii=False)}\n\n"
            yield "event: done\ndata: [DONE]\n\n"

        except Exception as e:
            logger.error(
                f"Streaming AI analysis failed (base={self._api_base}, model={self._model}): {type(e).__name__}: {e}"
            )
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "event: done\ndata: [DONE]\n\n"


# 单例实例
_ai_service_instance: AIService | None = None


def get_ai_service() -> AIService:
    """获取 AI 服务单例"""
    global _ai_service_instance
    if _ai_service_instance is None:
        _ai_service_instance = AIService()
    return _ai_service_instance
