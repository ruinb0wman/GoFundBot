import os
import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import FundWatchlist, FundWatchlistGroup


class TestWatchlistDBOperations(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", echo=False)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)

    def test_add_fund_to_watchlist(self):
        item = FundWatchlist(fund_code="000001", fund_name="测试基金", fund_type="混合型", sort_order=0)
        self.db.add(item)
        self.db.commit()
        saved = self.db.query(FundWatchlist).filter(FundWatchlist.fund_code == "000001").first()
        self.assertIsNotNone(saved)
        self.assertEqual(saved.fund_name, "测试基金")

    def test_watchlist_pagination(self):
        for i in range(10):
            code = f"{i:06d}"
            self.db.add(FundWatchlist(fund_code=code, fund_name=f"基金{i}", sort_order=i))
        self.db.commit()

        page_1 = self.db.query(FundWatchlist).order_by(FundWatchlist.sort_order).offset(0).limit(3).all()
        self.assertEqual(len(page_1), 3)
        self.assertEqual(page_1[0].fund_code, "000000")

        page_2 = self.db.query(FundWatchlist).order_by(FundWatchlist.sort_order).offset(3).limit(3).all()
        self.assertEqual(len(page_2), 3)
        self.assertEqual(page_2[0].fund_code, "000003")

    def test_remove_fund_from_watchlist(self):
        self.db.add(FundWatchlist(fund_code="000001", fund_name="测试基金", sort_order=0))
        self.db.commit()
        item = self.db.query(FundWatchlist).filter(FundWatchlist.fund_code == "000001").first()
        self.db.delete(item)
        self.db.commit()
        result = self.db.query(FundWatchlist).filter(FundWatchlist.fund_code == "000001").first()
        self.assertIsNone(result)

    def test_create_group(self):
        group = FundWatchlistGroup(name="股票基金", sort_order=0)
        self.db.add(group)
        self.db.commit()
        saved = self.db.query(FundWatchlistGroup).filter(FundWatchlistGroup.name == "股票基金").first()
        self.assertIsNotNone(saved)

    def test_delete_group_moves_funds_to_no_group(self):
        group = FundWatchlistGroup(name="测试组", sort_order=0)
        self.db.add(group)
        self.db.commit()
        fund = FundWatchlist(fund_code="000001", fund_name="测试基金", group_id=group.id, sort_order=0)
        self.db.add(fund)
        self.db.commit()

        self.db.query(FundWatchlist).filter(FundWatchlist.group_id == group.id).update({"group_id": None})
        self.db.delete(group)
        self.db.commit()

        fund_check = self.db.query(FundWatchlist).filter(FundWatchlist.fund_code == "000001").first()
        self.assertIsNotNone(fund_check)
        self.assertIsNone(fund_check.group_id)
        group_check = self.db.query(FundWatchlistGroup).filter(FundWatchlistGroup.id == group.id).first()
        self.assertIsNone(group_check)

    def test_sort_order_auto_increment(self):
        self.db.add(FundWatchlist(fund_code="000001", fund_name="基金1", sort_order=0))
        self.db.add(FundWatchlist(fund_code="000002", fund_name="基金2", sort_order=1))
        self.db.commit()
        funds = self.db.query(FundWatchlist).order_by(FundWatchlist.sort_order).all()
        self.assertEqual(funds[0].fund_code, "000001")
        self.assertEqual(funds[1].fund_code, "000002")

    def test_batch_delete_funds(self):
        codes = [f"{i:06d}" for i in range(5)]
        for i, code in enumerate(codes):
            self.db.add(FundWatchlist(fund_code=code, fund_name=f"基金{i}", sort_order=i))
        self.db.commit()
        deleted = (
            self.db.query(FundWatchlist)
            .filter(FundWatchlist.fund_code.in_(codes[:3]))
            .delete(synchronize_session=False)
        )
        self.db.commit()
        self.assertEqual(deleted, 3)
        remaining = self.db.query(FundWatchlist).all()
        self.assertEqual(len(remaining), 2)

    def test_duplicate_fund_code_not_allowed(self):
        self.db.add(FundWatchlist(fund_code="000001", fund_name="基金A", sort_order=0))
        self.db.commit()
        with self.assertRaises(Exception):
            self.db.add(FundWatchlist(fund_code="000001", fund_name="基金B", sort_order=1))
            self.db.commit()

    def test_fund_not_found_returns_none(self):
        result = self.db.query(FundWatchlist).filter(FundWatchlist.fund_code == "999999").first()
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
