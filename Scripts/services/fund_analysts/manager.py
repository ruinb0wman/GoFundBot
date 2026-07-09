from typing import Any

from core.logging import get_logger
from schemas.analysis_schemas import FundAnalysisResult

from .base import BaseAnalyst

logger = get_logger(__name__)

SYSTEM_PROMPT = """你是一位资深研究经理。

你的团队中有两位分析师分别完成了看多和看空分析。
请评估双方论据，做出客观公正的最终裁决。

输出要求（纯 JSON，不要 markdown 包裹）：
{
    "rating": "Strong Buy"/"Buy"/"Hold"/"Underweight"/"Sell"，
    "sentiment_score": 0-100，
    "operation_advice": "强烈推荐"/"建议买入"/"持有观望"/"建议减仓"/"建议卖出"，
    "summary": "综合两位分析师观点后的总结（200-300字）",
    "dashboard": {
        "performance_eval": "优秀/良好/一般/较差",
        "manager_ability": "优秀/良好/一般/较差",
        "position_analysis": "集中/均衡/分散",
        "market_outlook": "乐观/中性/谨慎"
    },
    "highlights": ["亮点1", "亮点2", "亮点3"],
    "risk_factors": ["风险1", "风险2", "风险3"],
    "news_intel": ["相关市场信息1", "相关市场信息2"],
    "detailed_report": "详细的深度分析报告（Markdown格式，不少于500字）"
}
"""


class ResearchManager(BaseAnalyst):
    def synthesize(
        self,
        bull_report: dict[str, Any],
        bear_report: dict[str, Any],
        fund_data: dict[str, Any],
        market_context: str = "",
        past_context: str = "",
    ) -> dict[str, Any]:
        market_ctx = self._format_market_context(market_context)
        past_ctx = self._format_past_context(past_context)
        fund_info = self._format_fund_basic(fund_data)

        prompt = f"""{market_ctx}{past_ctx}## 基金基本面数据\n{fund_info}\n

## 看多方分析
评分：{bull_report.get("score", "?")}/10
核心论点：{bull_report.get("thesis", "无")}
关键证据：
{self._format_list(bull_report.get("key_evidence", []))}

## 看空方分析
评分：{bear_report.get("score", "?")}/10
核心论点：{bear_report.get("thesis", "无")}
关键证据：
{self._format_list(bear_report.get("key_evidence", []))}

请综合以上信息，做出最终裁决。"""

        raw = self._call_llm(prompt, SYSTEM_PROMPT, temperature=0.2)
        return self._parse(raw)

    @staticmethod
    def _format_list(items: list[str]) -> str:
        return "\n".join(f"- {item}" for item in items) if items else "- 无"

    def _parse(self, raw: str | None) -> dict[str, Any]:
        if not raw:
            return self._default_result()
        try:
            json_str = self._extract_json(raw)
            parsed = FundAnalysisResult.model_validate_json(json_str)
            return parsed.model_dump()
        except Exception as e:
            logger.error(f"研究经理裁决解析失败: {e}")
            return self._default_result()

    @staticmethod
    def _default_result() -> dict[str, Any]:
        return {
            "rating": "Hold",
            "sentiment_score": 50,
            "operation_advice": "持有观望",
            "summary": "辩论分析未能生成综合结果，建议持有观望",
            "dashboard": {
                "performance_eval": "一般",
                "manager_ability": "一般",
                "position_analysis": "均衡",
                "market_outlook": "中性",
            },
            "highlights": ["请重新分析"],
            "risk_factors": ["数据不足导致分析不完整"],
            "news_intel": [],
            "detailed_report": "## 分析未完成\n因数据处理异常，本次分析未能完成。请稍后重试。",
        }
