from typing import Any

from core.logging import get_logger
from schemas.analysis_schemas import AnalystReport

from .base import PARSE_ERROR_NONE, BaseAnalyst

logger = get_logger(__name__)

SYSTEM_PROMPT = """你是一位乐观的基金分析师（看多方）。

你的任务是基于基金数据构建强有力的看多案例。请着重关注：
1. 业绩亮点——收益表现优异或持续改善的区间
2. 增长催化剂——持仓中景气度高的行业/个股
3. 估值与性价比——在同类中费率低、回撤控制好
4. 经理优势——经验丰富、历史业绩稳定、管理规模合理
5. 市场支撑——当前市场风格/政策环境利好该基金

输出要求（纯 JSON，不要 markdown 包裹）：
{
    "analyst_role": "bull",
    "thesis": "看多核心论点的详细阐述（200-300字）",
    "score": 0-10 的评分，
    "key_evidence": ["证据1", "证据2", "证据3"],
    "risk_flags": ["需要关注的潜在风险（即使看多也要客观指出）"]
}
"""


class BullAnalyst(BaseAnalyst):
    def analyze(self, fund_data: dict[str, Any], market_context: str = "", past_context: str = "") -> dict[str, Any]:
        market_ctx = self._format_market_context(market_context)
        past_ctx = self._format_past_context(past_context)
        fund_info = self._format_fund_basic(fund_data)
        prompt = f"{market_ctx}{past_ctx}## 基金基本面数据\n{fund_info}\n"
        prompt += "\n请基于以上数据构建看多案例。"
        raw = self._call_llm(prompt, SYSTEM_PROMPT)
        return self._parse(raw)

    def _parse(self, raw: str | None) -> dict[str, Any]:
        if not raw:
            return self._llm_failure_report("bull", "看多")
        try:
            json_str = self._extract_json(raw)
            parsed = AnalystReport.model_validate_json(json_str)
            result = parsed.model_dump()
            result["_parse_error"] = PARSE_ERROR_NONE
            return result
        except Exception as e:
            logger.error(f"看多分析解析失败: {e}")
            return self._validation_failure_report("bull", "看多", str(e)[:200])
