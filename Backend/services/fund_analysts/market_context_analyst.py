from typing import Any

from core.logging import get_logger
from schemas.analysis_schemas import AnalystReport

from .base import BaseAnalyst

logger = get_logger(__name__)

SYSTEM_PROMPT = """你是一位市场环境分析师。

你的任务是基于当前市场数据和基金行业属性给出客观分析。请着重关注：
1. 市场情绪——今日快讯反映的市场整体情绪和关注焦点
2. 热点板块——涨幅领先和资金流入最多的行业板块
3. 行业相关性——基金持仓行业与当前市场热点的匹配程度
4. 政策环境——近期重要政策对基金持仓行业的影响
5. 宏观背景——利率、汇率、经济数据等宏观因素

输出要求（纯 JSON，不要 markdown 包裹）：
{
    "analyst_role": "market",
    "thesis": "市场环境分析结论（200-300字）",
    "score": 0-10 的评分，
    "key_evidence": ["证据1", "证据2", "证据3"],
    "risk_flags": ["需要关注的风险因素"]
}
"""


class MarketContextAnalyst(BaseAnalyst):
    def analyze(self, fund_data: dict[str, Any], market_context: str = "", past_context: str = "") -> dict[str, Any]:
        market_ctx = self._format_market_context(market_context)
        past_ctx = self._format_past_context(past_context)
        fund_info = self._format_fund_basic(fund_data)

        extra = "## 基金行业属性\n"
        industry_tags = fund_data.get("industry_tags", fund_data.get("industry", []))
        if industry_tags:
            if isinstance(industry_tags, list):
                for t in industry_tags[:5]:
                    if isinstance(t, dict):
                        extra += f"- {t.get('industry_tag', t.get('name', ''))}"
                        if t.get("industry_ratio"):
                            extra += f"（占比{t['industry_ratio']}%）"
                        extra += "\n"
                    else:
                        extra += f"- {t}\n"
            elif isinstance(industry_tags, str):
                extra += f"- {industry_tags}\n"
        else:
            extra += "- 暂无行业标签数据\n"

        if market_context:
            extra += f"\n## 当日市场数据\n{market_context}\n"

        prompt = f"{market_ctx}{past_ctx}## 基金基本信息\n{fund_info}\n{extra}\n请基于以上数据给出市场环境分析。"
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
            logger.error(f"市场环境分析解析失败: {e}")
            return self._default_report()

    @staticmethod
    def _default_report() -> dict[str, Any]:
        return {
            "analyst_role": "market",
            "thesis": "市场环境分析暂时无法生成",
            "score": 5,
            "key_evidence": ["市场数据不足"],
            "risk_flags": [],
        }
