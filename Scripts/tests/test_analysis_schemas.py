import json
import sys
import unittest
from pathlib import Path

from pydantic import ValidationError

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from schemas.analysis_schemas import DashboardEval, FundAnalysisResult, Rating


class TestDashboardEval(unittest.TestCase):
    def test_valid(self):
        d = DashboardEval(
            performance_eval="优秀",
            manager_ability="良好",
            position_analysis="均衡",
            market_outlook="中性",
        )
        self.assertEqual(d.performance_eval, "优秀")

    def test_invalid_performance_eval(self):
        with self.assertRaises(ValidationError):
            DashboardEval(
                performance_eval="超优",
                manager_ability="良好",
                position_analysis="均衡",
                market_outlook="中性",
            )

    def test_invalid_position_analysis(self):
        with self.assertRaises(ValidationError):
            DashboardEval(
                performance_eval="优秀",
                manager_ability="良好",
                position_analysis="超集中",
                market_outlook="中性",
            )

    def test_extra_fields_ignored(self):
        d = DashboardEval(
            performance_eval="优秀",
            manager_ability="良好",
            position_analysis="均衡",
            market_outlook="中性",
            extra_field="ignored",
        )
        self.assertFalse(hasattr(d, "extra_field"))


class TestFundAnalysisResult(unittest.TestCase):
    def _valid_kwargs(self, **overrides):
        kwargs = {
            "rating": "Buy",
            "sentiment_score": 75,
            "operation_advice": "建议买入",
            "summary": "该基金表现优异，近一年收益在同类中排名前10%，基金经理经验丰富。",
            "dashboard": {
                "performance_eval": "优秀",
                "manager_ability": "良好",
                "position_analysis": "均衡",
                "market_outlook": "乐观",
            },
            "highlights": ["业绩稳定增长", "基金经理资深"],
            "risk_factors": ["市场波动风险"],
            "news_intel": ["新能源板块持续走强"],
            "detailed_report": (
                "## 深度分析\n该基金在近一年表现优异，收益率达到15%，远超同类平均水平。"
                "基金经理从业超过10年，管理经验丰富，历史业绩持续稳健。"
                "当前持仓以新能源和科技为主，契合市场风格。"
                "建议关注后续行业政策和市场流动性变化。"
            ),
        }
        kwargs.update(overrides)
        return kwargs

    def test_valid(self):
        r = FundAnalysisResult(**self._valid_kwargs())
        self.assertEqual(r.rating, "Buy")
        self.assertEqual(r.sentiment_score, 75)
        self.assertEqual(r.operation_advice, "建议买入")
        self.assertEqual(len(r.highlights), 2)
        self.assertEqual(len(r.risk_factors), 1)

    def test_rating_all_values(self):
        for rating in Rating:
            r = FundAnalysisResult(**self._valid_kwargs(rating=rating.value))
            self.assertEqual(r.rating, rating.value)

    def test_invalid_rating(self):
        with self.assertRaises(ValidationError):
            FundAnalysisResult(**self._valid_kwargs(rating="Invalid"))

    def test_sentiment_score_zero(self):
        r = FundAnalysisResult(**self._valid_kwargs(sentiment_score=0))
        self.assertEqual(r.sentiment_score, 0)

    def test_sentiment_score_one_hundred(self):
        r = FundAnalysisResult(**self._valid_kwargs(sentiment_score=100))
        self.assertEqual(r.sentiment_score, 100)

    def test_sentiment_score_negative(self):
        with self.assertRaises(ValidationError):
            FundAnalysisResult(**self._valid_kwargs(sentiment_score=-1))

    def test_sentiment_score_too_high(self):
        with self.assertRaises(ValidationError):
            FundAnalysisResult(**self._valid_kwargs(sentiment_score=101))

    def test_invalid_operation_advice(self):
        with self.assertRaises(ValidationError):
            FundAnalysisResult(**self._valid_kwargs(operation_advice="建议清仓"))

    def test_operation_advice_all_values(self):
        for advice in ["强烈推荐", "建议买入", "持有观望", "建议减仓", "建议卖出"]:
            r = FundAnalysisResult(**self._valid_kwargs(operation_advice=advice))
            self.assertEqual(r.operation_advice, advice)

    def test_empty_highlights(self):
        with self.assertRaises(ValidationError):
            FundAnalysisResult(**self._valid_kwargs(highlights=[]))

    def test_highlights_too_many(self):
        with self.assertRaises(ValidationError):
            FundAnalysisResult(**self._valid_kwargs(highlights=[f"item{i}" for i in range(11)]))

    def test_empty_risk_factors(self):
        with self.assertRaises(ValidationError):
            FundAnalysisResult(**self._valid_kwargs(risk_factors=[]))

    def test_news_intel_default_empty(self):
        kwargs = self._valid_kwargs()
        del kwargs["news_intel"]
        r = FundAnalysisResult(**kwargs)
        self.assertEqual(r.news_intel, [])

    def test_extra_fields_ignored(self):
        r = FundAnalysisResult(**self._valid_kwargs(extra_field="ignored"))
        self.assertFalse(hasattr(r, "extra_field"))

    def test_summary_too_short(self):
        with self.assertRaises(ValidationError):
            FundAnalysisResult(**self._valid_kwargs(summary="短"))

    def test_model_validate_json_valid(self):
        data = self._valid_kwargs()
        json_str = json.dumps(data, ensure_ascii=False)
        r = FundAnalysisResult.model_validate_json(json_str)
        self.assertEqual(r.rating, "Buy")
        self.assertEqual(r.sentiment_score, 75)

    def test_model_validate_json_invalid_rating(self):
        data = self._valid_kwargs(rating="NotValid")
        json_str = json.dumps(data, ensure_ascii=False)
        with self.assertRaises(ValidationError):
            FundAnalysisResult.model_validate_json(json_str)

    def test_model_validate_json_missing_field(self):
        data = self._valid_kwargs()
        del data["rating"]
        json_str = json.dumps(data, ensure_ascii=False)
        with self.assertRaises(ValidationError):
            FundAnalysisResult.model_validate_json(json_str)


class TestRatingEnum(unittest.TestCase):
    def test_values(self):
        self.assertEqual(Rating.STRONG_BUY.value, "Strong Buy")
        self.assertEqual(Rating.BUY.value, "Buy")
        self.assertEqual(Rating.HOLD.value, "Hold")
        self.assertEqual(Rating.UNDERWEIGHT.value, "Underweight")
        self.assertEqual(Rating.SELL.value, "Sell")

    def test_all_covered(self):
        values = {m.value for m in Rating}
        expected = {"Strong Buy", "Buy", "Hold", "Underweight", "Sell"}
        self.assertEqual(values, expected)


if __name__ == "__main__":
    unittest.main()
