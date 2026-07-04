import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.fund_analysts.base import BaseAnalyst
from services.fund_analysts.bear_analyst import BearAnalyst
from services.fund_analysts.bull_analyst import BullAnalyst
from services.fund_analysts.holding_analyst import HoldingAnalyst
from services.fund_analysts.manager import ResearchManager
from services.fund_analysts.manager_analyst import ManagerAnalyst
from services.fund_analysts.market_context_analyst import MarketContextAnalyst
from services.fund_analysts.orchestrator import AnalystOrchestrator
from services.fund_analysts.performance_analyst import PerformanceAnalyst
from services.fund_analysts.supervisor import Supervisor

FAKE_LLM_CONFIG = {"api_key": "sk-test", "api_base": "https://test.api/v1", "model": "test-model"}

SAMPLE_FUND = {
    "basic_info": {"fund_name": "测试基金", "fund_code": "000001", "fund_type": "混合型"},
    "performance": {"1_month_return": 2.5, "3_month_return": 5.0, "6_month_return": 8.0, "1_year_return": 15.0},
    "risk_metrics": {"sharpe_ratio": 1.5, "max_drawdown": -8.0, "volatility": 12.0},
    "fund_managers": [{"name": "张经理", "work_experience": "10", "managed_fund_size": "50亿"}],
    "portfolio": {"stock_codes": [{"name": "贵州茅台", "code": "600519"}, {"name": "宁德时代", "code": "300750"}]},
    "realtime_estimate": {},
}


class TestBaseAnalyst(unittest.TestCase):
    def setUp(self):
        self.analyst = BaseAnalyst(**FAKE_LLM_CONFIG)

    def test_format_fund_basic_contains_name(self):
        result = self.analyst._format_fund_basic(SAMPLE_FUND)
        self.assertIn("测试基金", result)
        self.assertIn("000001", result)
        self.assertIn("混合型", result)

    def test_format_fund_basic_contains_performance(self):
        result = self.analyst._format_fund_basic(SAMPLE_FUND)
        self.assertIn("2.5%", result)
        self.assertIn("5.0%", result)
        self.assertIn("15.0%", result)

    def test_format_fund_basic_contains_risk(self):
        result = self.analyst._format_fund_basic(SAMPLE_FUND)
        self.assertIn("夏普", result)
        self.assertIn("回撤", result)

    def test_format_fund_basic_contains_manager(self):
        result = self.analyst._format_fund_basic(SAMPLE_FUND)
        self.assertIn("张经理", result)

    def test_format_fund_basic_contains_holdings(self):
        result = self.analyst._format_fund_basic(SAMPLE_FUND)
        self.assertIn("贵州茅台", result)

    def test_format_fund_basic_empty_data(self):
        result = self.analyst._format_fund_basic({})
        self.assertIn("未知", result)

    def test_format_market_context_empty(self):
        result = self.analyst._format_market_context("")
        self.assertEqual(result, "")

    def test_format_market_context_nonempty(self):
        result = self.analyst._format_market_context("news1\nnews2")
        self.assertIn("当前市场环境", result)
        self.assertIn("news1", result)

    def test_extract_json_direct(self):
        raw = '{"key": "value"}'
        result = self.analyst._extract_json(raw)
        self.assertEqual(result, raw)

    def test_extract_json_code_block(self):
        raw = 'text before\n```json\n{"key": "value"}\n```\ntext after'
        result = self.analyst._extract_json(raw)
        self.assertEqual(json.loads(result), {"key": "value"})

    def test_extract_json_code_block_no_lang(self):
        raw = '```\n{"key": "value"}\n```'
        result = self.analyst._extract_json(raw)
        self.assertEqual(json.loads(result), {"key": "value"})

    def test_extract_json_embedded(self):
        raw = 'Here is the result: {"key": "value"} and more text'
        result = self.analyst._extract_json(raw)
        self.assertEqual(json.loads(result), {"key": "value"})

    def test_extract_json_no_json(self):
        raw = "no json here at all"
        result = self.analyst._extract_json(raw)
        self.assertEqual(result, raw)


