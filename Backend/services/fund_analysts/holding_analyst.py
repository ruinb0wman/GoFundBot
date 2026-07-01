from typing import Any

from core.logging import get_logger
from schemas.analysis_schemas import AnalystReport

from .base import BaseAnalyst

logger = get_logger(__name__)

SYSTEM_PROMPT = """你是一位基金持仓分析师。

你的任务是基于基金的持仓数据给出客观分析。请着重关注：
1. 持仓集中度——前十大重仓股占比、行业集中程度
2. 重仓股质量——前五大持仓股的基本面和行业地位
3. 行业分布——行业覆盖广度、与当前市场风格匹配度
4. 资产配置——股票/债券/现金仓位比例
5. 持仓稳定性——调仓频率和历史风格一致性

输出要求（纯 JSON，不要 markdown 包裹）：
{
    "analyst_role": "holding",
    "thesis": "持仓分析结论（200-300字）",
    "score": 0-10 的评分，
    "key_evidence": ["证据1", "证据2", "证据3"],
    "risk_flags": ["需要关注的风险因素"]
}
"""


class HoldingAnalyst(BaseAnalyst):
    def analyze(self, fund_data: dict[str, Any], market_context: str = "", past_context: str = "") -> dict[str, Any]:
        market_ctx = self._format_market_context(market_context)
        past_ctx = self._format_past_context(past_context)
        fund_info = self._format_fund_basic(fund_data)

        portfolio = fund_data.get("portfolio", {})
        allocation = fund_data.get("asset_allocation", {})
        extra = ""
        stock_codes = portfolio.get("stock_codes", [])
        if stock_codes:
            lines = []
            for i, s in enumerate(stock_codes[:10], 1):
                if isinstance(s, dict):
                    name = s.get("name", s.get("code", ""))
                    ratio = s.get("ratio", "")
                    if ratio:
                        lines.append(f"{i}. {name}（{ratio}%）")
                    else:
                        lines.append(f"{i}. {name}")
                else:
                    lines.append(f"{i}. {s}")
            if lines:
                extra += "## 重仓持股\n" + "\n".join(lines) + "\n"
        if allocation and isinstance(allocation, dict):
            cats = allocation.get("categories", [])
            series = allocation.get("series", [])
            if cats and series:
                extra += "## 资产配置\n"
                for s in series:
                    vals = [f"{cats[i]}: {s.get(cats[i], '')}" for i in range(min(len(cats), 5))]
                    extra += "- " + " | ".join(vals) + "\n"

        prompt = f"{market_ctx}{past_ctx}## 基金基本信息\n{fund_info}\n{extra}\n请基于以上数据给出持仓分析。"
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
            logger.error(f"持仓分析解析失败: {e}")
            return self._default_report()

    @staticmethod
    def _default_report() -> dict[str, Any]:
        return {
            "analyst_role": "holding",
            "thesis": "持仓分析暂时无法生成",
            "score": 5,
            "key_evidence": ["持仓数据不足"],
            "risk_flags": [],
        }
