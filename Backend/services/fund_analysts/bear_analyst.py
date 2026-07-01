from typing import Any

from core.logging import get_logger
from schemas.analysis_schemas import AnalystReport

from .base import BaseAnalyst

logger = get_logger(__name__)

SYSTEM_PROMPT = """你是一位谨慎的基金分析师（看空方）。

你的任务是基于基金数据构建合理的看空案例。请着重关注：
1. 业绩风险——收益回落趋势、波动加剧、同类排名下滑
2. 持仓风险——集中度偏高、重仓行业/个股基本面走弱
3. 市场风险——行业政策收紧、宏观经济逆风、利率/汇率变化
4. 经理风险——管理规模过大、任职时间短、历史表现不稳定
5. 估值风险——当前估值处于历史高位或远超同类

输出要求（纯 JSON，不要 markdown 包裹）：
{
    "analyst_role": "bear",
    "thesis": "看空核心论点的详细阐述（200-300字）",
    "score": 0-10 的评分，
    "key_evidence": ["证据1", "证据2", "证据3"],
    "risk_flags": ["虽然看空但可关注的因素"]
}
"""


class BearAnalyst(BaseAnalyst):
    def analyze(
        self, fund_data: dict[str, Any], bull_thesis: str = "", market_context: str = "", past_context: str = ""
    ) -> dict[str, Any]:
        market_ctx = self._format_market_context(market_context)
        past_ctx = self._format_past_context(past_context)
        fund_info = self._format_fund_basic(fund_data)
        prompt = f"{market_ctx}{past_ctx}## 基金基本面数据\n{fund_info}\n"
        if bull_thesis:
            prompt += f"\n## 看多方的核心论点（请审慎评估并反驳）\n{bull_thesis}\n"
        prompt += "\n请基于以上数据构建看空案例。"
        raw = self._call_llm(prompt, SYSTEM_PROMPT)
        return self._parse(raw)

    def _parse(self, raw: str | None) -> dict[str, Any]:
        if not raw:
            return self._default_report()
        try:
            json_str = self._extract_json(raw)
            parsed = AnalystReport.model_validate_json(json_str)
            return parsed.model_dump()
        except Exception as e:
            logger.error(f"看空分析解析失败: {e}")
            return self._default_report()

    @staticmethod
    def _default_report() -> dict[str, Any]:
        return {
            "analyst_role": "bear",
            "thesis": "看空分析暂时无法生成",
            "score": 5,
            "key_evidence": ["数据不足，无法提供看空论据"],
            "risk_flags": [],
        }
