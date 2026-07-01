import os
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"


from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import AnalysisMemory

FAKE_CONFIG = {"api_key": "sk-test", "api_base": "https://test.api/v1", "model": "test-model"}


class TestAnalysisMemoryModel(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", echo=False)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)

    def test_create_record(self):
        record = AnalysisMemory(
            fund_code="000001",
            analysis_date=datetime.now(),
            rating="Buy",
            sentiment_score=75,
            thesis="收益表现优异，建议买入。",
        )
        self.db.add(record)
        self.db.commit()
        saved = self.db.query(AnalysisMemory).filter(AnalysisMemory.fund_code == "000001").first()
        self.assertIsNotNone(saved)
        self.assertEqual(saved.rating, "Buy")
        self.assertEqual(saved.sentiment_score, 75)
        self.assertEqual(saved.resolved, 0)

    def test_resolved_flag(self):
        record = AnalysisMemory(
            fund_code="000001",
            analysis_date=datetime.now() - timedelta(days=30),
            rating="Sell",
            sentiment_score=30,
            thesis="风险较大",
            resolved=1,
            actual_return=-5.0,
            reflection="判断正确",
            resolved_date=datetime.now(),
        )
        self.db.add(record)
        self.db.commit()
        saved = self.db.query(AnalysisMemory).filter(AnalysisMemory.fund_code == "000001").first()
        self.assertEqual(saved.resolved, 1)
        self.assertEqual(saved.actual_return, -5.0)

    def test_multiple_records_same_fund(self):
        for i in range(3):
            r = AnalysisMemory(
                fund_code="000001",
                analysis_date=datetime.now() - timedelta(days=i * 10),
                rating="Buy",
                sentiment_score=60 + i * 10,
                thesis=f"分析{i}",
                resolved=1,
                actual_return=float(i),
                reflection=f"反思{i}",
                resolved_date=datetime.now(),
            )
            self.db.add(r)
        self.db.commit()
        count = self.db.query(AnalysisMemory).filter(AnalysisMemory.fund_code == "000001").count()
        self.assertEqual(count, 3)


class TestMemoryLogComputeReturn(unittest.TestCase):
    def setUp(self):
        from services.memory_log import AnalysisMemoryLog

        self.mlog = AnalysisMemoryLog(**FAKE_CONFIG)

    def test_compute_return_with_return1m(self):
        data = {"sections": {"performance": {"data": {"return1m": 2.5}}}}
        result = self.mlog._compute_return(data)
        self.assertAlmostEqual(result, 2.5)

    def test_compute_return_with_return3m(self):
        data = {"sections": {"performance": {"data": {"return3m": 6.0}}}}
        result = self.mlog._compute_return(data)
        self.assertAlmostEqual(result, 2.0)

    def test_compute_return_none_when_no_data(self):
        data = {}
        result = self.mlog._compute_return(data)
        self.assertIsNone(result)

    def test_compute_return_none_when_sections_missing(self):
        data = {"sections": {}}
        result = self.mlog._compute_return(data)
        self.assertIsNone(result)

    def test_compute_return_empty_perf(self):
        data = {"sections": {"performance": {"data": {}}}}
        result = self.mlog._compute_return(data)
        self.assertIsNone(result)

    def test_compute_return_invalid_type(self):
        data = {"sections": {"performance": {"data": "invalid"}}}
        result = self.mlog._compute_return(data)
        self.assertIsNone(result)


class TestMemoryLogTemplateReflection(unittest.TestCase):
    def setUp(self):
        from services.memory_log import AnalysisMemoryLog

        self.mlog = AnalysisMemoryLog(**FAKE_CONFIG)

    def test_template_correct(self):
        result = self.mlog._template_reflection("正确")
        self.assertIn("正确", result)
        self.assertIn("看多逻辑", result)

    def test_template_incorrect(self):
        result = self.mlog._template_reflection("有误")
        self.assertIn("有误", result)
        self.assertIn("下行风险", result)


class TestMemoryLogStoreAndContext(unittest.TestCase):
    def setUp(self):
        from services.memory_log import AnalysisMemoryLog

        self.mlog = AnalysisMemoryLog(**FAKE_CONFIG)

    @patch("database.SessionLocal")
    def test_store_analysis_creates_record(self, mock_session_local):

        mock_db = MagicMock()
        mock_session_local.return_value = mock_db

        self.mlog.store_analysis(
            "000001",
            {
                "rating": "Strong Buy",
                "sentiment_score": 90,
                "summary": "强烈推荐买入",
            },
        )

        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()

    @patch("database.SessionLocal")
    def test_store_analysis_skips_none_result(self, mock_session_local):
        mock_db = MagicMock()
        mock_session_local.return_value = mock_db

        self.mlog.store_analysis("000001", None)
        mock_db.add.assert_not_called()

    @patch("database.SessionLocal")
    def test_store_analysis_skips_result_without_rating(self, mock_session_local):
        mock_db = MagicMock()
        mock_session_local.return_value = mock_db

        self.mlog.store_analysis("000001", {"summary": "no rating"})
        mock_db.add.assert_not_called()

    @patch("database.SessionLocal")
    def test_get_past_context_returns_string(self, mock_session_local):
        mock_db = MagicMock()
        mock_session_local.return_value = mock_db

        mock_record = MagicMock(spec=AnalysisMemory)
        mock_record.fund_code = "000001"
        mock_record.analysis_date = datetime.now() - timedelta(days=10)
        mock_record.rating = "Buy"
        mock_record.sentiment_score = 75
        mock_record.thesis = "表现良好"
        mock_record.resolved = 1
        mock_record.actual_return = 3.5
        mock_record.reflection = "判断正确"
        mock_record.resolved_date = datetime.now()

        query_mock = MagicMock()
        mock_db.query.return_value = query_mock
        query_mock.filter.return_value = query_mock
        query_mock.order_by.return_value = query_mock
        query_mock.limit.return_value = query_mock
        query_mock.all.return_value = [mock_record]

        context = self.mlog.get_past_context("000001")
        self.assertIsInstance(context, str)
        self.assertIn("历史分析回顾", context)
        self.assertIn("Buy", context)
        self.assertIn("判断正确", context)

    @patch("database.SessionLocal")
    def test_get_past_context_empty_for_unknown(self, mock_session_local):
        mock_db = MagicMock()
        mock_session_local.return_value = mock_db

        query_mock = MagicMock()
        mock_db.query.return_value = query_mock
        query_mock.filter.return_value = query_mock
        query_mock.order_by.return_value = query_mock
        query_mock.limit.return_value = query_mock
        query_mock.all.return_value = []

        context = self.mlog.get_past_context("999999")
        self.assertEqual(context, "")

    @patch("database.SessionLocal")
    def test_get_past_context_without_return(self, mock_session_local):
        mock_db = MagicMock()
        mock_session_local.return_value = mock_db

        mock_record = MagicMock(spec=AnalysisMemory)
        mock_record.fund_code = "000001"
        mock_record.analysis_date = datetime.now() - timedelta(days=10)
        mock_record.rating = "Hold"
        mock_record.sentiment_score = 50
        mock_record.thesis = "中性"
        mock_record.resolved = 1
        mock_record.actual_return = None
        mock_record.reflection = None
        mock_record.resolved_date = None

        query_mock = MagicMock()
        mock_db.query.return_value = query_mock
        query_mock.filter.return_value = query_mock
        query_mock.order_by.return_value = query_mock
        query_mock.limit.return_value = query_mock
        query_mock.all.return_value = [mock_record]

        context = self.mlog.get_past_context("000001")
        self.assertIn("Hold", context)
        self.assertNotIn("实际收益", context)
        self.assertNotIn("事后反思", context)


if __name__ == "__main__":
    unittest.main()