class TestBullAnalyst(unittest.TestCase):
    def setUp(self):
        self.analyst = BullAnalyst(**FAKE_LLM_CONFIG)

    def test_default_report_structure(self):
        report = self.analyst._parse(None)
        self.assertEqual(report["analyst_role"], "bull")
        self.assertIn("score", report)
        self.assertIn("thesis", report)
        self.assertIn("key_evidence", report)
        self.assertIn("risk_flags", report)
        self.assertEqual(report["_parse_error"], "llm_failure")

    def test_parse_valid_json(self):
        raw = json.dumps(
            {
                "analyst_role": "bull",
                "thesis": "该基金业绩表现优异，近一年收益率达15%，远超同类平均。基金经理经验丰富，持仓结构合理。",
                "score": 8,
                "key_evidence": ["业绩远超同类", "经理经验丰富"],
                "risk_flags": ["市场波动加大"],
            }
        )
        result = self.analyst._parse(raw)
        self.assertEqual(result["analyst_role"], "bull")
        self.assertEqual(result["score"], 8)
        self.assertEqual(len(result["key_evidence"]), 2)

    def test_parse_invalid_json_returns_default(self):
        result = self.analyst._parse("not json")
        self.assertEqual(result["analyst_role"], "bull")
        self.assertEqual(result["score"], 5)

    def test_parse_none_returns_default(self):
        result = self.analyst._parse(None)
        self.assertEqual(result["analyst_role"], "bull")

    def test_parse_missing_field_falls_back_to_default(self):
        raw = json.dumps({"analyst_role": "bull"})
        result = self.analyst._parse(raw)
        self.assertEqual(result["score"], 5)
        self.assertIn("解析异常", result["thesis"])
        self.assertEqual(result["_parse_error"], "validation_failure")


class TestBearAnalyst(unittest.TestCase):
    def setUp(self):
        self.analyst = BearAnalyst(**FAKE_LLM_CONFIG)

    def test_default_report_structure(self):
        report = self.analyst._parse(None)
        self.assertEqual(report["analyst_role"], "bear")
        self.assertIn("score", report)
        self.assertIn("thesis", report)
        self.assertEqual(report["_parse_error"], "llm_failure")

    def test_parse_valid_json(self):
        raw = json.dumps(
            {
                "analyst_role": "bear",
                "thesis": "该基金持仓集中度高，重仓行业面临政策调整风险，估值处于历史高位。",
                "score": 4,
                "key_evidence": ["集中度高", "政策风险"],
                "risk_flags": ["估值偏高"],
            }
        )
        result = self.analyst._parse(raw)
        self.assertEqual(result["analyst_role"], "bear")
        self.assertEqual(result["score"], 4)

    def test_parse_invalid_json_returns_default(self):
        result = self.analyst._parse("not json")
        self.assertEqual(result["analyst_role"], "bear")
        self.assertEqual(result["score"], 5)


class TestResearchManager(unittest.TestCase):
    def setUp(self):
        self.manager = ResearchManager(**FAKE_LLM_CONFIG)
        self.bull_report = {
            "analyst_role": "bull",
            "thesis": "该基金业绩优异，经理经验丰富。",
            "score": 8,
            "key_evidence": ["收益高", "风控好"],
            "risk_flags": [],
        }
        self.bear_report = {
            "analyst_role": "bear",
            "thesis": "持仓集中度高风险大。",
            "score": 4,
            "key_evidence": ["集中度高"],
            "risk_flags": [],
        }

    def test_default_result_structure(self):
        result = self.manager._default_result()
        self.assertEqual(result["rating"], "Hold")
        self.assertIn("sentiment_score", result)
        self.assertIn("dashboard", result)
        self.assertIn("detailed_report", result)

    def test_parse_valid_result(self):
        raw = json.dumps(
            {
                "rating": "Buy",
                "sentiment_score": 70,
                "operation_advice": "建议买入",
                "summary": "综合评估后，该基金具备较好的投资价值。",
                "dashboard": {
                    "performance_eval": "优秀",
                    "manager_ability": "良好",
                    "position_analysis": "均衡",
                    "market_outlook": "中性",
                },
                "highlights": ["业绩稳定", "经理可靠"],
                "risk_factors": ["市场波动"],
                "news_intel": [],
                "detailed_report": "## 综合评估\n该基金整体表现优秀，建议买入。基金经理管理经验丰富，持仓结构合理，值得长期持有。综合考虑各方面因素，建议积极配置。",
            }
        )
        result = self.manager._parse(raw)
        self.assertEqual(result["rating"], "Buy")
        self.assertEqual(result["sentiment_score"], 70)

    def test_parse_invalid_json_returns_default(self):
        result = self.manager._parse("not json")
        self.assertEqual(result["rating"], "Hold")

    def test_format_list_with_items(self):
        result = self.manager._format_list(["a", "b"])
        self.assertEqual(result, "- a\n- b")

    def test_format_list_empty(self):
        result = self.manager._format_list([])
        self.assertEqual(result, "- 无")


