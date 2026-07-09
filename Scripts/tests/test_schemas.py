import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from schemas.backtest_schemas import FixedInvestmentSchema
from schemas.screening_schemas import ScreeningQuerySchema
from schemas.watchlist_schemas import (
    AddWatchlistSchema,
    BatchDeleteSchema,
    CreateGroupSchema,
    MoveFundSchema,
    ReorderSchema,
)


class TestWatchlistSchemas(unittest.TestCase):
    def test_add_watchlist_valid(self):
        s = AddWatchlistSchema(fund_code="000001", fund_name="测试基金")
        self.assertEqual(s.fund_code, "000001")

    def test_add_watchlist_trim_code(self):
        s = AddWatchlistSchema(fund_code=" 000001 ")
        self.assertEqual(s.fund_code, "000001")

    def test_add_watchlist_code_too_short(self):
        with self.assertRaises(ValueError):
            AddWatchlistSchema(fund_code="123")

    def test_add_watchlist_code_not_digit(self):
        with self.assertRaises(ValueError):
            AddWatchlistSchema(fund_code="abc123")

    def test_add_watchlist_with_estimate(self):
        s = AddWatchlistSchema(fund_code="000001", estimate={"net_worth": "1.5"})
        self.assertEqual(s.estimate["net_worth"], "1.5")

    def test_batch_delete_valid(self):
        s = BatchDeleteSchema(fund_codes=["000001", "000002"])
        self.assertEqual(len(s.fund_codes), 2)

    def test_batch_delete_empty(self):
        with self.assertRaises(ValueError):
            BatchDeleteSchema(fund_codes=[])

    def test_batch_delete_too_many(self):
        with self.assertRaises(ValueError):
            BatchDeleteSchema(fund_codes=[str(i) for i in range(101)])

    def test_reorder_valid(self):
        s = ReorderSchema(fund_codes=["000001", "000002"])
        self.assertEqual(s.fund_codes, ["000001", "000002"])

    def test_reorder_empty(self):
        with self.assertRaises(ValueError):
            ReorderSchema(fund_codes=[])

    def test_move_fund_valid(self):
        s = MoveFundSchema(fund_code="000001", group_id=1)
        self.assertEqual(s.fund_code, "000001")
        self.assertEqual(s.group_id, 1)

    def test_move_fund_code_too_short(self):
        with self.assertRaises(ValueError):
            MoveFundSchema(fund_code="123")

    def test_create_group_valid(self):
        s = CreateGroupSchema(name="我的分组")
        self.assertEqual(s.name, "我的分组")

    def test_create_group_empty_name(self):
        with self.assertRaises(ValueError):
            CreateGroupSchema(name="")

    def test_create_group_name_too_long(self):
        with self.assertRaises(ValueError):
            CreateGroupSchema(name="a" * 21)


class TestScreeningQuerySchema(unittest.TestCase):
    def test_defaults(self):
        s = ScreeningQuerySchema()
        self.assertEqual(s.page, 1)
        self.assertEqual(s.page_size, 20)
        self.assertEqual(s.sort_order, "desc")

    def test_page_clamp_low(self):
        s = ScreeningQuerySchema(page=0)
        self.assertEqual(s.page, 1)

    def test_page_clamp_high(self):
        s = ScreeningQuerySchema(page=1001)
        self.assertEqual(s.page, 1000)

    def test_page_size_clamp_low(self):
        s = ScreeningQuerySchema(page_size=0)
        self.assertEqual(s.page_size, 20)

    def test_page_size_clamp_high(self):
        s = ScreeningQuerySchema(page_size=500)
        self.assertEqual(s.page_size, 200)

    def test_sort_order_invalid_defaults(self):
        s = ScreeningQuerySchema(sort_order="invalid")
        self.assertEqual(s.sort_order, "desc")

    def test_fund_type_filter(self):
        s = ScreeningQuerySchema(fund_type="gp")
        self.assertEqual(s.fund_type, "gp")


class TestBacktestSchemas(unittest.TestCase):
    def test_fixed_investment_valid(self):
        s = FixedInvestmentSchema(fund_code="000001")
        self.assertEqual(s.fund_code, "000001")
        self.assertEqual(s.amount, 1000)

    def test_fixed_investment_empty_code(self):
        with self.assertRaises(ValueError):
            FixedInvestmentSchema(fund_code="")

    def test_fixed_investment_amount_negative(self):
        with self.assertRaises(ValueError):
            FixedInvestmentSchema(fund_code="000001", amount=-100)

    def test_fixed_investment_amount_too_large(self):
        with self.assertRaises(ValueError):
            FixedInvestmentSchema(fund_code="000001", amount=1_000_000_001)

    def test_fixed_investment_invalid_type(self):
        with self.assertRaises(ValueError):
            FixedInvestmentSchema(fund_code="000001", investment_type="yearly")

    def test_fixed_investment_fee_rate_out_of_range(self):
        with self.assertRaises(ValueError):
            FixedInvestmentSchema(fund_code="000001", fee_rate=6.0)

    def test_fixed_investment_stop_loss_rate_out_of_range(self):
        with self.assertRaises(ValueError):
            FixedInvestmentSchema(fund_code="000001", stop_loss_rate=600)

    def test_fixed_investment_valid_dates(self):
        s = FixedInvestmentSchema(fund_code="000001", start_date="2024-01-01", end_date="2024-12-31")
        self.assertEqual(s.start_date, "2024-01-01")

    def test_fixed_investment_invalid_date_format(self):
        with self.assertRaises(ValueError):
            FixedInvestmentSchema(fund_code="000001", start_date="01-01-2024")


if __name__ == "__main__":
    unittest.main()
