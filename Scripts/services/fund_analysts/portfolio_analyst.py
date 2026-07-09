from typing import Any

from core.logging import get_logger
from schemas.analysis_schemas import FundAnalysisResult

from .base import PARSE_ERROR_LLM_FAILURE, PARSE_ERROR_NONE, PARSE_ERROR_VALIDATION_FAILURE, BaseAnalyst

logger = get_logger(__name__)

SYSTEM_PROMPT = """你是一位投资组合分析师。

你的任务是基于用户当前的投资组合数据给出客观的持仓组合诊断。请着重关注：
1. 行业集中度——所有持仓基金的底层股票行业分布是否存在过度集中
2. 持仓重叠——多只基金是否重仓了同一批股票，导致名义分散但实质集中
3. 仓位合理性——各基金的仓位占比是否合理，是否存在单只基金占比过大的风险
4. 资产配置——股票型/债券型/混合型基金的配置比例是否匹配当前市场环境
5. 风险提示——组合整体的潜在风险点

输出要求（纯 JSON，不要 markdown 包裹）：
{
    "rating": "Strong Buy"/"Buy"/"Hold"/"Underweight"/"Sell"，
    "sentiment_score": 0-100，
    "operation_advice": "强烈推荐"/"建议买入"/"持有观望"/"建议减仓"/"建议卖出"，
    "summary": "组合诊断总结（200-300字）",
    "dashboard": {
        "performance_eval": "优秀/良好/一般/较差",
        "manager_ability": "优秀/良好/一般/较差",
        "position_analysis": "集中/均衡/分散",
        "market_outlook": "乐观/中性/谨慎"
    },
    "highlights": ["组合亮点1", "组合亮点2", "组合亮点3"],
    "risk_factors": ["风险1", "风险2", "风险3"],
    "news_intel": ["相关市场信息1", "相关市场信息2"],
    "detailed_report": "深度分析报告（Markdown格式，不少于500字，包含具体基金和持仓分析）"
}
"""


class PortfolioAnalyst(BaseAnalyst):
    def analyze(
        self,
        portfolio_data: dict[str, Any],
        market_context: str = "",
    ) -> dict[str, Any]:
        market_ctx = self._format_market_context(market_context)
        funds = portfolio_data.get("funds", [])

        prompt_lines = [f"## 投资组合概览\n当前共持有 {len(funds)} 只基金\n"]

        total_value = portfolio_data.get("total_value", 0)
        if total_value:
            prompt_lines.append(f"组合总市值：¥{total_value:.2f}\n")

        aggregated_industries = portfolio_data.get("aggregated_industries", {})
        if aggregated_industries:
            prompt_lines.append("## 行业分布汇总（按持仓市值加权）\n")
            sorted_industries = sorted(aggregated_industries.items(), key=lambda x: x[1], reverse=True)
            for industry, weight in sorted_industries[:10]:
                prompt_lines.append(f"- {industry}：{weight:.1f}%")
            prompt_lines.append("")

        aggregated_assets = portfolio_data.get("aggregated_asset_allocation", {})
        if aggregated_assets:
            prompt_lines.append("## 整体资产配置\n")
            for k, v in sorted(aggregated_assets.items(), key=lambda x: x[1], reverse=True):
                prompt_lines.append(f"- {k}：{v:.1f}%")
            prompt_lines.append("")

        overlap_stocks = portfolio_data.get("overlap_stocks", [])
        if overlap_stocks:
            prompt_lines.append("## 持仓重叠预警\n以下股票被多只基金共同持有：\n")
            for item in overlap_stocks[:10]:
                prompt_lines.append(
                    f"- {item.get('name', item.get('code', ''))} "
                    f"出现在 {item.get('fund_count', 0)} 只基金中，"
                    f"合计占组合权重 {item.get('total_weight', 0):.1f}%"
                )
            prompt_lines.append("")

        prompt_lines.append("## 各基金详情\n")
        for i, fund in enumerate(funds, 1):
            info = fund.get("basic_info", {})
            prompt_lines.append(f"### {i}. {info.get('fund_name', '未知')}（{info.get('fund_code', '')}）")
            pct = fund.get("portfolio_weight_pct", 0)
            if pct:
                prompt_lines.append(f"组合占比：{pct:.1f}%")
            ftype = info.get("fund_type", "")
            if ftype:
                prompt_lines.append(f"基金类型：{ftype}")

            performance = fund.get("performance", {})
            perf_parts = []
            for label, key in [
                ("近1月", "1_month_return"),
                ("近3月", "3_month_return"),
                ("近6月", "6_month_return"),
                ("近1年", "1_year_return"),
            ]:
                val = performance.get(key)
                if val is not None:
                    perf_parts.append(f"{label} {val}%")
            if perf_parts:
                prompt_lines.append("收益：" + "、".join(perf_parts))

            holdings = fund.get("holdings", [])
            if holdings:
                prompt_lines.append("重仓持股：")
                for s in holdings[:5]:
                    if isinstance(s, dict):
                        name = s.get("name", s.get("code", ""))
                        ratio = s.get("ratio", "")
                        industry = s.get("industry", "")
                        industry_str = f" ({industry})" if industry else ""
                        ratio_str = f" {ratio}%" if ratio else ""
                        prompt_lines.append(f"  - {name}{industry_str}{ratio_str}")
                    else:
                        prompt_lines.append(f"  - {s}")
            prompt_lines.append("")

        prompt = "\n".join(prompt_lines)
        full_prompt = f"{market_ctx}{prompt}\n请基于以上组合数据给出专业的持仓诊断。"
        raw = self._call_llm(full_prompt, SYSTEM_PROMPT, temperature=0.3)
        return self._parse(raw)

    def _parse(self, raw: str | None) -> dict[str, Any]:
        if not raw:
            result = self._default_result()
            result["_parse_error"] = PARSE_ERROR_LLM_FAILURE
            return result
        try:
            json_str = self._extract_json(raw)
            parsed = FundAnalysisResult.model_validate_json(json_str)
            result = parsed.model_dump()
            result["_parse_error"] = PARSE_ERROR_NONE
            return result
        except Exception as e:
            logger.error(f"组合诊断解析失败: {e}")
            result = self._default_result()
            result["_parse_error"] = PARSE_ERROR_VALIDATION_FAILURE
            result["key_evidence"] = [f"LLM 响应解析失败: {str(e)[:200]}"]
            result["risk_factors"] = ["分析结果解析异常，请重试"]
            return result

    @staticmethod
    def _default_result() -> dict[str, Any]:
        return {
            "rating": "Hold",
            "sentiment_score": 50,
            "operation_advice": "持有观望",
            "summary": "组合诊断未能生成完整结果，建议持有观望",
            "dashboard": {
                "performance_eval": "一般",
                "manager_ability": "一般",
                "position_analysis": "均衡",
                "market_outlook": "中性",
            },
            "highlights": ["请重新诊断"],
            "risk_factors": ["LLM 调用异常导致诊断不完整"],
            "news_intel": [],
            "detailed_report": "## 诊断未完成\n因 LLM 调用异常，本次组合诊断未能完成。请稍后重试。",
        }