class TestPerformanceAnalyst(unittest.TestCase):
    def setUp(self):
        self.analyst = PerformanceAnalyst(**FAKE_LLM_CONFIG)

    def test_default_report_structure(self):
        report = self.analyst._parse(None)
        self.assertEqual(report["analyst_role"], "performance")
        self.assertIn("score", report)
        self.assertEqual(report["_parse_error"], "llm_failure")

    def test_parse_valid_json(self):
        raw = json.dumps(
            {
                "analyst_role": "performance",
                "thesis": "该基金近一年收益15%，夏普比率高，回撤控制出色。",
                "score": 8,
                "key_evidence": ["收益突出", "风控优秀"],
                "risk_flags": [],
            }
        )
        result = self.analyst._parse(raw)
        self.assertEqual(result["analyst_role"], "performance")
        self.assertEqual(result["score"], 8)

    def test_parse_invalid_json_returns_default(self):
        result = self.analyst._parse("bad json")
        self.assertEqual(result["score"], 5)


class TestHoldingAnalyst(unittest.TestCase):
    def setUp(self):
        self.analyst = HoldingAnalyst(**FAKE_LLM_CONFIG)

    def test_default_report_structure(self):
        report = self.analyst._parse(None)
        self.assertEqual(report["analyst_role"], "holding")
        self.assertEqual(report["_parse_error"], "llm_failure")

    def test_parse_valid_json(self):
        raw = json.dumps(
            {
                "analyst_role": "holding",
                "thesis": "持仓集中度适中，重仓股质地优良，行业分布合理。",
                "score": 7,
                "key_evidence": ["持仓均衡", "重仓优质"],
                "risk_flags": ["单一行业偏高"],
            }
        )
        result = self.analyst._parse(raw)
        self.assertEqual(result["analyst_role"], "holding")
        self.assertEqual(result["score"], 7)

    def test_parse_invalid_json_returns_default(self):
        result = self.analyst._parse("bad json")
        self.assertEqual(result["score"], 5)


class TestManagerAnalyst(unittest.TestCase):
    def setUp(self):
        self.analyst = ManagerAnalyst(**FAKE_LLM_CONFIG)

    def test_default_report_structure(self):
        report = self.analyst._parse(None)
        self.assertEqual(report["analyst_role"], "manager")
        self.assertEqual(report["_parse_error"], "llm_failure")

    def test_parse_valid_json(self):
        raw = json.dumps(
            {
                "analyst_role": "manager",
                "thesis": "基金经理从业经验丰富，历史业绩稳定，管理规模适中。",
                "score": 7,
                "key_evidence": ["经理经验丰富", "业绩一致性好"],
                "risk_flags": [],
            }
        )
        result = self.analyst._parse(raw)
        self.assertEqual(result["analyst_role"], "manager")
        self.assertEqual(result["score"], 7)

    def test_parse_invalid_json_returns_default(self):
        result = self.analyst._parse("bad json")
        self.assertEqual(result["score"], 5)


class TestMarketContextAnalyst(unittest.TestCase):
    def setUp(self):
        self.analyst = MarketContextAnalyst(**FAKE_LLM_CONFIG)

    def test_default_report_structure(self):
        report = self.analyst._parse(None)
        self.assertEqual(report["analyst_role"], "market")
        self.assertEqual(report["_parse_error"], "llm_failure")

    def test_parse_valid_json(self):
        raw = json.dumps(
            {
                "analyst_role": "market",
                "thesis": "近期市场热点板块与基金持仓行业匹配度较高，市场情绪中性偏积极。",
                "score": 6,
                "key_evidence": ["行业匹配度高", "市场情绪回暖"],
                "risk_flags": ["政策不确定性"],
            }
        )
        result = self.analyst._parse(raw)
        self.assertEqual(result["analyst_role"], "market")
        self.assertEqual(result["score"], 6)

    def test_parse_invalid_json_returns_default(self):
        result = self.analyst._parse("bad json")
        self.assertEqual(result["score"], 5)


class TestSupervisor(unittest.TestCase):
    def setUp(self):
        self.supervisor = Supervisor(**FAKE_LLM_CONFIG)

    def _sample_reports(self):
        return {
            "performance": {
                "analyst_role": "performance",
                "thesis": "业绩好",
                "score": 8,
                "key_evidence": ["收益高"],
                "risk_flags": [],
            },
            "holding": {
                "analyst_role": "holding",
                "thesis": "持仓合理",
                "score": 7,
                "key_evidence": ["行业均衡"],
                "risk_flags": [],
            },
            "manager": {
                "analyst_role": "manager",
                "thesis": "经理优秀",
                "score": 8,
                "key_evidence": ["经验丰富"],
                "risk_flags": [],
            },
            "market": {
                "analyst_role": "market",
                "thesis": "环境有利",
                "score": 6,
                "key_evidence": ["政策利好"],
                "risk_flags": [],
            },
        }

    def test_default_result_structure(self):
        result = self.supervisor._default_result()
        self.assertEqual(result["rating"], "Hold")

    def test_parse_valid_result(self):
        raw = json.dumps(
            {
                "rating": "Buy",
                "sentiment_score": 72,
                "operation_advice": "建议买入",
                "summary": "综合四位分析师观点，该基金值得买入。",
                "dashboard": {
                    "performance_eval": "优秀",
                    "manager_ability": "良好",
                    "position_analysis": "均衡",
                    "market_outlook": "乐观",
                },
                "highlights": ["业绩优异", "经理可靠", "行业匹配"],
                "risk_factors": ["市场波动"],
                "news_intel": ["政策利好"],
                "detailed_report": "## 综合评估\n四位分析师一致看好该基金。业绩优异、持仓合理、经理可靠、环境有利。建议买入。综合多方因素，基金具备较好投资价值。",
            }
        )
        result = self.supervisor._parse(raw)
        self.assertEqual(result["rating"], "Buy")
        self.assertEqual(result["sentiment_score"], 72)


