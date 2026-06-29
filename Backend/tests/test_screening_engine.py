import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.screening_engine import _matches_fund_type, _snapshot_performance, check_4433_rule


class TestCheck4433Rule(unittest.TestCase):
    def test_passes_all_criteria(self):
        self.assertTrue(
            check_4433_rule(
                rank_1y=10,
                rank_2y=15,
                rank_3y=20,
                rank_5y=None,
                rank_6m=25,
                rank_3m=30,
            )
        )

    def test_fails_1y_over_25(self):
        self.assertFalse(
            check_4433_rule(
                rank_1y=30,
                rank_2y=15,
                rank_3y=20,
                rank_5y=None,
                rank_6m=25,
                rank_3m=30,
            )
        )

    def test_fails_3m_over_33(self):
        self.assertFalse(
            check_4433_rule(
                rank_1y=10,
                rank_2y=15,
                rank_3y=20,
                rank_5y=None,
                rank_6m=25,
                rank_3m=40,
            )
        )

    def test_fails_6m_over_33(self):
        self.assertFalse(
            check_4433_rule(
                rank_1y=10,
                rank_2y=15,
                rank_3y=20,
                rank_5y=None,
                rank_6m=40,
                rank_3m=25,
            )
        )

    def test_passes_with_none_2y(self):
        self.assertTrue(
            check_4433_rule(
                rank_1y=10,
                rank_2y=None,
                rank_3y=20,
                rank_5y=None,
                rank_6m=25,
                rank_3m=30,
            )
        )

    def test_fails_when_2y_and_3y_both_over_25(self):
        self.assertFalse(
            check_4433_rule(
                rank_1y=10,
                rank_2y=30,
                rank_3y=30,
                rank_5y=None,
                rank_6m=25,
                rank_3m=30,
            )
        )

    def test_5y_over_25_fails(self):
        self.assertFalse(
            check_4433_rule(
                rank_1y=10,
                rank_2y=15,
                rank_3y=20,
                rank_5y=30,
                rank_6m=25,
                rank_3m=30,
            )
        )

    def test_all_none_long_term(self):
        self.assertFalse(
            check_4433_rule(
                rank_1y=10,
                rank_2y=None,
                rank_3y=None,
                rank_5y=None,
                rank_6m=40,
                rank_3m=40,
            )
        )

    def test_boundary_25_passes(self):
        self.assertTrue(
            check_4433_rule(
                rank_1y=25,
                rank_2y=25,
                rank_3y=25,
                rank_5y=25,
                rank_6m=25,
                rank_3m=25,
            )
        )

    def test_boundary_33_33_fails(self):
        self.assertFalse(
            check_4433_rule(
                rank_1y=10,
                rank_2y=15,
                rank_3y=20,
                rank_5y=None,
                rank_6m=33.34,
                rank_3m=33.34,
            )
        )


class TestMatchesFundType(unittest.TestCase):
    def test_match_by_substring(self):
        self.assertTrue(_matches_fund_type("股票型", ["股票"]))

    def test_no_match(self):
        self.assertFalse(_matches_fund_type("债券型", ["股票"]))

    def test_empty_selected_types(self):
        self.assertTrue(_matches_fund_type("股票型", []))

    def test_none_fund_type(self):
        self.assertFalse(_matches_fund_type(None, ["股票"]))

    def test_match_code_in_type_string(self):
        self.assertTrue(_matches_fund_type("gp-股票型", ["gp"]))

    def test_empty_fund_type_with_selection(self):
        self.assertFalse(_matches_fund_type("", ["股票"]))


class TestSnapshotPerformance(unittest.TestCase):
    def test_performance_extraction(self):
        item = {
            "return1m": 1.5,
            "return3m": 3.0,
            "return6m": 5.0,
            "return1y": 10.0,
            "return2y": 20.0,
            "return3y": 30.0,
            "ytd": 8.0,
            "sinceInception": 50.0,
        }
        perf = _snapshot_performance(item)
        self.assertEqual(perf["1_month_return"], 1.5)
        self.assertEqual(perf["3_year_return"], 30.0)

    def test_missing_fields(self):
        perf = _snapshot_performance({})
        self.assertIsNone(perf["1_month_return"])
        self.assertIsNone(perf["since_inception_return"])


if __name__ == "__main__":
    unittest.main()
