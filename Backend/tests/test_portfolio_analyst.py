import json
import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.fund_analysts.portfolio_analyst import PortfolioAnalyst

FAKE_LLM_CONFIG = {"api_key": "sk-test", "api_base": "https://test.api/v1", "model": "test-model"}

SAMPLE_PORTFOLIO = {
    "funds": [
        {
            "basic_info": {"fund_name": "易方达蓝筹", "fund_code": "005827", "fund_type": "混合型"},
            "performance": {"1_month_return": 3.0, "3_month_return": 6.0, "1_year_return": 12.0},
            "holdings": [
                {"code": "600519", "name": "贵州茅台", "ratio": 9.5, "industry": "食品饮料"},
                {"code": "000858", "name": "五粮液", "ratio": 8.2, "industry": "食品饮料"},
            ],
            "portfolio_weight_pct": 60.0,
        },
        {
            "basic_info": {"fund_name": "中欧医疗", "fund_code": "003095", "fund_type": "股票型"},
            "performance": {"1_month_return": -1.0, "3_month_return": -5.0, "1_year_return": 8.0},
            "holdings": [
                {"code": "300760", "name": "迈瑞医疗", "ratio": 7.8, "industry": "医药生物"},
                {"code": "600276", "name": "恒瑞医药", "ratio": 6.5, "industry": "医药生物"},
            ],
            "portfolio_weight_pct": 40.0,
        },
    ],
    "total_value": 100000.0,
    "aggregated_industries": {
        "食品饮料": 35.0,
        "医药生物": 25.0,
    },
    "aggregated_asset_allocation": {
        "股票": 85.0,
        "债券": 10.0,
        "现金": 5.0,
    },
    "overlap_stocks": [],
}


class TestPortfolioAnalyst(unittest.TestCase):
    def setUp(self):
        self.analyst = PortfolioAnalyst(**FAKE_LLM_CONFIG)
        self.analyst._call_llm = lambda prompt, system_prompt, temperature=0.3: json.dumps(
            {
                "rating": "Hold",
                "sentiment_score": 60,
                "operation_advice": "持有观望",
                "summary": "组合整体配置合理，但存在行业集中度偏高的问题。食品饮料和医药生物占比较高，建议适当分散。",
                "dashboard": {
                    "performance_eval": "良好",
                    "manager_ability": "良好",
                    "position_analysis": "集中",
                    "market_outlook": "中性",
                },
                "highlights": ["两只基金历史业绩稳健", "基金经理经验丰富"],
                "risk_factors": ["行业集中度较高", "持仓重叠风险"],
                "news_intel": ["市场整体震荡"],
                "detailed_report": "## 组合诊断报告\n\n当前组合由两只基金组成...\n\n### 行业分布\n食品饮料 35%、医药生物 25%\n\n### 建议\n建议增加科技、金融等行业配置以分散风险。",
            }
        )

    def test_analyze_returns_result(self):
        result = self.analyst.analyze(SAMPLE_PORTFOLIO)
        self.assertIn("rating", result)
        self.assertIn("sentiment_score", result)
        self.assertIn("operation_advice", result)
        self.assertIn("summary", result)
        self.assertIn("dashboard", result)
        self.assertIn("highlights", result)
        self.assertIn("risk_factors", result)
        self.assertIn("detailed_report", result)

    def test_analyze_with_market_context(self):
        result = self.analyst.analyze(SAMPLE_PORTFOLIO, market_context="今日市场上涨\n热点板块：科技")
        self.assertIn("rating", result)

    def test_parse_valid_json(self):
        raw = json.dumps(
            {
                "rating": "Buy",
                "sentiment_score": 75,
                "operation_advice": "建议买入",
                "summary": "这是一段超过20个字的总结内容。组合配置合理值得关注。",
                "dashboard": {
                    "performance_eval": "良好",
                    "manager_ability": "良好",
                    "position_analysis": "均衡",
                    "market_outlook": "乐观",
                },
                "highlights": ["亮点1", "亮点2", "亮点3"],
                "risk_factors": ["风险1"],
                "news_intel": [],
                "detailed_report": "## 详细报告\n\n这是一份详细的诊断报告，包含具体分析和建议。内容长度需要超过五十个字符才能通过Pydantic的验证。该报告涵盖了行业分布、持仓重叠、仓位合理性等多个维度。",
            }
        )
        result = self.analyst._parse(raw)
        self.assertEqual(result["rating"], "Buy")
        self.assertEqual(result["sentiment_score"], 75)
        self.assertEqual(result["_parse_error"], None)

    def test_parse_none_returns_default(self):
        result = self.analyst._parse(None)
        self.assertEqual(result["rating"], "Hold")
        self.assertEqual(result["_parse_error"], "llm_failure")

    def test_default_result(self):
        result = self.analyst._default_result()
        self.assertEqual(result["rating"], "Hold")
        self.assertEqual(result["sentiment_score"], 50)


class TestPortfolioAnalystEmptyData(unittest.TestCase):
    def setUp(self):
        self.analyst = PortfolioAnalyst(**FAKE_LLM_CONFIG)
        self.analyst._call_llm = lambda prompt, sys_prompt, temperature=0.3: json.dumps(
            {
                "rating": "Hold",
                "sentiment_score": 50,
                "operation_advice": "持有观望",
                "summary": "该测试用总结内容超过20个字以确保通过验证。",
                "dashboard": {
                    "performance_eval": "一般",
                    "manager_ability": "一般",
                    "position_analysis": "均衡",
                    "market_outlook": "中性",
                },
                "highlights": ["暂无数据"],
                "risk_factors": ["数据不足"],
                "news_intel": [],
                "detailed_report": "该测试用详细报告内容需要超过50字以确保通过Pydantic验证。这里补充更多文本来满足这个长度要求。",
            }
        )

    def test_empty_funds(self):
        result = self.analyst.analyze(
            {
                "funds": [],
                "total_value": 0,
                "aggregated_industries": {},
                "aggregated_asset_allocation": {},
                "overlap_stocks": [],
            }
        )
        self.assertIn("rating", result)

    def test_missing_aggregated_data(self):
        result = self.analyst.analyze({"funds": []})
        self.assertIn("rating", result)


if __name__ == "__main__":
    unittest.main()
