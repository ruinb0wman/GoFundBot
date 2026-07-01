from typing import Any

from core.logging import get_logger
from schemas.analysis_schemas import AnalystReport

from .base import BaseAnalyst

logger = get_logger(__name__)

SYSTEM_PROMPT = """你是一位基金业绩分析师。

你的任务是基于基金的收益和风险数据给出客观分析。请着重关注：
1. 收益表现——各区间收益率（近1月/3月/6月/1年）的绝对和相对表现
2. 风险调整收益——夏普比率、卡玛比率等风险调整后的回报
3. 回撤控制——最大回撤幅度和恢复能力
4. 波动率——年化波动率水平及稳定性
5. 同类排名——在同类基金中的排名百分位变化趋势

输出要求（纯 JSON，不要 markdown 包裹）：
{
    "analyst_role": "performance",
    "thesis": "业绩分析结论（200-300字）",
    "score": 0-10 的评分，
    "key_evidence": ["证据1", "证据2", "证据3"],
    "risk_flags": ["需要关注的风险因素"]
}
"""


class PerformanceAnalyst(BaseAnalyst):
    def analyze(self, fund_data: dict[str, Any], market_context: str = "", past_context: str = "") -> dict[str, Any]:
        market_ctx = self._format_market_context(market_context)
        past_ctx = self._format_past_context(past_context)
        fund_info = self._format_fund_basic(fund_data)

        perf = fund_data.get("performance", {})
        risk = fund_data.get("risk_metrics", {})
        extra = ""
        if perf:
            lines = []
            for k, v in sorted(perf.items()):
                if v is not None:
                    lines.append(f"- {k}：{v}")
            if lines:
                extra += "## 详细业绩指标\n" + "\n".join(lines) + "\n"
        if risk:
            lines = []
            for k, v in sorted(risk.items()):
                if v is not None:
                    lines.append(f"- {k}：{v}")
            if lines:
                extra += "## 风险指标\n" + "\n".join(lines) + "\n"

        prompt = f"{market_ctx}{past_ctx}## 基金基本面数据\n{fund_info}\n{extra}\n请基于以上数据给出业绩分析。"
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
            logger.error(f"业绩分析解析失败: {e}")
            return self._default_report()

    @staticmethod
    def _default_report() -> dict[str, Any]:
        return {
            "analyst_role": "performance",
            "thesis": "业绩分析暂时无法生成",
            "score": 5,
            "key_evidence": ["数据不足，无法分析业绩"],
            "risk_flags": [],
        }
