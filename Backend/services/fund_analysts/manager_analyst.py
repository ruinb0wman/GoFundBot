from typing import Any

from core.logging import get_logger
from schemas.analysis_schemas import AnalystReport

from .base import BaseAnalyst

logger = get_logger(__name__)

SYSTEM_PROMPT = """你是一位基金经理分析师。

你的任务是基于基金经理的信息给出客观分析。请着重关注：
1. 从业经验——基金经理的从业年限、任职稳定性
2. 管理规模——管理基金数量和总规模、规模扩张速度
3. 历史业绩——管理的其他基金的历史表现和同类排名
4. 投资风格——风格稳定性、是否频繁换股/换行业
5. 团队实力——基金经理团队支持、投研资源

输出要求（纯 JSON，不要 markdown 包裹）：
{
    "analyst_role": "manager",
    "thesis": "经理分析结论（200-300字）",
    "score": 0-10 的评分，
    "key_evidence": ["证据1", "证据2", "证据3"],
    "risk_flags": ["需要关注的风险因素"]
}
"""


class ManagerAnalyst(BaseAnalyst):
    def analyze(self, fund_data: dict[str, Any], market_context: str = "", past_context: str = "") -> dict[str, Any]:
        market_ctx = self._format_market_context(market_context)
        past_ctx = self._format_past_context(past_context)
        fund_info = self._format_fund_basic(fund_data)

        managers = fund_data.get("fund_managers", [])
        extra = "## 基金经理信息\n"
        if managers:
            for i, m in enumerate(managers[:3], 1):
                parts = [f"{i}. {m.get('name', '未知')}"]
                if m.get("work_experience"):
                    parts.append(f"从业{m['work_experience']}年")
                if m.get("managed_fund_size"):
                    parts.append(f"管理规模{m['managed_fund_size']}")
                if m.get("fund_type"):
                    parts.append(f"擅长{m['fund_type']}")
                extra += "- " + " | ".join(parts) + "\n"
        else:
            extra += "- 暂无基金经理数据\n"

        prompt = f"{market_ctx}{past_ctx}## 基金基本信息\n{fund_info}\n{extra}\n请基于以上数据给出基金经理分析。"
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
            logger.error(f"经理分析解析失败: {e}")
            return self._default_report()

    @staticmethod
    def _default_report() -> dict[str, Any]:
        return {
            "analyst_role": "manager",
            "thesis": "经理分析暂时无法生成",
            "score": 5,
            "key_evidence": ["基金经理数据不足"],
            "risk_flags": [],
        }