class TestAnalystOrchestrator(unittest.TestCase):
    def setUp(self):
        self.orchestrator = AnalystOrchestrator(**FAKE_LLM_CONFIG)

    def test_default_report(self):
        report = self.orchestrator._default_report("performance")
        self.assertEqual(report["analyst_role"], "performance")

    def test_default_report_unknown_role(self):
        report = self.orchestrator._default_report("unknown")
        self.assertEqual(report["analyst_role"], "unknown")

    @patch("services.fund_analysts.performance_analyst.PerformanceAnalyst.analyze")
    @patch("services.fund_analysts.holding_analyst.HoldingAnalyst.analyze")
    @patch("services.fund_analysts.manager_analyst.ManagerAnalyst.analyze")
    @patch("services.fund_analysts.market_context_analyst.MarketContextAnalyst.analyze")
    @patch("services.fund_analysts.supervisor.Supervisor.synthesize")
    def test_analyze_calls_all_analysts(
        self,
        mock_supervisor,
        mock_market,
        mock_manager,
        mock_holding,
        mock_perf,
    ):
        mock_perf.return_value = {"analyst_role": "performance", "score": 8}
        mock_holding.return_value = {"analyst_role": "holding", "score": 7}
        mock_manager.return_value = {"analyst_role": "manager", "score": 8}
        mock_market.return_value = {"analyst_role": "market", "score": 6}
        mock_supervisor.return_value = {"rating": "Buy", "sentiment_score": 72, "analyst_reports": []}

        result = self.orchestrator.analyze(SAMPLE_FUND)

        mock_perf.assert_called_once()
        mock_holding.assert_called_once()
        mock_manager.assert_called_once()
        mock_market.assert_called_once()
        mock_supervisor.assert_called_once()
        self.assertIn("analyst_reports", result)


class TestAnalystReportSchema(unittest.TestCase):
    def test_valid_report(self):
        from schemas.analysis_schemas import AnalystReport

        r = AnalystReport(
            analyst_role="bull",
            thesis="这是一份完整的看多分析报告。该基金业绩表现优异。",
            score=7,
            key_evidence=["证据1", "证据2"],
        )
        self.assertEqual(r.analyst_role, "bull")
        self.assertEqual(r.score, 7)

    def test_new_roles_valid(self):
        from schemas.analysis_schemas import AnalystReport

        for role in ("performance", "holding", "manager", "market"):
            r = AnalystReport(
                analyst_role=role,
                thesis="这是一份完整的分析报告。该基金表现良好。",
                score=7,
                key_evidence=["证据1"],
            )
            self.assertEqual(r.analyst_role, role)

    def test_invalid_role(self):
        from pydantic import ValidationError

        from schemas.analysis_schemas import AnalystReport

        with self.assertRaises(ValidationError):
            AnalystReport(
                analyst_role="invalid",
                thesis="这是一份完整的看多分析报告。该基金业绩表现优异。",
                score=7,
                key_evidence=["证据1"],
            )

    def test_score_out_of_range(self):
        from pydantic import ValidationError

        from schemas.analysis_schemas import AnalystReport

        with self.assertRaises(ValidationError):
            AnalystReport(
                analyst_role="bull",
                thesis="这是一份完整的看多分析报告。该基金业绩表现优异。",
                score=15,
                key_evidence=["证据1"],
            )

    def test_empty_key_evidence(self):
        from pydantic import ValidationError

        from schemas.analysis_schemas import AnalystReport

        with self.assertRaises(ValidationError):
            AnalystReport(
                analyst_role="bull",
                thesis="这是一份完整的看多分析报告。该基金业绩表现优异。",
                score=7,
                key_evidence=[],
            )


if __name__ == "__main__":
    unittest.main()
